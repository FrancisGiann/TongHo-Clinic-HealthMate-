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

test('risk-rule test activation is available to nurses and administrators behind dedicated routes', async () => {
  const app = createApp();
  const routes = app.router.stack
    .filter((layer) => ['/api/risk/rules/:id/test-activation', '/api/risk/rules/test-activation'].includes(layer.route?.path))
    .map((layer) => ({ path: layer.route.path, method: Object.keys(layer.route.methods)[0], guard: layer.route.stack[0].handle, handler: layer.route.stack.at(-1).handle }));
  assert.deepEqual(routes.map(({ path, method }) => [path, method]), [
    ['/api/risk/rules/:id/test-activation', 'put'],
    ['/api/risk/rules/test-activation', 'delete'],
  ]);
  for (const route of routes) {
    const invokeGuard = (role) => {
      let statusCode = 200;
      let nextCalled = false;
      const response = { status(code) { statusCode = code; return { json: () => response }; } };
      route.guard({ user: { role } }, response, () => { nextCalled = true; });
      return { statusCode, nextCalled };
    };
    assert.deepEqual(invokeGuard('school_nurse'), { statusCode: 200, nextCalled: true });
    assert.deepEqual(invokeGuard('system_administrator'), { statusCode: 200, nextCalled: true });
    assert.deepEqual(invokeGuard('student'), { statusCode: 403, nextCalled: false });
  }

  const configuredNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    for (const route of routes) {
      let statusCode = 200;
      let responseBody;
      const response = {
        status(code) { statusCode = code; return this; },
        json(body) { responseBody = body; return this; },
      };
      await route.handler({ params: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }, user: { id: 'nurse-test' } }, response);
      assert.equal(statusCode, 404);
      assert.equal(responseBody.error.code, 'NOT_FOUND');
    }
  } finally {
    if (configuredNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = configuredNodeEnv;
  }
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
