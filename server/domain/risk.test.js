import test from 'node:test';
import assert from 'node:assert/strict';
import { approveDraftRiskRule, assessRisk, ensureConservativeCandidateDraft, getConservativeCandidateRuleDraft, getDemonstrationRules, riskAllowsAcknowledgedIncomplete, riskNeedsNurseAcknowledgement, validateRiskRules } from './risk.js';

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
        if (sql.includes("pg_advisory_xact_lock(hashtext('risk-rule-conservative-candidate'))")) {
          const previous = shared.lockTail;
          shared.lockTail = new Promise((resolve) => { releaseLock = resolve; });
          await previous;
          return { rows: [] };
        }
        if (sql.includes("WHERE rules->>'mode'=$1")) {
          const matches = shared.rules.filter((rule) => rule.rules.mode === params[0]).sort((a, b) => b.version - a.version);
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
