import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyRiskRuleForm, describeRiskCondition, riskRuleFormFromRule, riskRuleStatusLabel, serializeRiskRuleForm } from './riskRules.js';

function validForm() {
  const form = createEmptyRiskRuleForm();
  return {
    ...form,
    name: 'Pain review draft',
    thresholds: { moderate: '3', high: '7' },
    indicators: [{ field: 'painScore', operator: 'gte', value: '7', weight: '4', label: 'High reported pain' }],
  };
}

test('risk rule form converts readable controls into validated numeric rules', () => {
  assert.deepEqual(serializeRiskRuleForm(validForm()), {
    name: 'Pain review draft',
    rules: {
      requiredFields: ['painScore'],
      thresholds: { moderate: 3, high: 7 },
      indicators: [{ field: 'painScore', operator: 'gte', value: 7, weight: 4, label: 'High reported pain' }],
    },
  });
});

test('risk rule form rejects blank numbers instead of coercing them to zero', () => {
  const blankScoreThreshold = validForm();
  blankScoreThreshold.thresholds.moderate = '';
  assert.throws(() => serializeRiskRuleForm(blankScoreThreshold), /moderate score threshold is required/i);

  const blankConditionThreshold = validForm();
  blankConditionThreshold.indicators[0].value = '';
  assert.throws(() => serializeRiskRuleForm(blankConditionThreshold), /condition 1 threshold is required/i);

  const blankWeight = validForm();
  blankWeight.indicators[0].weight = '';
  assert.throws(() => serializeRiskRuleForm(blankWeight), /condition 1 points is required/i);
});

test('copying a saved score rule retains each overlapping condition and its points', () => {
  const rule = {
    name: 'Example',
    rules: {
      requiredFields: ['painScore'],
      thresholds: { moderate: 3, high: 7 },
      indicators: [
        { field: 'painScore', operator: 'gte', value: 7, weight: 4, label: 'High pain' },
        { field: 'painScore', operator: 'gte', value: 4, weight: 2, label: 'Moderate pain' },
      ],
    },
  };
  const copied = riskRuleFormFromRule(rule);
  assert.equal(copied.name, 'Example copy');
  assert.equal(copied.indicators.length, 2);
  assert.equal(serializeRiskRuleForm(copied).rules.indicators[0].value, 7);
  assert.equal(serializeRiskRuleForm(copied).rules.indicators[1].value, 4);
});

test('special conservative screening rules stay on the immutable candidate workflow', () => {
  assert.equal(riskRuleFormFromRule({ name: 'WHO candidate', rules: { mode: 'conservative_triage_v1' } }), null);
});

test('warning-sign conditions require an explicit yes or no answer', () => {
  const form = validForm();
  form.indicators = [{ field: 'clinicianRedFlag', operator: 'equals', value: null, weight: '10', label: 'Warning sign present' }];
  assert.throws(() => serializeRiskRuleForm(form), /compare the warning-sign answer/i);
  form.indicators[0].value = false;
  assert.equal(serializeRiskRuleForm(form).rules.indicators[0].value, false);
});

test('condition explanation uses readable clinical field names and operators', () => {
  assert.equal(describeRiskCondition({ field: 'temperature', operator: 'lt', value: 36 }), 'Temperature (°C) is below 36');
});

test('risk result labels explain sample and historical test statuses without exposing identifiers', () => {
  assert.equal(riskRuleStatusLabel({ ruleStatus: 'sample' }), 'Sample rules · not approved by a nurse');
  assert.equal(riskRuleStatusLabel({ ruleStatus: 'draft', ruleVersion: 0 }), 'Sample rules · not approved by a nurse');
  assert.equal(riskRuleStatusLabel({ ruleStatus: 'draft', ruleVersion: '0' }), 'Sample rules · not approved by a nurse');
  assert.equal(riskRuleStatusLabel({ ruleStatus: 'draft', ruleVersion: 4 }), 'Custom rules · waiting for nurse approval');
  assert.equal(riskRuleStatusLabel({ ruleStatus: 'draft', ruleVersion: null }), 'Custom rules · waiting for nurse approval');
  assert.equal(riskRuleStatusLabel({ ruleStatus: 'test_active' }), 'Development test · not approved by a nurse');
  assert.equal(riskRuleStatusLabel({ ruleStatus: 'clinician_approved' }), 'Clinician approved');
  assert.equal(riskRuleStatusLabel({ ruleStatus: 'retired' }), 'Retired rules · no longer active');
});
