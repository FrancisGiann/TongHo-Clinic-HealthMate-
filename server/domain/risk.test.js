import test from 'node:test';
import assert from 'node:assert/strict';
import { activateRiskRuleForTesting, approveDraftRiskRule, assessRisk, createRiskRuleDraft, disableRiskRuleTesting, ensureConservativeCandidateDraft, getConservativeCandidateRuleDraft, getDemonstrationRules, readTestRiskRuleActivation, riskAllowsAcknowledgedIncomplete, riskNeedsNurseAcknowledgement, selectRiskRules, validateRiskRules } from './risk.js';

function testActivationClient({ active = null, includeApproved = false, shared: existingState = null } = {}) {
  const shared = existingState || {
    settings: { schoolName: 'Test Clinic', testRiskRuleActivation: active },
    updates: 0,
    lockTail: Promise.resolve(),
    rules: [
      { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', version: 9, name: 'Conservative draft', status: 'draft', approved_by: null, approved_at: null, rules: getConservativeCandidateRuleDraft().rules },
      ...(includeApproved ? [{ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', version: 8, name: 'Approved legacy', status: 'clinician_approved', rules: getDemonstrationRules() }] : []),
    ],
  };
  let releaseLock;
  const client = {
    async query(sql, params = []) {
      if (sql.includes("pg_advisory_xact_lock(hashtext('risk-rule-test-activation'))")) {
        const previous = shared.lockTail;
        shared.lockTail = new Promise((resolve) => { releaseLock = resolve; });
        await previous;
        return { rows: [] };
      }
      if (sql.includes('SELECT data FROM clinic_settings WHERE id=1')) {
        return { rowCount: 1, rows: [{ data: structuredClone(shared.settings) }] };
      }
      if (sql.includes('SELECT data FROM clinic_settings WHERE id=1 FOR UPDATE')) {
        return { rowCount: 1, rows: [{ data: structuredClone(shared.settings) }] };
      }
      if (sql.startsWith('SELECT id,version,name,status,rules FROM risk_rules')) {
        const rule = shared.rules.find((item) => item.id === params[0]);
        return { rowCount: rule ? 1 : 0, rows: rule ? [structuredClone(rule)] : [] };
      }
      if (sql.startsWith('SELECT id,status,rules FROM risk_rules')) {
        const rule = shared.rules.find((item) => item.id === params[0]);
        return { rowCount: rule ? 1 : 0, rows: rule ? [structuredClone(rule)] : [] };
      }
      if (sql.startsWith('SELECT version,name,status,rules FROM risk_rules')) {
        const rule = shared.rules.find((item) => item.status === 'clinician_approved');
        return { rowCount: rule ? 1 : 0, rows: rule ? [structuredClone(rule)] : [] };
      }
      if (sql.startsWith('UPDATE clinic_settings SET data=')) {
        shared.settings = JSON.parse(params[0]);
        shared.updates += 1;
        return { rowCount: 1, rows: [] };
      }
      throw new Error(`Unexpected test activation query: ${sql}`);
    },
    finishTransaction() { releaseLock?.(); releaseLock = null; },
  };
  return { client, shared };
}

async function inMockTransaction(client, operation) {
  try { return await operation(); }
  finally { client.finishTransaction(); }
}

test('risk assessment stays incomplete when pain score is missing', () => {
  const result = assessRisk({ recentVisitCount: 0 }, getDemonstrationRules());
  assert.equal(result.status, 'incomplete');
  assert.equal(result.category, 'unclassified');
  assert.ok(result.missingFields.includes('painScore'));
});

test('risk assessment rejects pain scores outside 1–10', () => {
  const result = assessRisk({ painScore: 11 }, getDemonstrationRules());
  assert.equal(result.status, 'incomplete');
  assert.ok(result.missingFields.includes('validPainScore'));
});

test('clinician red flag produces an urgent demonstration result', () => {
  const result = assessRisk({ painScore: 2, clinicianRedFlag: true, recentVisitCount: 0 }, getDemonstrationRules());
  assert.equal(result.status, 'complete');
  assert.equal(result.category, 'high');
  assert.equal(result.priority, 'urgent');
  assert.match(result.disclaimer, /not a diagnosis/i);
});

test('rule engine uses the supplied approved rule version', () => {
  const result = assessRisk(
    { painScore: 5 },
    { version: 3, status: 'clinician_approved', requiredFields: ['painScore'], thresholds: { moderate: 2, high: 5 }, indicators: [{ field: 'painScore', operator: 'gte', value: 5, weight: 5, label: 'Approved indicator' }] },
  );
  assert.equal(result.ruleVersion, 3);
  assert.equal(result.ruleStatus, 'clinician_approved');
  assert.equal(result.category, 'high');
});

test('risk rule validator accepts a bounded supported rule set', () => {
  const rules = getDemonstrationRules();
  assert.deepEqual(validateRiskRules(rules), { valid: true });
});

test('risk rule validator rejects blank or nonnumeric values while retaining numeric-string compatibility', () => {
  const blankThreshold = getDemonstrationRules();
  blankThreshold.thresholds.moderate = '';
  assert.equal(validateRiskRules(blankThreshold).valid, false);

  const numericStringThreshold = getDemonstrationRules();
  numericStringThreshold.thresholds.moderate = '3';
  assert.equal(validateRiskRules(numericStringThreshold).valid, true);

  const booleanThreshold = getDemonstrationRules();
  booleanThreshold.thresholds.moderate = false;
  assert.equal(validateRiskRules(booleanThreshold).valid, false);

  const arrayThreshold = getDemonstrationRules();
  arrayThreshold.thresholds.moderate = [];
  assert.equal(validateRiskRules(arrayThreshold).valid, false);

  const blankIndicator = getDemonstrationRules();
  blankIndicator.indicators[1].value = '';
  assert.equal(validateRiskRules(blankIndicator).valid, false);

  const numericStringWeight = getDemonstrationRules();
  numericStringWeight.indicators[0].weight = '10';
  assert.equal(validateRiskRules(numericStringWeight).valid, true);

  const booleanWeight = getDemonstrationRules();
  booleanWeight.indicators[0].weight = true;
  assert.equal(validateRiskRules(booleanWeight).valid, false);
});

test('overlapping score conditions continue to add each matching weight', () => {
  const rules = getDemonstrationRules();
  const result = assessRisk({ painScore: 8, clinicianRedFlag: false, recentVisitCount: 3 }, rules);
  assert.equal(result.total, 8);
  assert.deepEqual(result.components.map((item) => item.label), ['High reported pain', 'Moderate reported pain', 'Recurring clinic visits']);
});

test('missing optional numeric measurements never match zero-valued thresholds', () => {
  const rules = {
    requiredFields: ['painScore'],
    thresholds: { moderate: 3, high: 7 },
    indicators: [
      { field: 'painScore', operator: 'gte', value: 1, weight: 1, label: 'Pain recorded' },
      { field: 'recentVisitCount', operator: 'lte', value: 0, weight: 2, label: 'No recurring visits' },
    ],
  };
  for (const recentVisitCount of [undefined, null, '']) {
    const result = assessRisk({ painScore: 2, recentVisitCount }, rules);
    assert.equal(result.total, 1);
    assert.deepEqual(result.components.map((item) => item.label), ['Pain recorded']);
  }
});

test('required numeric and boolean rule inputs reject malformed values with review status', () => {
  const rules = {
    requiredFields: ['temperature', 'clinicianRedFlag'],
    thresholds: { moderate: 3, high: 7 },
    indicators: [{ field: 'temperature', operator: 'gte', value: 36, weight: 1, label: 'Temperature recorded' }],
  };
  for (const temperature of ['   ', false, []]) {
    const result = assessRisk({ temperature, clinicianRedFlag: false }, rules);
    assert.equal(result.status, 'incomplete');
    assert.equal(result.priority, 'requires-review');
    assert.ok(result.missingFields.includes(temperature === '   ' ? 'temperature' : 'validTemperature'));
  }
  for (const clinicianRedFlag of ['false', [], 0]) {
    const result = assessRisk({ temperature: 37, clinicianRedFlag }, rules);
    assert.equal(result.status, 'incomplete');
    assert.ok(result.missingFields.includes('validClinicianRedFlag'));
  }
});

test('conservative candidate is valid and cannot be changed to remove its review behavior or source cutoffs', () => {
  const rules = getConservativeCandidateRuleDraft().rules;
  assert.deepEqual(validateRiskRules(rules), { valid: true });

  const noReview = structuredClone(rules);
  noReview.requireReviewOnNoMatch = false;
  assert.equal(validateRiskRules(noReview).valid, false);

  const changedBoundary = structuredClone(rules);
  changedBoundary.indicators.find((item) => item.field === 'temperature' && item.operator === 'lt').value = 35;
  assert.equal(validateRiskRules(changedBoundary).valid, false);
});

test('candidate draft creation atomically selects the next version and is idempotent', async () => {
  const shared = {
    rules: [{ id: 'existing-rule', version: 8, name: 'Existing version', rules: { indicators: [] }, status: 'clinician_approved' }],
    lockTail: Promise.resolve(),
  };
  const makeClient = () => {
    let releaseLock;
    return {
      async query(sql, params = []) {
        if (sql.includes("pg_advisory_xact_lock(hashtext('risk-rule-version'))")) {
          const previous = shared.lockTail;
          shared.lockTail = new Promise((resolve) => { releaseLock = resolve; });
          await previous;
          return { rows: [] };
        }
        if (sql.includes("WHERE rules->>'mode'=$1")) {
          const matches = shared.rules.filter((rule) => rule.rules.mode === params[0] && rule.status !== 'retired').sort((a, b) => b.version - a.version);
          return matches.length ? { rowCount: 1, rows: [{ id: matches[0].id, version: matches[0].version, name: matches[0].name, status: matches[0].status }] } : { rowCount: 0, rows: [] };
        }
        if (sql.includes('SELECT COALESCE(MAX(version),0)::int AS version FROM risk_rules')) {
          return { rowCount: 1, rows: [{ version: Math.max(0, ...shared.rules.map((rule) => rule.version)) }] };
        }
        if (sql.startsWith('INSERT INTO risk_rules')) {
          const [id, version, name, rulesJson] = params;
          const rule = { id, version, name, rules: JSON.parse(rulesJson), status: 'draft' };
          shared.rules.push(rule);
          return { rowCount: 1, rows: [] };
        }
        throw new Error(`Unexpected candidate draft query: ${sql}`);
      },
      release() { releaseLock?.(); },
    };
  };
  const create = async () => {
    const client = makeClient();
    try { return await ensureConservativeCandidateDraft(client); }
    finally { client.release(); }
  };

  const results = await Promise.all([create(), create()]);
  assert.equal(results.filter((result) => result.created).length, 1);
  assert.equal(results[0].id, results[1].id);
  assert.equal(results[0].version, 9);
  const candidateRows = shared.rules.filter((rule) => rule.rules.mode === 'conservative_triage_v1');
  assert.equal(candidateRows.length, 1);
  assert.equal(candidateRows[0].status, 'draft');
  assert.equal(candidateRows[0].name, 'WHO IITT-informed partial screening (draft)');

  const repeated = await create();
  assert.equal(repeated.created, false);
  assert.equal(repeated.id, results[0].id);
  assert.equal(shared.rules.filter((rule) => rule.rules.mode === 'conservative_triage_v1').length, 1);
});

test('retired conservative candidate can be recreated as a new draft version', async () => {
  const shared = {
    rules: [{ id: 'old-candidate', version: 8, name: 'Old candidate', rules: getConservativeCandidateRuleDraft().rules, status: 'retired' }],
    lockTail: Promise.resolve(),
  };
  let releaseLock;
  const client = {
    async query(sql, params = []) {
      if (sql.includes("pg_advisory_xact_lock(hashtext('risk-rule-version'))")) {
        const previous = shared.lockTail;
        shared.lockTail = new Promise((resolve) => { releaseLock = resolve; });
        await previous;
        return { rows: [] };
      }
      if (sql.includes("WHERE rules->>'mode'=$1")) return { rowCount: 0, rows: [] };
      if (sql.includes('SELECT COALESCE(MAX(version),0)::int AS version FROM risk_rules')) return { rowCount: 1, rows: [{ version: 8 }] };
      if (sql.startsWith('INSERT INTO risk_rules')) {
        const [id, version, name, rulesJson] = params;
        shared.rules.push({ id, version, name, rules: JSON.parse(rulesJson), status: 'draft' });
        return { rowCount: 1, rows: [] };
      }
      throw new Error(`Unexpected retired candidate query: ${sql}`);
    },
    release() { releaseLock?.(); },
  };
  const draft = await (async () => {
    try { return await ensureConservativeCandidateDraft(client); }
    finally { client.release(); }
  })();
  assert.equal(draft.created, true);
  assert.equal(draft.version, 9);
  assert.equal(draft.status, 'draft');
  assert.equal(shared.rules.length, 2);
});

test('concurrent new drafts receive distinct automatically assigned versions', async () => {
  const shared = { rules: [{ id: 'old', version: 3 }], lockTail: Promise.resolve() };
  const makeClient = () => {
    let releaseLock;
    return {
      async query(sql, params = []) {
        if (sql.includes("pg_advisory_xact_lock(hashtext('risk-rule-version'))")) {
          const previous = shared.lockTail;
          shared.lockTail = new Promise((resolve) => { releaseLock = resolve; });
          await previous;
          return { rows: [] };
        }
        if (sql.includes('SELECT COALESCE(MAX(version),0)::int AS version FROM risk_rules')) {
          return { rowCount: 1, rows: [{ version: Math.max(...shared.rules.map((rule) => rule.version)) }] };
        }
        if (sql.startsWith('INSERT INTO risk_rules')) {
          const [id, version, name, rulesJson] = params;
          shared.rules.push({ id, version, name, rules: JSON.parse(rulesJson), status: 'draft' });
          return { rowCount: 1, rows: [] };
        }
        throw new Error(`Unexpected draft creation query: ${sql}`);
      },
      release() { releaseLock?.(); },
    };
  };
  const create = async (name) => {
    const client = makeClient();
    try { return await createRiskRuleDraft(client, { name, rules: getDemonstrationRules() }); }
    finally { client.release(); }
  };
  const drafts = await Promise.all([create('Nurse draft A'), create('Nurse draft B')]);
  assert.deepEqual(drafts.map((draft) => draft.version).sort(), [4, 5]);
  assert.ok(drafts.every((draft) => draft.status === 'draft'));
});

test('candidate temperature indicators use strict WHO boundaries and always require nurse review', () => {
  const rules = getConservativeCandidateRuleDraft().rules;
  for (const temperature of [35.9, 39.1]) {
    const result = assessRisk({ temperature, clinicianRedFlag: false }, rules);
    assert.equal(result.category, 'unclassified');
    assert.equal(result.priority, 'requires-review');
    assert.equal(result.status, 'complete');
    assert.equal(result.components.length, 1);
    assert.equal(riskNeedsNurseAcknowledgement(result), true);
  }

  for (const temperature of [36, 39]) {
    const result = assessRisk({ temperature, clinicianRedFlag: false }, rules);
    assert.equal(result.status, 'review_required');
    assert.equal(result.category, 'unclassified');
    assert.equal(result.priority, 'requires-review');
    assert.deepEqual(result.components, []);
    assert.match(result.rationale, /no-match does not mean low risk/i);
  }
});

test('candidate clinician warning sign is urgent and remains visible when temperature is missing', () => {
  const assessed = assessRisk({ temperature: 37, clinicianRedFlag: true }, getConservativeCandidateRuleDraft().rules);
  assert.equal(assessed.category, 'high');
  assert.equal(assessed.priority, 'urgent');
  assert.equal(assessed.status, 'complete');

  const result = assessRisk({ clinicianRedFlag: true }, getConservativeCandidateRuleDraft().rules);
  assert.equal(result.status, 'incomplete');
  assert.equal(result.category, 'high');
  assert.equal(result.priority, 'urgent');
  assert.ok(result.missingFields.includes('temperature'));
  assert.equal(riskNeedsNurseAcknowledgement(result), true);
  assert.equal(riskAllowsAcknowledgedIncomplete(result), true);
});

test('candidate missing and invalid clinical inputs require review', () => {
  const rules = getConservativeCandidateRuleDraft().rules;
  const missing = assessRisk({ temperature: null, clinicianRedFlag: false }, rules);
  assert.equal(missing.status, 'incomplete');
  assert.equal(missing.priority, 'requires-review');
  assert.ok(missing.missingFields.includes('temperature'));
  assert.deepEqual(missing.components, []);

  const invalid = assessRisk({ temperature: 'not-a-temperature', clinicianRedFlag: 'false' }, rules);
  assert.equal(invalid.status, 'incomplete');
  assert.ok(invalid.missingFields.includes('validTemperature'));
  assert.ok(invalid.missingFields.includes('validClinicianRedFlag'));
  assert.deepEqual(invalid.components, []);
  assert.equal(riskAllowsAcknowledgedIncomplete(invalid), false);

  const outOfRange = assessRisk({ temperature: 99, clinicianRedFlag: false }, rules);
  assert.equal(outOfRange.status, 'incomplete');
  assert.deepEqual(outOfRange.components, []);

  const unanswered = assessRisk({ temperature: 37, clinicianRedFlag: null }, rules);
  assert.equal(unanswered.status, 'incomplete');
  assert.ok(unanswered.missingFields.includes('clinicianRedFlag'));
  assert.match(unanswered.rationale, /warning-sign screen is unanswered/i);
  assert.equal(riskAllowsAcknowledgedIncomplete(unanswered), false);

  const onlyTemperatureMissing = assessRisk({ temperature: null, clinicianRedFlag: false }, rules);
  assert.equal(riskAllowsAcknowledgedIncomplete(onlyTemperatureMissing), true);
});

test('version-0 demonstration no-match behavior remains low and routine', () => {
  const result = assessRisk({ painScore: 1, clinicianRedFlag: null, recentVisitCount: 0 }, getDemonstrationRules());
  assert.equal(result.ruleVersion, 0);
  assert.equal(result.ruleStatus, 'draft');
  assert.equal(result.status, 'complete');
  assert.equal(result.category, 'low');
  assert.equal(result.priority, 'routine');
});

test('development test activation keeps a candidate draft and is idempotent', async () => {
  const { client, shared } = testActivationClient();
  const ruleId = shared.rules[0].id;
  const first = await inMockTransaction(client, () => activateRiskRuleForTesting(client, ruleId, 'development'));
  const repeated = await inMockTransaction(client, () => activateRiskRuleForTesting(client, ruleId, 'development'));

  assert.equal(first.changed, true);
  assert.equal(repeated.changed, false);
  assert.equal(shared.updates, 1);
  assert.equal(shared.settings.schoolName, 'Test Clinic');
  assert.equal(shared.settings.testRiskRuleActivation.ruleId, ruleId);
  assert.equal(Object.hasOwn(shared.settings.testRiskRuleActivation, 'activatedBy'), false);
  assert.equal(shared.rules[0].status, 'draft');
  assert.equal(shared.rules[0].approved_by, null);
  assert.equal(shared.rules[0].approved_at, null);
});

test('risk selection marks development test results and ignores activation outside development', async () => {
  const activation = { ruleId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', activatedAt: '2026-09-28T00:00:00.000Z' };
  const { client, shared } = testActivationClient({ active: activation, includeApproved: true });
  const developmentRules = await selectRiskRules(client, 'development');
  const developmentResult = assessRisk({ temperature: 37, clinicianRedFlag: false }, developmentRules);
  assert.equal(developmentResult.ruleVersion, 9);
  assert.equal(developmentResult.ruleStatus, 'test_active');
  assert.equal(shared.rules[0].status, 'draft');
  assert.equal(shared.rules[0].approved_by, null);

  const productionRules = await selectRiskRules(client, 'production');
  const productionResult = assessRisk({ painScore: 5 }, productionRules);
  assert.equal(productionResult.ruleVersion, 8);
  assert.equal(productionResult.ruleStatus, 'clinician_approved');
});

test('production keeps the legacy demonstration fallback when no approved rule exists', async () => {
  const activation = { ruleId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
  const { client, shared } = testActivationClient({ active: activation });
  const rules = await selectRiskRules(client, 'production');
  const result = assessRisk({ painScore: 1, recentVisitCount: 0 }, rules);

  assert.equal(result.ruleVersion, 0);
  assert.equal(result.ruleStatus, 'draft');
  assert.equal(result.category, 'low');
  assert.equal(result.priority, 'routine');
  assert.equal(shared.rules[0].status, 'draft');
});

test('production cannot activate test rules and invalid drafts are rejected', async () => {
  const { client, shared } = testActivationClient();
  await assert.rejects(
    inMockTransaction(client, () => activateRiskRuleForTesting(client, shared.rules[0].id, 'production')),
    (error) => error.status === 404 && error.code === 'NOT_FOUND',
  );
  const normalDraft = { ...shared.rules[0], id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', rules: getDemonstrationRules() };
  shared.rules.push(normalDraft);
  await assert.rejects(
    inMockTransaction(client, () => activateRiskRuleForTesting(client, normalDraft.id, 'development')),
    (error) => error.status === 409 && error.code === 'RULE_NOT_ELIGIBLE_FOR_TESTING',
  );
  assert.equal(shared.settings.testRiskRuleActivation, null);
  assert.equal(shared.rules[0].approved_by, null);
});

test('disable clears only test activation and is idempotent', async () => {
  const activation = { ruleId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', activatedAt: '2026-09-28T00:00:00.000Z' };
  const { client, shared } = testActivationClient({ active: activation });
  const visible = await readTestRiskRuleActivation(client, 'development');
  assert.deepEqual(visible, activation);

  const disabled = await inMockTransaction(client, () => disableRiskRuleTesting(client, 'development'));
  const repeated = await inMockTransaction(client, () => disableRiskRuleTesting(client, 'development'));
  assert.equal(disabled.changed, true);
  assert.equal(disabled.ruleId, activation.ruleId);
  assert.equal(repeated.changed, false);
  assert.equal(shared.settings.schoolName, 'Test Clinic');
  assert.equal(Object.hasOwn(shared.settings, 'testRiskRuleActivation'), false);
  assert.equal(shared.rules[0].status, 'draft');
  assert.equal(shared.updates, 1);
});

test('concurrent test activations serialize and write one activation', async () => {
  const { shared } = testActivationClient();
  const ruleId = shared.rules[0].id;
  const clients = [testActivationClient({ shared }), testActivationClient({ shared })];
  const results = await Promise.all(clients.map(({ client }) => inMockTransaction(client, () => activateRiskRuleForTesting(client, ruleId, 'development'))));

  assert.equal(results.filter((result) => result.changed).length, 1);
  assert.equal(shared.updates, 1);
  assert.equal(shared.settings.testRiskRuleActivation.ruleId, ruleId);
  assert.equal(shared.rules[0].status, 'draft');
});

test('risk rule validator rejects unsupported fields and non-monotonic thresholds', () => {
  const unsupported = getDemonstrationRules();
  unsupported.indicators[0].field = 'diagnosis';
  assert.equal(validateRiskRules(unsupported).valid, false);
  const thresholds = getDemonstrationRules();
  thresholds.thresholds = { moderate: 8, high: 4 };
  assert.equal(validateRiskRules(thresholds).valid, false);
});

test('concurrent approvals of one draft serialize and only one request succeeds', async () => {
  const shared = {
    rules: {
      'draft-1': { id: 'draft-1', version: 4, status: 'draft', rules: getDemonstrationRules(), approved_by: null },
      'old-1': { id: 'old-1', version: 3, status: 'clinician_approved', rules: getDemonstrationRules(), approved_by: 'nurse-old' },
    },
    lockTail: Promise.resolve(),
  };
  const makeClient = () => {
    let releaseLock;
    return {
      async query(sql, params = []) {
        if (sql.includes('pg_advisory_xact_lock')) {
          const previous = shared.lockTail;
          shared.lockTail = new Promise((resolve) => { releaseLock = resolve; });
          await previous;
          return { rows: [] };
        }
        if (/SELECT id,version,status,rules FROM risk_rules/.test(sql)) {
          const rule = shared.rules[params[0]];
          return rule ? { rowCount: 1, rows: [{ ...rule }] } : { rowCount: 0, rows: [] };
        }
        if (/UPDATE risk_rules SET status='retired'/.test(sql)) {
          for (const rule of Object.values(shared.rules)) if (rule.status === 'clinician_approved') rule.status = 'retired';
          return { rowCount: 1, rows: [] };
        }
        if (/UPDATE risk_rules SET status='clinician_approved'/.test(sql)) {
          const rule = shared.rules[params[1]];
          if (!rule || rule.status !== 'draft') return { rowCount: 0, rows: [] };
          rule.status = 'clinician_approved';
          rule.approved_by = params[0];
          return { rowCount: 1, rows: [{ id: rule.id, version: rule.version, status: rule.status }] };
        }
        throw new Error(`Unexpected risk approval query: ${sql}`);
      },
      release() { releaseLock?.(); },
    };
  };
  const attempt = async (approverId) => {
    const client = makeClient();
    try { return await approveDraftRiskRule(client, 'draft-1', approverId); }
    finally { client.release(); }
  };
  const results = await Promise.allSettled([attempt('nurse-a'), attempt('nurse-b')]);

  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const rejected = results.find((result) => result.status === 'rejected');
  assert.equal(rejected.reason.code, 'RULE_NOT_DRAFT');
  assert.equal(shared.rules['draft-1'].status, 'clinician_approved');
  assert.ok(['nurse-a', 'nurse-b'].includes(shared.rules['draft-1'].approved_by));
  assert.equal(Object.values(shared.rules).filter((rule) => rule.status === 'clinician_approved').length, 1);
});
