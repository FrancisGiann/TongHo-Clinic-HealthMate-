import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './app.js';
import { requireAuth } from './auth.js';
import { getDemonstrationRules } from './domain/risk.js';

test('application factory exposes an Express request handler', () => {
  const configuredHops = process.env.TRUST_PROXY_HOPS;
  delete process.env.TRUST_PROXY_HOPS;
  try {
    const app = createApp();
    assert.equal(typeof app, 'function');
    assert.equal(typeof app.use, 'function');
    assert.equal(typeof app.listen, 'function');
    assert.equal(app.get('trust proxy'), 0);
  } finally {
    if (configuredHops === undefined) delete process.env.TRUST_PROXY_HOPS;
    else process.env.TRUST_PROXY_HOPS = configuredHops;
  }
});

test('account activation is rate limited before password hashing and database access', () => {
  const app = createApp();
  const route = app.router.stack.find((layer) => layer.route?.path === '/api/auth/activate' && layer.route.methods.post);
  assert.ok(route);
  const limiter = route.route.stack[0].handle;
  let accepted = 0;
  const invoke = () => {
    let statusCode = 200;
    let body;
    const response = {
      setHeader() {},
      status(code) { statusCode = code; return this; },
      json(value) { body = value; return this; },
    };
    limiter({ ip: 'activation-rate-limit-test' }, response, () => { accepted += 1; });
    return { statusCode, body };
  };

  for (let attempt = 0; attempt < 20; attempt += 1) assert.deepEqual(invoke(), { statusCode: 200, body: undefined });
  assert.deepEqual(invoke(), {
    statusCode: 429,
    body: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait and try again.' } },
  });
  assert.equal(accepted, 20);
});

test('session management endpoints are available to each authenticated account', () => {
  const app = createApp();
  const routes = app.router.stack
    .filter((layer) => ['/api/auth/sessions', '/api/auth/sessions/:sessionId', '/api/auth/sessions/logout-all'].includes(layer.route?.path))
    .map((layer) => ({ path: layer.route.path, method: Object.keys(layer.route.methods)[0], guard: layer.route.stack[0].handle }));
  assert.deepEqual(routes.map(({ path, method }) => [path, method]), [
    ['/api/auth/sessions', 'get'],
    ['/api/auth/sessions/:sessionId', 'delete'],
    ['/api/auth/sessions/logout-all', 'post'],
  ]);
  assert.ok(routes.every((route) => route.guard === requireAuth));
});

test('every inventory write route applies a nurse-only authorization guard', () => {
  const app = createApp();
  const routes = app.router.stack
    .filter((layer) => layer.route?.path?.startsWith('/api/inventory'))
    .map((layer) => ({ path: layer.route.path, methods: Object.keys(layer.route.methods), guard: layer.route.stack[0].handle }));

  assert.deepEqual(routes.map(({ path, methods }) => [path, methods]), [
    ['/api/inventory', ['post']],
    ['/api/inventory/:id', ['patch']],
    ['/api/inventory/:id/stock-adjustments', ['post']],
    ['/api/inventory/:id/archive', ['patch']],
  ]);
  for (const route of routes) {
    const result = (role) => {
      let statusCode = 200;
      let nextCalled = false;
      const response = { status(code) { statusCode = code; return { json: () => response }; } };
      route.guard({ user: { role } }, response, () => { nextCalled = true; });
      return { statusCode, nextCalled };
    };
    assert.deepEqual(result('school_nurse'), { statusCode: 200, nextCalled: true }, `${route.path} allows nurses`);
    assert.deepEqual(result('system_administrator'), { statusCode: 403, nextCalled: false }, `${route.path} rejects administrators`);
    assert.deepEqual(result('student'), { statusCode: 403, nextCalled: false }, `${route.path} rejects portal users`);
  }
});

test('nurse dashboard bootstrap is restricted to school nurses', () => {
  const app = createApp();
  const route = app.router.stack.find((layer) => layer.route?.path === '/api/nurse/dashboard' && layer.route.methods.get);
  assert.ok(route);
  const guard = route.route.stack[0].handle;
  const invoke = (role) => {
    let statusCode = 200;
    let nextCalled = false;
    const response = { status(code) { statusCode = code; return { json: () => response }; } };
    guard({ user: { role } }, response, () => { nextCalled = true; });
    return { statusCode, nextCalled };
  };

  assert.deepEqual(invoke('school_nurse'), { statusCode: 200, nextCalled: true });
  assert.deepEqual(invoke('system_administrator'), { statusCode: 403, nextCalled: false });
  assert.deepEqual(invoke('guardian'), { statusCode: 403, nextCalled: false });
  assert.deepEqual(invoke('student'), { statusCode: 403, nextCalled: false });
});

test('summary, dashboard preference, and audit routes enforce their server role boundaries', () => {
  const app = createApp();
  const expectations = [
    ['/api/clinic/bootstrap', 'get', ['school_nurse']],
    ['/api/patients/export', 'get', ['school_nurse']],
    ['/api/patients', 'get', ['school_nurse']],
    ['/api/patients/picker', 'get', ['school_nurse']],
    ['/api/patients/:id', 'get', ['school_nurse']],
    ['/api/patients', 'post', ['school_nurse']],
    ['/api/patients/:id', 'put', ['school_nurse']],
    ['/api/reports/patients/:patientId/summary', 'get', ['school_nurse']],
    ['/api/me/dashboard-preferences', 'get', ['school_nurse', 'system_administrator']],
    ['/api/me/dashboard-preferences', 'put', ['school_nurse', 'system_administrator']],
    ['/api/admin/audit-logs', 'get', ['system_administrator']],
  ];
  for (const [path, method, allowed] of expectations) {
    const route = app.router.stack.find((layer) => layer.route?.path === path && layer.route.methods[method]);
    assert.ok(route, `${method.toUpperCase()} ${path} exists`);
    const guard = route.route.stack[0].handle;
    for (const role of ['school_nurse', 'system_administrator', 'guardian', 'student']) {
      let statusCode = 200;
      let nextCalled = false;
      const response = { status(code) { statusCode = code; return { json: () => response }; } };
      guard({ user: { role } }, response, () => { nextCalled = true; });
      assert.deepEqual({ statusCode, nextCalled }, allowed.includes(role) ? { statusCode: 200, nextCalled: true } : { statusCode: 403, nextCalled: false }, `${role} access to ${method.toUpperCase()} ${path}`);
    }
  }
});

test('nurse report reads use bounded date queries in a read-only repeatable-read transaction', async () => {
  const calls = [];
  let transactionStarted = false;
  const queryFn = async (sql, params = []) => {
    calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
    if (/FROM visits/.test(sql)) return { rows: [{ data: { patientId: 'patient-1', date: '2026-10-15', chiefComplaint: 'Headache', type: 'Illness' } }] };
    if (/FROM patients/.test(sql)) return { rows: [{ id: 'patient-1', patient_type: 'student', data: { gradeLevel: 'Grade 1' } }] };
    if (/FROM appointments/.test(sql)) return { rows: [] };
    if (/FROM dispense_logs/.test(sql)) return { rows: [] };
    if (/FROM clinic_settings/.test(sql)) return { rows: [{ settings: { schoolName: 'Synthetic clinic' } }] };
    throw new Error(`Unexpected report query: ${sql}`);
  };
  const app = createApp({
    queryFn,
    transactionFn: async (work) => {
      transactionStarted = true;
      const result = await work({ query: async (sql, params) => {
        if (/SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY/.test(sql)) return { rows: [], rowCount: 0 };
        return queryFn(sql, params);
      } });
      return result;
    },
  });
  const route = app.router.stack.find((layer) => layer.route?.path === '/api/reports' && layer.route.methods.get);
  const handler = route.route.stack.at(-1).handle;
  const response = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ query: { start: '2026-10-15', end: '2026-10-15' }, user: { role: 'school_nurse' } }, response);
  assert.equal(transactionStarted, true);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.data.totals.visits, 1);
  assert.equal(calls.length, 5);
  assert.deepEqual(calls[0].params, ['2026-10-14', '2026-10-16']);
  assert.match(calls[0].sql, /riskAssessment/);
  assert.match(calls[2].sql, /FROM appointments WHERE/);
  assert.equal(response.body.data.grades['Grade 1'], 1);
});

test('targeted profile updates validate malformed payloads before opening a transaction', async () => {
  let transactionCalls = 0;
  const app = createApp({ clinicDataTransactionFn: async () => { transactionCalls += 1; } });
  const handler = app.router.stack.find((layer) => layer.route?.path === '/api/patients/:id' && layer.route.methods.put).route.stack.at(-1).handle;
  const invoke = async (patient) => {
    const response = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await handler({ params: { id: 'patient-1' }, body: { patient, schemaVersion: 4 }, user: { id: 'nurse-1', role: 'school_nurse' }, headers: {}, ip: '127.0.0.1' }, response);
    return response;
  };
  const objectValue = await invoke({ id: 'patient-1', contactNumber: { number: '123' } });
  assert.equal(objectValue.statusCode, 400);
  assert.equal(objectValue.body.error.code, 'VALIDATION_ERROR');
  assert.ok(objectValue.body.error.fields.contactNumber);
  const mismatchedId = await invoke({ id: 'patient-2', name: 'Ari Santos' });
  assert.equal(mismatchedId.statusCode, 400);
  assert.ok(mismatchedId.body.error.fields.id);
  assert.equal(transactionCalls, 0);
});

test('targeted profile writes preserve accepted guardian answers, consent, and unrelated patient fields', async () => {
  const patientId = 'synthetic-patient-1';
  const canonicalAnswers = { allergies: 'Peanuts', conditions: 'Asthma', allergiesStatus: 'reported' };
  const original = {
    name: 'Before Name', studentId: 'S-001', gradeLevel: 'Grade 1', section: 'A', adviser: 'Nurse',
    allergies: canonicalAnswers.allergies, conditions: canonicalAnswers.conditions,
    guardianHealthRecord: canonicalAnswers, consentStatus: 'accepted', consentDueDate: '2026-12-01',
    retainedClinicFlag: 'preserve-me',
  };
  let persisted;
  const app = createApp({ clinicDataTransactionFn: async (work) => work({
    async query(sql, params = []) {
      if (/SELECT version FROM clinic_settings/.test(sql)) return { rows: [{ version: 5 }], rowCount: 1 };
      if (/SELECT patient_type,data FROM patients WHERE id=\$1 FOR UPDATE/.test(sql)) return { rows: [{ patient_type: 'student', data: original }], rowCount: 1 };
      if (/SELECT id,patient_type,data FROM patients/.test(sql)) return { rows: [{ id: patientId, patient_type: 'student', data: original }], rowCount: 1 };
      if (/UPDATE patients SET data/.test(sql)) { persisted = JSON.parse(params[0]); return { rows: [], rowCount: 1 }; }
      return { rows: [], rowCount: 1 };
    },
  }) });
  const handler = app.router.stack.find((layer) => layer.route?.path === '/api/patients/:id' && layer.route.methods.put).route.stack.at(-1).handle;
  const response = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({
    params: { id: patientId },
    body: { schemaVersion: 4, patient: { id: patientId, name: 'After Name', allergies: 'unauthorized replacement', consentStatus: 'rejected', retainedClinicFlag: 'drop-me' } },
    user: { id: 'nurse-1', role: 'school_nurse' }, headers: {}, ip: '127.0.0.1',
  }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(persisted.name, 'After Name');
  assert.equal(persisted.allergies, canonicalAnswers.allergies);
  assert.equal(persisted.conditions, canonicalAnswers.conditions);
  assert.deepEqual(persisted.guardianHealthRecord, canonicalAnswers);
  assert.equal(persisted.consentStatus, 'accepted');
  assert.equal(persisted.consentDueDate, '2026-12-01');
  assert.equal(persisted.retainedClinicFlag, 'preserve-me');
});

test('guardian signup request and verify stay public while guardian invitations stay administrator-only', () => {
  const app = createApp();
  for (const method of ['post']) {
    for (const path of ['/api/auth/guardian-signup/request', '/api/auth/guardian-signup/verify']) {
      const route = app.router.stack.find((layer) => layer.route?.path === path && layer.route.methods[method]);
      assert.ok(route, `${method.toUpperCase()} ${path} exists`);
      const middleware = route.route.stack.slice(0, -1);
      let statusCode = 200;
      const response = { status(code) { statusCode = code; return this; }, setHeader() {}, json() { return this; } };
      const req = { ip: `public-signup-${path}`, socket: { remoteAddress: '127.0.0.1' }, body: {} };
      for (const layer of middleware) {
        let nextCalled = false;
        layer.handle(req, response, () => { nextCalled = true; });
        assert.equal(nextCalled, true, `${path} middleware must not require a signed-in role`);
      }
      assert.equal(statusCode, 200);
    }
  }
  const invite = app.router.stack.find((layer) => layer.route?.path === '/api/admin/users/invite' && layer.route.methods.post);
  const guard = invite.route.stack[0].handle;
  for (const [role, allowed] of [['system_administrator', true], ['school_nurse', false], ['guardian', false], ['student', false]]) {
    let statusCode = 200;
    let nextCalled = false;
    const response = { status(code) { statusCode = code; return { json: () => response }; } };
    guard({ user: { role } }, response, () => { nextCalled = true; });
    assert.deepEqual({ statusCode, nextCalled }, allowed ? { statusCode: 200, nextCalled: true } : { statusCode: 403, nextCalled: false });
  }
});

test('new adviser workflows enforce their nurse, guardian, and administrator boundaries', () => {
  const app = createApp();
  const expectations = [
    ['/api/admin/guardian-signup-requests', 'get', 0, ['system_administrator']],
    ['/api/admin/guardian-signup-requests/:id/approve', 'patch', 0, ['system_administrator']],
    ['/api/admin/branding', 'get', 0, ['system_administrator']],
    ['/api/admin/branding/:slot', 'put', 0, ['system_administrator']],
    ['/api/admin/branding/:slot', 'delete', 0, ['system_administrator']],
    ['/api/nurse/appointment-unavailable-periods', 'get', 0, ['school_nurse']],
    ['/api/nurse/appointment-unavailable-periods', 'post', 0, ['school_nurse']],
    ['/api/nurse/appointment-unavailable-periods/:id', 'delete', 0, ['school_nurse']],
    ['/api/incidents', 'get', 0, ['school_nurse', 'guardian']],
    ['/api/incidents', 'post', 0, ['school_nurse']],
    ['/api/incidents/:id', 'patch', 0, ['school_nurse']],
    ['/api/incidents/:id/eligible-guardians', 'get', 0, ['school_nurse']],
    ['/api/incidents/:id/photo-consent/request', 'post', 0, ['school_nurse']],
    ['/api/incidents/:id/photo-consent', 'patch', 0, ['guardian']],
    ['/api/incidents/:id/photos', 'post', 0, ['school_nurse']],
    ['/api/incidents/:id/photos/:photoId', 'get', 1, ['school_nurse', 'guardian']],
    ['/api/incidents/:id/photos/:photoId', 'delete', 0, ['school_nurse']],
  ];
  for (const [path, method, guardIndex, allowed] of expectations) {
    const route = app.router.stack.find((layer) => layer.route?.path === path && layer.route.methods[method]);
    assert.ok(route, `${method.toUpperCase()} ${path} exists`);
    const guard = route.route.stack[guardIndex].handle;
    for (const role of ['school_nurse', 'system_administrator', 'guardian', 'student', null]) {
      let statusCode = 200;
      let nextCalled = false;
      const response = { status(code) { statusCode = code; return { json: () => response }; } };
      guard({ user: role ? { role } : undefined }, response, () => { nextCalled = true; });
      const expected = role && allowed.includes(role) ? { statusCode: 200, nextCalled: true } : { statusCode: role ? 403 : 401, nextCalled: false };
      assert.deepEqual({ statusCode, nextCalled }, expected, `${role || 'anonymous'} access to ${method.toUpperCase()} ${path}`);
    }
  }
});

test('public branding and private incident image routes apply restrictive stream headers', () => {
  const app = createApp();
  for (const path of ['/api/branding/assets/:slot', '/api/incidents/:id/photos/:photoId']) {
    const route = app.router.stack.find((layer) => layer.route?.path === path && layer.route.methods.get);
    assert.ok(route, `GET ${path} exists`);
    const middleware = route.route.stack[0].handle;
    const headers = new Map();
    let nextCalled = false;
    middleware({}, { setHeader(name, value) { headers.set(name, value); } }, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    assert.equal(headers.get('Content-Security-Policy'), "default-src 'none'; sandbox");
    assert.equal(headers.get('X-Content-Type-Options'), 'nosniff');
  }
});

test('guardian health records are scoped to guardians, nurse review is nurse-only, and appointment requests remain available to guardians', () => {
  const app = createApp();
  const routes = [
    { path: '/api/guardian/health-records', method: 'get', allow: 'guardian' },
    { path: '/api/guardian/health-records/:patientId/draft', method: 'put', allow: 'guardian' },
    { path: '/api/guardian/health-records/:patientId/submit', method: 'post', allow: 'guardian' },
    { path: '/api/nurse/health-record-submissions', method: 'get', allow: 'school_nurse' },
    { path: '/api/appointments', method: 'post', allow: 'guardian' },
  ];
  for (const expected of routes) {
    const layer = app.router.stack.find((entry) => entry.route?.path === expected.path && entry.route.methods[expected.method]);
    assert.ok(layer, `${expected.method.toUpperCase()} ${expected.path} exists`);
    const guard = layer.route.stack[0].handle;
    const invoke = (role) => {
      let statusCode = 200;
      let nextCalled = false;
      const response = { status(code) { statusCode = code; return { json: () => response }; } };
      guard({ user: { role } }, response, () => { nextCalled = true; });
      return { statusCode, nextCalled };
    };
    assert.deepEqual(invoke(expected.allow), { statusCode: 200, nextCalled: true }, `${expected.allow} is allowed`);
    assert.deepEqual(invoke('student'), { statusCode: 403, nextCalled: false }, 'student accounts cannot use online workflows');
  }
});

test('guardian invitation requires an administrator and a student patient link', () => {
  const app = createApp();
  const route = app.router.stack.find((layer) => layer.route?.path === '/api/admin/users/invite' && layer.route.methods.post);
  assert.ok(route);
  const guard = route.route.stack[0].handle;
  for (const [role, allowed] of [['system_administrator', true], ['guardian', false], ['school_nurse', false]]) {
    let statusCode = 200;
    let nextCalled = false;
    const response = { status(code) { statusCode = code; return { json: () => response }; } };
    guard({ user: { role } }, response, () => { nextCalled = true; });
    assert.equal(nextCalled, allowed);
    if (!allowed) assert.equal(statusCode, 403);
  }
});

test('nurses and administrators can create inactive risk drafts while guardians cannot', () => {
  const app = createApp();
  for (const path of ['/api/risk/rules', '/api/risk/rules/conservative-candidate']) {
    const route = app.router.stack.find((layer) => layer.route?.path === path && layer.route.methods.post);
    assert.ok(route, `POST ${path} exists`);
    const guard = route.route.stack[0].handle;
    const invoke = (role) => {
      let statusCode = 200;
      let nextCalled = false;
      const response = { status(code) { statusCode = code; return { json: () => response }; } };
      guard({ user: { role } }, response, () => { nextCalled = true; });
      return { statusCode, nextCalled };
    };
    assert.deepEqual(invoke('system_administrator'), { statusCode: 200, nextCalled: true }, `${path} allows administrators`);
    assert.deepEqual(invoke('school_nurse'), { statusCode: 200, nextCalled: true }, `${path} allows nurses to create inactive drafts`);
    assert.deepEqual(invoke('guardian'), { statusCode: 403, nextCalled: false }, `${path} rejects guardians`);
  }
});

test('only school nurses can approve a risk rule', () => {
  const app = createApp();
  const route = app.router.stack.find((layer) => layer.route?.path === '/api/risk/rules/:id/approve' && layer.route.methods.patch);
  assert.ok(route);
  const guard = route.route.stack[0].handle;
  for (const [role, expected] of [['school_nurse', true], ['system_administrator', false], ['guardian', false]]) {
    let statusCode = 200;
    let nextCalled = false;
    const response = { status(code) { statusCode = code; return { json: () => response }; } };
    guard({ user: { role } }, response, () => { nextCalled = true; });
    assert.equal(nextCalled, expected, `${role} approval access`);
    if (!expected) assert.equal(statusCode, 403);
  }
});

test('risk draft API rejects coerced versions and malformed rule payloads before writing', async () => {
  const app = createApp();
  const route = app.router.stack.find((layer) => layer.route?.path === '/api/risk/rules' && layer.route.methods.post);
  assert.ok(route);
  const handler = route.route.stack.at(-1).handle;
  const base = { name: 'Nurse draft', rules: getDemonstrationRules() };
  const cases = [
    { body: { ...base, version: true }, message: /version must be a positive whole number/i },
    { body: { ...base, version: [1] }, message: /version must be a positive whole number/i },
    { body: { ...base, version: ' ' }, message: /version must be a positive whole number/i },
    { body: { ...base, version: 2147483648 }, message: /version must be a positive whole number/i },
    { body: { ...base, name: {} }, message: /rule name/i },
    { body: { ...base, rules: { ...getDemonstrationRules(), thresholds: { moderate: '', high: 7 } } }, message: /thresholds from 1 to 100/i },
    { body: { ...base, rules: { ...getDemonstrationRules(), indicators: getDemonstrationRules().indicators.map((item, index) => index === 1 ? { ...item, value: ' ' } : item) } }, message: /numeric indicators must use a numeric threshold/i },
  ];
  for (const { body, message } of cases) {
    let statusCode = 200;
    let responseBody;
    const response = {
      status(code) { statusCode = code; return this; },
      json(value) { responseBody = value; return this; },
    };
    await handler({ body, user: { id: 'nurse-id', role: 'school_nurse' } }, response);
    assert.equal(statusCode, 400);
    assert.match(responseBody.error.message, message);
  }
});

test('development risk-rule test activation routes are no longer registered', () => {
  const app = createApp();
  const routes = app.router.stack
    .filter((layer) => ['/api/risk/rules/:id/test-activation', '/api/risk/rules/test-activation'].includes(layer.route?.path))
    .map((layer) => layer.route.path);
  assert.deepEqual(routes, []);
});

test('PRC license recording is administrator-only and requires explicit verification', async () => {
  const app = createApp();
  const route = app.router.stack.find((layer) => layer.route?.path === '/api/admin/users/:id/prc-license');
  assert.ok(route?.route?.methods.patch);
  const guard = route.route.stack[0].handle;
  const invokeGuard = (role) => {
    let statusCode = 200;
    let nextCalled = false;
    const response = { status(code) { statusCode = code; return { json: () => response }; } };
    guard({ user: { role } }, response, () => { nextCalled = true; });
    return { statusCode, nextCalled };
  };
  assert.deepEqual(invokeGuard('system_administrator'), { statusCode: 200, nextCalled: true });
  assert.deepEqual(invokeGuard('school_nurse'), { statusCode: 403, nextCalled: false });
  assert.deepEqual(invokeGuard('student'), { statusCode: 403, nextCalled: false });

  let statusCode = 200;
  let responseBody;
  const response = {
    status(code) { statusCode = code; return this; },
    json(body) { responseBody = body; return this; },
  };
  await route.route.stack.at(-1).handle({ params: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, body: { prcLicenseNumber: 'PRC-123' } }, response);
  assert.equal(statusCode, 400);
  assert.equal(responseBody.error.code, 'VERIFICATION_CONFIRMATION_REQUIRED');
});

test('an unverified license value cannot approve a risk rule', async () => {
  const app = createApp();
  const route = app.router.stack.find((layer) => layer.route?.path === '/api/risk/rules/:id/approve');
  let statusCode = 200;
  let responseBody;
  const response = {
    status(code) { statusCode = code; return this; },
    json(body) { responseBody = body; return this; },
  };
  await route.route.stack.at(-1).handle({
    params: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    user: { id: 'nurse-id', role: 'school_nurse', prc_license_number: 'PRC-123', prc_license_verified_at: null, prc_license_verified_by: null },
  }, response);
  assert.equal(statusCode, 403);
  assert.equal(responseBody.error.code, 'LICENSE_REQUIRED');
});

test('visit creation and clinical snapshot writes are restricted to school nurses', () => {
  const app = createApp();
  const routes = app.router.stack
    .filter((layer) => (layer.route?.path === '/api/visits' && layer.route.methods.post)
      || (layer.route?.path === '/api/data' && layer.route.methods.put))
    .map((layer) => ({ path: layer.route.path, guard: layer.route.stack[0].handle }));

  assert.deepEqual(routes.map(({ path }) => path).sort(), ['/api/data', '/api/visits']);
  for (const route of routes) {
    const result = (role) => {
      let statusCode = 200;
      let nextCalled = false;
      const response = { status(code) { statusCode = code; return { json: () => response }; } };
      route.guard({ user: { role } }, response, () => { nextCalled = true; });
      return { statusCode, nextCalled };
    };
    assert.deepEqual(result('school_nurse'), { statusCode: 200, nextCalled: true });
    assert.deepEqual(result('system_administrator'), { statusCode: 403, nextCalled: false });
    assert.deepEqual(result('student'), { statusCode: 403, nextCalled: false });
    assert.deepEqual(result('guardian'), { statusCode: 403, nextCalled: false });
  }
});

test('arrival recording route is restricted to school nurses', () => {
  const app = createApp();
  const route = app.router.stack.find((layer) => layer.route?.path === '/api/visits/arrivals' && layer.route.methods.post);
  assert.ok(route);
  const guard = route.route.stack[0].handle;
  const invoke = (role) => {
    let statusCode = 200;
    let nextCalled = false;
    const response = { status(code) { statusCode = code; return { json: () => response }; } };
    guard({ user: { role } }, response, () => { nextCalled = true; });
    return { statusCode, nextCalled };
  };
  assert.deepEqual(invoke('school_nurse'), { statusCode: 200, nextCalled: true });
  assert.deepEqual(invoke('system_administrator'), { statusCode: 403, nextCalled: false });
  assert.deepEqual(invoke('guardian'), { statusCode: 403, nextCalled: false });
});

test('legacy queue API routes return a disabled response for old clients', async () => {
  const app = createApp();
  const routes = app.router.stack
    .filter((layer) => ['/api/queue', '/api/queue/:id'].includes(layer.route?.path));

  assert.deepEqual(routes.map((route) => route.route.path), ['/api/queue', '/api/queue/:id']);
  for (const route of routes) {
    const handler = route.route.stack.at(-1).handle;
    let statusCode = 200;
    let responseBody;
    const response = {
      status(code) { statusCode = code; return this; },
      json(body) { responseBody = body; return this; },
    };
    await handler({}, response);
    assert.equal(statusCode, 410);
    assert.equal(responseBody.error.code, 'FEATURE_REMOVED');
  }
});

test('faculty registration and import routes enforce their assigned roles', () => {
  const app = createApp();
  const guardedRoutes = app.router.stack
    .filter((layer) => layer.route && [
      '/api/patients/faculty',
      '/api/import/students/preview', '/api/import/students',
      '/api/import/faculty/preview', '/api/import/faculty',
      '/api/import/visits/preview', '/api/import/visits',
      '/api/import/batches/:id/rollback',
    ].includes(layer.route.path))
    .map((layer) => ({ path: layer.route.path, method: Object.keys(layer.route.methods)[0], guard: layer.route.stack[0].handle }));
  const find = (path, method) => guardedRoutes.find((route) => route.path === path && route.method === method);
  const invoke = (route, role) => {
    let statusCode = 200;
    let nextCalled = false;
    const response = { status(code) { statusCode = code; return { json: () => response }; } };
    route.guard({ user: { role } }, response, () => { nextCalled = true; });
    return { statusCode, nextCalled };
  };
  assert.deepEqual(invoke(find('/api/patients/faculty', 'post'), 'school_nurse'), { statusCode: 200, nextCalled: true });
  assert.deepEqual(invoke(find('/api/patients/faculty', 'post'), 'system_administrator'), { statusCode: 403, nextCalled: false });
  for (const method of ['post']) {
    assert.deepEqual(invoke(find('/api/import/students', method), 'system_administrator'), { statusCode: 200, nextCalled: true });
    assert.deepEqual(invoke(find('/api/import/students', method), 'school_nurse'), { statusCode: 403, nextCalled: false });
    assert.deepEqual(invoke(find('/api/import/faculty', method), 'school_nurse'), { statusCode: 200, nextCalled: true });
    assert.deepEqual(invoke(find('/api/import/faculty', method), 'system_administrator'), { statusCode: 200, nextCalled: true });
    assert.deepEqual(invoke(find('/api/import/visits', method), 'school_nurse'), { statusCode: 200, nextCalled: true });
    assert.deepEqual(invoke(find('/api/import/visits', method), 'system_administrator'), { statusCode: 403, nextCalled: false });
  }
  assert.deepEqual(invoke(find('/api/import/batches/:id/rollback', 'post'), 'student'), { statusCode: 403, nextCalled: false });
});

test('import rollback rejects malformed UUIDs before querying the database', async () => {
  const app = createApp();
  const route = app.router.stack.find((layer) => layer.route?.path === '/api/import/batches/:id/rollback');
  const handler = route.route.stack.at(-1).handle;

  for (const id of ['------------------------------------', '000000000000000000000000000000000000']) {
    let statusCode = 200;
    let responseBody;
    const response = {
      status(code) { statusCode = code; return this; },
      json(body) { responseBody = body; return this; },
    };
    await handler({ params: { id }, user: { role: 'school_nurse' } }, response);
    assert.equal(statusCode, 400);
    assert.equal(responseBody.error.code, 'INVALID_BATCH_ID');
  }
});

test('import rollback preserves a patient with a dedicated student incident', async () => {
  const batchId = '00000000-0000-4000-8000-000000000911';
  const statements = [];
  const app = createApp({
    clinicDataTransactionFn: async (work) => work({
      async query(sql) {
        const normalized = sql.replace(/\s+/g, ' ').trim();
        statements.push(normalized);
        if (normalized.startsWith('SELECT id,import_type,rolled_back_at FROM import_batches')) return { rows: [{ id: batchId, import_type: 'students', rolled_back_at: null }], rowCount: 1 };
        if (normalized.startsWith('SELECT entity_type,entity_id,original_data_hash FROM import_batch_items')) return { rows: [{ entity_type: 'patient', entity_id: 'patient-with-incident', original_data_hash: 'unchanged-hash' }], rowCount: 1 };
        if (normalized.startsWith('SELECT md5(p.data::text)')) {
          assert.match(normalized, /EXISTS\(SELECT 1 FROM student_incidents WHERE patient_id=p.id\)/);
          return { rows: [{ current_hash: 'unchanged-hash', has_user: false, has_guardians: false, has_invitations: false, has_clinic_activity: true }], rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      },
    }),
  });
  const route = app.router.stack.find((layer) => layer.route?.path === '/api/import/batches/:id/rollback' && layer.route.methods.post);
  let statusCode = 200;
  let body;
  const response = { status(code) { statusCode = code; return this; }, json(value) { body = value; return this; } };
  await route.route.stack.at(-1).handle({ params: { id: batchId }, user: { id: 'admin-id', role: 'system_administrator' } }, response);
  assert.equal(statusCode, 409);
  assert.equal(body.error.code, 'IMPORT_ROLLBACK_CONFLICT');
  assert.ok(!statements.some((sql) => sql.startsWith('DELETE FROM patients')));
});

test('report read and snapshot routes reject impossible dates before accessing the database',async()=>{
  const app=createApp();
  for(const method of ['get','post']){
    const path=method==='get'?'/api/reports':'/api/reports/snapshots';
    const handler=app.router.stack.find(layer=>layer.route?.path===path && layer.route.methods[method]).route.stack.at(-1).handle;
    for(const period of [{start:'2026-02-30',end:'2026-03-03'},{start:'2026-02-01',end:'2026-02-30'},{start:'2025-02-29',end:'2025-03-01'},{start:'2026-04-31',end:'2026-05-01'}]){
      let status=200;let body;
      const res={status(value){status=value;return this;},json(value){body=value;return this;}};
      await handler({query:period,body:period,user:{role:'school_nurse'}},res);
      assert.equal(status,400,`${method} ${JSON.stringify(period)}`);
      assert.equal(body.error.code,'INVALID_PERIOD');
    }
  }
});

test('guardian signup approval rechecks account conflicts inside its transaction and rolls back without linking', async () => {
  const requestId = '00000000-0000-4000-8000-000000000111';
  let committed = false;
  const mutations = [];
  const app = createApp({ transactionFn: async (work) => {
    const client = { query: async (sql) => {
      if (sql.includes('SELECT * FROM guardian_signup_requests')) return { rows: [{ id: requestId, status: 'pending_review', password_hash: 'bcrypt-hash', email: 'parent@example.test', username: 'parent', student_id: 'S-001' }], rowCount: 1 };
      if (sql.includes('SELECT id FROM users')) return { rows: [{ id: 'existing-user' }], rowCount: 1 };
      if (sql.includes('SELECT id FROM invitations')) return { rows: [], rowCount: 0 };
      if (/^(INSERT|UPDATE|DELETE)\s/.test(sql.trim())) mutations.push(sql);
      return { rows: [], rowCount: 1 };
    } };
    const result = await work(client);
    committed = true;
    return result;
  } });
  const route = app.router.stack.find((layer) => layer.route?.path === '/api/admin/guardian-signup-requests/:id/approve' && layer.route.methods.patch);
  const handler = route.route.stack.at(-1).handle;
  let statusCode = 200;
  let body;
  const response = { status(code) { statusCode = code; return this; }, json(value) { body = value; return this; } };
  await handler({ params: { id: requestId }, body: { verifiedRelationship: true, patientId: 'legacy-student-id' }, user: { id: 'admin-id', role: 'system_administrator' }, headers: {}, ip: 'test' }, response);
  assert.equal(statusCode, 409);
  assert.equal(body.error.code, 'ACCOUNT_CONFLICT');
  assert.equal(committed, false, 'the transaction did not commit the signup request');
  assert.deepEqual(mutations, [], 'no active guardian or student link write follows a conflict');
  assert.equal(JSON.stringify(body).includes('bcrypt-hash'), false);
});

test('guardian signup email verification stores hints without requiring or writing a roster match', async () => {
  const scenarios = [
    {
      metadata: { name: 'Guardian', username: 'guardian.one', passwordHash: '$2b$12$' + 'a'.repeat(53), childName: 'New student', gradeLevel: 'Grade 3', section: 'Emerald', studentId: 'NOT-YET-ON-ROSTER', relationship: 'Mother' },
      expected: ['NOT-YET-ON-ROSTER', 'Mother', 'New student', 'Grade 3', 'Emerald'],
    },
    {
      metadata: { name: 'Legacy Guardian', username: 'guardian.legacy', passwordHash: '$2b$12$' + 'b'.repeat(53), studentId: 'S-001', relationship: 'Parent' },
      expected: ['S-001', 'Parent', '', '', ''],
    },
  ];

  for (const scenario of scenarios) {
    const statements = [];
    let insertValues;
    const client = { query: async (sql, values = []) => {
      statements.push(sql);
      if (sql.startsWith('INSERT INTO guardian_signup_requests')) insertValues = values;
      if (sql.startsWith('SELECT id FROM users') || sql.startsWith('SELECT 1 FROM invitations') || sql.startsWith('SELECT id FROM guardian_signup_requests')) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 1 };
    } };
    const app = createApp({ consumeOtpFn: async (_id, _code, purpose, { onConsume }) => {
      assert.equal(purpose, 'guardian_signup');
      return onConsume({ id: 'challenge-id', destination: 'guardian@example.test', metadata: scenario.metadata }, client);
    } });
    const route = app.router.stack.find((layer) => layer.route?.path === '/api/auth/guardian-signup/verify' && layer.route.methods.post);
    let statusCode = 200;
    let body;
    const response = { status(code) { statusCode = code; return this; }, json(value) { body = value; return this; } };
    await route.route.stack.at(-1).handle({ body: { challengeId: 'challenge-id', code: '123456' }, headers: {}, ip: 'test' }, response);

    assert.equal(statusCode, 200);
    assert.equal(body.data.pendingReview, true);
    assert.deepEqual(insertValues.slice(5, 10), scenario.expected);
    assert.equal(statements.some((sql) => /\bFROM patients\b|\bINTO patients\b/.test(sql)), false);
  }
});

test('guardian signup approval links only the explicitly selected student record', async () => {
  const requestId = '00000000-0000-4000-8000-000000000121';
  const claimedStudentId = 'CLAIMED-ID';
  const chosenStudentId = 'school-record-42';
  const mutations = [];
  let auditDetails;
  let committed = false;
  const client = { query: async (sql, values = []) => {
    if (sql.includes('SELECT * FROM guardian_signup_requests')) return { rows: [{ id: requestId, status: 'pending_review', password_hash: 'bcrypt-hash', email: 'parent@example.test', username: 'parent', student_id: claimedStudentId, relationship: 'Mother' }], rowCount: 1 };
    if (sql.startsWith('SELECT id FROM users')) return { rows: [], rowCount: 0 };
    if (sql.startsWith('SELECT id FROM invitations')) return { rows: [], rowCount: 0 };
    if (sql.includes('FROM patients')) {
      assert.match(sql, /WHERE id=\$1 AND patient_type='student' FOR UPDATE/);
      assert.deepEqual(values, [chosenStudentId]);
      return { rows: [{ id: chosenStudentId, name: 'Verified roster student', student_id: 'OFFICIAL-42', grade_level: 'Grade 6', section: 'Mabini' }], rowCount: 1 };
    }
    if (/^(INSERT|UPDATE|DELETE)\s/.test(sql.trim())) mutations.push({ sql, values });
    if (values[1] === 'GUARDIAN_SIGNUP_APPROVED') auditDetails = JSON.parse(values[4]);
    return { rows: [], rowCount: 1 };
  } };
  const app = createApp({
    transactionFn: async (work) => { const result = await work(client); committed = true; return result; },
    queryFn: async (sql) => sql.startsWith('SELECT decision_email_status')
      ? { rows: [{ decision_email_status: 'queued' }], rowCount: 1 }
      : { rows: [], rowCount: 0 },
  });
  const route = app.router.stack.find((layer) => layer.route?.path === '/api/admin/guardian-signup-requests/:id/approve' && layer.route.methods.patch);
  let statusCode = 200;
  let body;
  const response = { status(code) { statusCode = code; return this; }, json(value) { body = value; return this; } };
  await route.route.stack.at(-1).handle({ params: { id: requestId }, body: { verifiedRelationship: true, patientId: chosenStudentId }, user: { id: 'admin-id', role: 'system_administrator' }, headers: {}, ip: 'test' }, response);

  assert.equal(statusCode, 200);
  assert.equal(committed, true);
  assert.deepEqual(body.data.request.linkedStudent, { id: chosenStudentId, name: 'Verified roster student', studentId: 'OFFICIAL-42', gradeLevel: 'Grade 6', section: 'Mabini' });
  assert.equal(mutations.some(({ sql }) => sql.startsWith('INSERT INTO patients')), false);
  assert.deepEqual(mutations.find(({ sql }) => sql.startsWith('INSERT INTO guardian_patient_links')).values.slice(1), [chosenStudentId, 'Mother']);
  assert.deepEqual(mutations.find(({ sql }) => sql.startsWith('UPDATE guardian_signup_requests')).values, [requestId, chosenStudentId, 'admin-id']);
  assert.deepEqual(auditDetails, { patientId: chosenStudentId });
  assert.notEqual(chosenStudentId, claimedStudentId, 'the administrator can deliberately select a verified record that differs from the claim');
});

test('guardian signup approval rejects missing or invalid student selection and nonstudent records without writes', async () => {
  const requestId = '00000000-0000-4000-8000-000000000122';
  let transactionCalls = 0;
  let committed = false;
  const app = createApp({ transactionFn: async (work) => {
    transactionCalls += 1;
    const client = { query: async (sql) => {
      if (sql.includes('SELECT * FROM guardian_signup_requests')) return { rows: [{ id: requestId, status: 'pending_review', password_hash: 'bcrypt-hash', email: 'parent@example.test', username: 'parent', student_id: 'S-001', relationship: 'Parent' }], rowCount: 1 };
      if (sql.startsWith('SELECT id FROM users') || sql.startsWith('SELECT id FROM invitations')) return { rows: [], rowCount: 0 };
      if (sql.includes('FROM patients')) return { rows: [], rowCount: 0 };
      assert.doesNotMatch(sql.trim(), /^(INSERT|UPDATE|DELETE)\s/);
      return { rows: [], rowCount: 1 };
    } };
    const result = await work(client);
    committed = true;
    return result;
  } });
  const route = app.router.stack.find((layer) => layer.route?.path === '/api/admin/guardian-signup-requests/:id/approve' && layer.route.methods.patch);
  const handler = route.route.stack.at(-1).handle;
  const invoke = async (bodyInput) => {
    let statusCode = 200;
    let body;
    const response = { status(code) { statusCode = code; return this; }, json(value) { body = value; return this; } };
    await handler({ params: { id: requestId }, body: bodyInput, user: { id: 'admin-id', role: 'system_administrator' }, headers: {}, ip: 'test' }, response);
    return { statusCode, body };
  };
  assert.equal((await invoke({ verifiedRelationship: true })).statusCode, 400);
  assert.equal((await invoke({ verifiedRelationship: true, patientId: 'bad\npatient' })).statusCode, 400);
  assert.equal(transactionCalls, 0);
  const nonstudent = await invoke({ verifiedRelationship: true, patientId: 'faculty-or-deleted-record' });
  assert.equal(nonstudent.statusCode, 409);
  assert.equal(nonstudent.body.error.code, 'STUDENT_SELECTION_INVALID');
  assert.equal(transactionCalls, 1);
  assert.equal(committed, false, 'a missing or nonstudent record leaves the request and guardian account untouched');
});

test('concurrent guardian signup decisions commit at most one guardian account and link', async () => {
  const requestId = '00000000-0000-4000-8000-000000000123';
  let requestStatus = 'pending_review';
  let commitCount = 0;
  const accountWrites = [];
  const linkWrites = [];
  let transactionTail = Promise.resolve();
  const transactionFn = async (work) => {
    const previous = transactionTail;
    let release;
    transactionTail = new Promise((resolve) => { release = resolve; });
    await previous;
    const transactionState = { status: requestStatus, accounts: [], links: [] };
    const client = { query: async (sql, values = []) => {
      if (sql.includes('SELECT * FROM guardian_signup_requests')) return { rows: [{ id: requestId, status: transactionState.status, password_hash: transactionState.status === 'pending_review' ? 'bcrypt-hash' : null, email: 'parent@example.test', username: 'parent', student_id: 'S-001', relationship: 'Parent' }], rowCount: 1 };
      if (sql.startsWith('SELECT id FROM users') || sql.startsWith('SELECT id FROM invitations')) return { rows: [], rowCount: 0 };
      if (sql.includes('FROM patients')) return { rows: [{ id: 'chosen-student', name: 'School student', student_id: 'S-002', grade_level: 'Grade 5', section: 'Rizal' }], rowCount: 1 };
      if (sql.startsWith('INSERT INTO users')) transactionState.accounts.push(values);
      if (sql.startsWith('INSERT INTO guardian_patient_links')) transactionState.links.push(values);
      if (sql.startsWith('UPDATE guardian_signup_requests')) transactionState.status = 'approved';
      return { rows: [], rowCount: 1 };
    } };
    try {
      const result = await work(client);
      requestStatus = transactionState.status;
      commitCount += 1;
      accountWrites.push(...transactionState.accounts);
      linkWrites.push(...transactionState.links);
      return result;
    } finally {
      release();
    }
  };
  const app = createApp({
    transactionFn,
    queryFn: async (sql) => sql.startsWith('SELECT decision_email_status')
      ? { rows: [{ decision_email_status: 'queued' }], rowCount: 1 }
      : { rows: [], rowCount: 0 },
  });
  const route = app.router.stack.find((layer) => layer.route?.path === '/api/admin/guardian-signup-requests/:id/approve' && layer.route.methods.patch);
  const handler = route.route.stack.at(-1).handle;
  const invoke = async () => {
    let statusCode = 200;
    let body;
    const response = { status(code) { statusCode = code; return this; }, json(value) { body = value; return this; } };
    await handler({ params: { id: requestId }, body: { verifiedRelationship: true, patientId: 'chosen-student' }, user: { id: 'admin-id', role: 'system_administrator' }, headers: {}, ip: 'test' }, response);
    return { statusCode, body };
  };
  const results = await Promise.all([invoke(), invoke()]);
  assert.deepEqual(results.map((result) => result.statusCode).sort(), [200, 409]);
  assert.equal(requestStatus, 'approved');
  assert.equal(commitCount, 1);
  assert.equal(accountWrites.length, 1);
  assert.equal(linkWrites.length, 1);
});

test('incident list binds consent ownership to the actor while date filters keep separate parameters', async () => {
  const priorFlag = process.env.INCIDENT_PHOTOS_ENABLED;
  process.env.INCIDENT_PHOTOS_ENABLED = 'false';
  const cases = [
    { role: 'school_nurse', actorId: 'nurse-id', guardianId: 'guardian-id', start: '', end: '', expectsConsent: true },
    { role: 'school_nurse', actorId: 'nurse-id', guardianId: 'guardian-id', start: '2026-10-01', end: '2026-10-21', expectsConsent: true },
    { role: 'guardian', actorId: 'guardian-id', guardianId: 'guardian-id', start: '', end: '', expectsConsent: true },
    { role: 'guardian', actorId: 'guardian-id', guardianId: 'guardian-id', start: '2026-10-01', end: '2026-10-21', expectsConsent: true },
    { role: 'guardian', actorId: 'other-guardian-id', guardianId: 'guardian-id', start: '', end: '', expectsConsent: false },
  ];
  try {
    for (const scenario of cases) {
      let capturedSql = '';
      let capturedParams = [];
      const app = createApp({ queryFn: async (sql, params) => {
        capturedSql = sql;
        capturedParams = params;
        const ownerParameter = Number(sql.match(/CASE WHEN c\.guardian_user_id=\$(\d+)/)?.[1]) - 1;
        return {
          rows: [{
            id: 'incident-id', patient_id: 'patient-id', display_date: '2026-10-20', display_time: '08:30',
            patient_name: 'Example student', school_id: 'S-001', guardian_user_id: scenario.guardianId,
            consent_status: 'granted', notice_version: 'incident-photo-defense-v1', consent_updated_at: null,
            is_consent_owner: params[ownerParameter] === scenario.guardianId,
          }],
          rowCount: 1,
        };
      } });
      const route = app.router.stack.find((layer) => layer.route?.path === '/api/incidents' && layer.route.methods.get);
      const handler = route.route.stack.at(-1).handle;
      let statusCode = 200;
      let body;
      const response = { status(code) { statusCode = code; return this; }, json(value) { body = value; return this; } };
      const query = { ...(scenario.start ? { start: scenario.start } : {}), ...(scenario.end ? { end: scenario.end } : {}) };
      await handler({ query, user: { id: scenario.actorId, role: scenario.role } }, response);

      assert.equal(statusCode, 200, `${scenario.role} with ${scenario.start ? 'date filters' : 'no date filters'}`);
      assert.match(capturedSql, /CASE WHEN c\.guardian_user_id=\$2 THEN true ELSE false END AS is_consent_owner/);
      assert.match(capturedSql, /\(\$3::date IS NULL OR i\.incident_date >= \$3::date\)/);
      assert.match(capturedSql, /\(\$4::date IS NULL OR i\.incident_date <= \$4::date\)/);
      assert.deepEqual(capturedParams, [scenario.role, scenario.actorId, scenario.start || null, scenario.end || null]);
      assert.equal(Boolean(body.data.incidents[0].photoConsent), scenario.expectsConsent);
    }
  } finally {
    if (priorFlag === undefined) delete process.env.INCIDENT_PHOTOS_ENABLED;
    else process.env.INCIDENT_PHOTOS_ENABLED = priorFlag;
  }
});

test('incident photo reads recheck consent after storage download before streaming bytes', async () => {
  const priorFlag = process.env.INCIDENT_PHOTOS_ENABLED;
  process.env.INCIDENT_PHOTOS_ENABLED = 'true';
  try {
    const incidentId = '00000000-0000-4000-8000-000000000211';
    const photoId = '00000000-0000-4000-8000-000000000212';
    let downloads = 0;
    let sent = null;
    const app = createApp({
      queryFn: async () => ({ rows: [{ id: photoId, incident_id: incidentId, storage_key: `incidents/${incidentId}/${photoId}.png`, content_type: 'image/png', consent_event_id: 'grant-event', granted_event_id: 'grant-event', consent_status: 'granted', expires_at: new Date(Date.now() + 60_000) }], rowCount: 1 }),
      transactionFn: async (work) => work({ query: async (sql) => sql.includes('SELECT p.id FROM incident_photos')
        ? { rows: [], rowCount: 0 } // revocation landed after the storage read
        : { rows: [], rowCount: 1 } }),
      storage: { bucket: 'private', isConfigured: () => true, async download() { downloads += 1; return Buffer.from('image-bytes'); } },
    });
    const route = app.router.stack.find((layer) => layer.route?.path === '/api/incidents/:id/photos/:photoId' && layer.route.methods.get);
    let statusCode = 200;
    let body;
    const response = { status(code) { statusCode = code; return this; }, json(value) { body = value; return this; }, setHeader() {}, send(value) { sent = value; return this; } };
    await route.route.stack.at(-1).handle({ headers: {}, params: { id: incidentId, photoId }, user: { id: 'guardian-id', role: 'guardian' } }, response);
    assert.equal(downloads, 1);
    assert.equal(statusCode, 404);
    assert.equal(body.error.code, 'NOT_FOUND');
    assert.equal(sent, null, 'the downloaded bytes are not sent after consent changes');
  } finally {
    if (priorFlag === undefined) delete process.env.INCIDENT_PHOTOS_ENABLED;
    else process.env.INCIDENT_PHOTOS_ENABLED = priorFlag;
  }
});

test('authorized incident photo streams include CSP, private no-store caching, and MIME sniff protection', async () => {
  const priorFlag = process.env.INCIDENT_PHOTOS_ENABLED;
  process.env.INCIDENT_PHOTOS_ENABLED = 'true';
  try {
    const incidentId = '00000000-0000-4000-8000-000000000311';
    const photoId = '00000000-0000-4000-8000-000000000312';
    const app = createApp({
      queryFn: async () => ({ rows: [{ id: photoId, incident_id: incidentId, storage_key: `incidents/${incidentId}/${photoId}.png`, content_type: 'image/png', consent_event_id: 'grant-event', granted_event_id: 'grant-event', consent_status: 'granted', expires_at: new Date(Date.now() + 60_000) }], rowCount: 1 }),
      transactionFn: async (work) => work({ query: async (sql) => ({ rows: [], rowCount: sql.includes('SELECT p.id FROM incident_photos') ? 1 : 1 }) }),
      storage: { bucket: 'private', isConfigured: () => true, async download() { return Buffer.from('image-bytes'); } },
    });
    const route = app.router.stack.find((layer) => layer.route?.path === '/api/incidents/:id/photos/:photoId' && layer.route.methods.get);
    const headers = new Map();
    let sent;
    const response = { setHeader(name, value) { headers.set(name, value); }, send(value) { sent = value; return this; }, status() { return this; }, json() { return this; } };
    route.route.stack[0].handle({}, response, () => {});
    await route.route.stack.at(-1).handle({ headers: {}, params: { id: incidentId, photoId }, user: { id: 'guardian-id', role: 'guardian' } }, response);
    assert.deepEqual(sent, Buffer.from('image-bytes'));
    assert.equal(headers.get('Content-Security-Policy'), "default-src 'none'; sandbox");
    assert.equal(headers.get('X-Content-Type-Options'), 'nosniff');
    assert.equal(headers.get('Content-Type'), 'image/png');
    assert.equal(headers.get('Content-Disposition'), 'inline');
    assert.equal(headers.get('Cache-Control'), 'private, no-store, max-age=0');
  } finally {
    if (priorFlag === undefined) delete process.env.INCIDENT_PHOTOS_ENABLED;
    else process.env.INCIDENT_PHOTOS_ENABLED = priorFlag;
  }
});

test('incident photo upload keeps its durable orphan task valid before photo metadata exists', async () => {
  const priorFlag = process.env.INCIDENT_PHOTOS_ENABLED;
  process.env.INCIDENT_PHOTOS_ENABLED = 'true';
  try {
    const incidentId = '00000000-0000-4000-8000-000000000411';
    const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const pngChunk = (type, data) => {
      const header = Buffer.alloc(8);
      header.writeUInt32BE(data.length, 0);
      header.write(type, 4, 'ascii');
      return Buffer.concat([header, data, Buffer.alloc(4)]);
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(2, 0);
    header.writeUInt32BE(3, 4);
    header[8] = 8;
    header[9] = 6;
    const image = Buffer.concat([pngSignature, pngChunk('IHDR', header), pngChunk('IDAT', Buffer.from([1, 2, 3])), pngChunk('IEND', Buffer.alloc(0))]);
    const statements = [];
    let uploadArgs;
    let statusCode = 200;
    let responseBody;
    const app = createApp({
      queryFn: async (sql) => {
        statements.push(sql.replace(/\s+/g, ' ').trim());
        return { rows: [{ granted_event_id: 'consent-event' }], rowCount: 1 };
      },
      transactionFn: async (work) => work({ query: async (sql, values = []) => {
        const normalized = sql.replace(/\s+/g, ' ').trim();
        statements.push(normalized);
        if (normalized.startsWith('INSERT INTO incident_photo_deletion_tasks')) {
          assert.match(normalized, /VALUES\(\$1,NULL,\$2/);
          assert.equal(values[1].startsWith(`incidents/${incidentId}/`), true);
          return { rows: [], rowCount: 1 };
        }
        if (normalized.startsWith('SELECT status,granted_event_id FROM incident_photo_consents')) return { rows: [{ status: 'granted', granted_event_id: 'consent-event' }], rowCount: 1 };
        if (normalized.startsWith('SELECT COUNT(*)::int AS total FROM incident_photos')) return { rows: [{ total: 0 }], rowCount: 1 };
        return { rows: [], rowCount: 1 };
      } }),
      storage: { bucket: 'private', isConfigured: () => true, async upload(...args) { uploadArgs = args; } },
    });
    const route = app.router.stack.find((layer) => layer.route?.path === '/api/incidents/:id/photos' && layer.route.methods.post);
    const response = {
      status(code) { statusCode = code; return this; },
      json(value) { responseBody = value; return this; },
    };
    await route.route.stack.at(-1).handle({
      headers: {}, params: { id: incidentId }, body: { contentType: 'image/png', dataBase64: image.toString('base64') },
      user: { id: 'nurse-id', role: 'school_nurse' },
    }, response);
    assert.equal(statusCode, 201);
    assert.equal(responseBody.data.contentType, 'image/png');
    assert.equal(uploadArgs[0], 'private');
    assert.match(uploadArgs[1], new RegExp(`^incidents/${incidentId}/`));
    assert.ok(statements.some((sql) => sql.startsWith('INSERT INTO incident_photos')));
    assert.ok(statements.some((sql) => sql === 'DELETE FROM incident_photo_deletion_tasks WHERE id=$1'));
  } finally {
    if (priorFlag === undefined) delete process.env.INCIDENT_PHOTOS_ENABLED;
    else process.env.INCIDENT_PHOTOS_ENABLED = priorFlag;
  }
});

test('appointment booking waits on a same-day block transaction and returns conflict instead of booking into it', async () => {
  const date = '2030-01-07';
  const appointments = [];
  const periods = [];
  let releaseBlock;
  let lockAcquired;
  const blockLocked = new Promise((resolve) => { lockAcquired = resolve; });
  const holdBlock = new Promise((resolve) => { releaseBlock = resolve; });
  let tail = Promise.resolve();
  let firstLock = true;
  const serializedTransaction = async (work) => {
    let release;
    let ownsLock = false;
    const client = { query: async (sql, params = []) => {
      if (sql.includes('pg_advisory_xact_lock')) {
        const previous = tail;
        tail = new Promise((resolve) => { release = resolve; });
        await previous;
        ownsLock = true;
        if (firstLock) { firstLock = false; lockAcquired(); await holdBlock; }
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('SELECT a.id,a.patient_id')) return { rows: appointments.map((row) => ({ ...row, patient_name: 'Student', student_id: 'S-1' })), rowCount: appointments.length };
      if (sql.includes('SELECT starts_at,status FROM appointments')) return { rows: appointments.map(({ starts_at, status }) => ({ starts_at, status })), rowCount: appointments.length };
      if (sql.includes('SELECT starts_at,ends_at FROM appointment_unavailable_periods')) return { rows: periods.map(({ starts_at, ends_at }) => ({ starts_at, ends_at })), rowCount: periods.length };
      if (sql.includes('SELECT data FROM clinic_settings')) return { rows: [{ data: {} }], rowCount: 1 };
      if (sql.includes('INSERT INTO appointment_unavailable_periods')) {
        periods.push({ starts_at: params[2], ends_at: params[3] });
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO appointments')) {
        appointments.push({ starts_at: params[2], status: params[3] });
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    } };
    try { return await work(client); }
    finally { if (ownsLock) release(); }
  };
  const app = createApp({
    queryFn: async (sql) => sql.includes('SELECT data FROM clinic_settings') ? { rows: [{ data: {} }], rowCount: 1 } : { rows: [], rowCount: 0 },
    transactionFn: serializedTransaction,
    clinicDataTransactionFn: serializedTransaction,
  });
  const blockRoute = app.router.stack.find((layer) => layer.route?.path === '/api/nurse/appointment-unavailable-periods' && layer.route.methods.post);
  const bookingRoute = app.router.stack.find((layer) => layer.route?.path === '/api/appointments' && layer.route.methods.post);
  const invoke = async (handler, req) => {
    let statusCode = 200;
    let body;
    const res = { status(code) { statusCode = code; return this; }, json(value) { body = value; return this; } };
    await handler(req, res);
    return { statusCode, body };
  };
  const blockPromise = invoke(blockRoute.route.stack.at(-1).handle, {
    body: { date, fullDay: false, startTime: '09:00', endTime: '09:30', reason: 'Clinic training' },
    user: { id: 'nurse-id', role: 'school_nurse' }, headers: {}, ip: 'test',
  });
  await blockLocked;
  const bookingPromise = invoke(bookingRoute.route.stack.at(-1).handle, {
    body: { patientId: 'student-1', startsAt: `${date}T09:00:00+08:00`, reason: 'Consultation' },
    user: { id: 'nurse-id', role: 'school_nurse' }, headers: {}, ip: 'test',
  });
  releaseBlock();
  const [blockResult, bookingResult] = await Promise.all([blockPromise, bookingPromise]);
  assert.equal(blockResult.statusCode, 201);
  assert.equal(bookingResult.statusCode, 409);
  assert.equal(bookingResult.body.error.code, 'APPOINTMENT_CONFLICT');
  assert.equal(appointments.length, 0, 'no appointment was inserted into the newly blocked period');
  assert.equal(periods.length, 1);
});
