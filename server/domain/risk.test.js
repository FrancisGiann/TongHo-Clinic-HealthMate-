import test from 'node:test';
import assert from 'node:assert/strict';
import { approveDraftRiskRule, assessRisk, getDemonstrationRules, validateRiskRules } from './risk.js';

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
