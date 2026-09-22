import test from 'node:test';
import assert from 'node:assert/strict';
import { assessRisk, getDemonstrationRules } from './risk.js';

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
