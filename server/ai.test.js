import test from 'node:test';
import assert from 'node:assert/strict';
import { templateSummary } from './ai.js';

test('template summary excludes patient identity fields', () => {
  const summary = templateSummary({
    patientName: 'Sensitive Name',
    guardianPhone: '+63 900 000 0000',
    type: 'Illness',
    chiefComplaint: 'Headache',
    treatment: 'Rest',
    disposition: 'Returned to class',
  });
  assert.match(summary, /Headache/);
  assert.doesNotMatch(summary, /Sensitive Name/);
  assert.doesNotMatch(summary, /900 000/);
});
