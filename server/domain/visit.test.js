import test from 'node:test';
import assert from 'node:assert/strict';
import { queueStatusConflict, riskPriority, sortQueueEntries, validateQueueTriage, validateVisitPayload, visitRiskInput } from './visit.js';

const validVisit = {
  patientId: 'student-17',
  visitType: 'Illness',
  chiefComplaint: 'Headache',
  treatment: 'Rest and hydration',
  disposition: 'Returned to class',
  painScore: 5,
};

test('visit validation normalizes valid inputs without trusting client risk metadata', () => {
  const result = validateVisitPayload({ ...validVisit, recentVisitCount: 999, riskAssessment: { category: 'high' }, followUp: true, followUpDate: '2026-09-01' }, { now: new Date('2026-08-15T00:00:00.000Z') });
  assert.equal(result.valid, true);
  assert.equal(result.value.patientId, 'student-17');
  assert.equal(result.value.followUp, true);
  assert.equal('recentVisitCount' in result.value, false);
  assert.equal('riskAssessment' in result.value, false);
  assert.deepEqual(visitRiskInput(result.value, 2), {
    painScore: 5,
    clinicianRedFlag: false,
    recentVisitCount: 2,
    temperature: null,
    pulse: null,
  });
});

test('visit validation rejects missing patient, invalid pain and unsafe dispense quantities', () => {
  const result = validateVisitPayload({ ...validVisit, patientId: '', painScore: 11, medicineId: 'med-1', medicineQuantity: 0 });
  assert.equal(result.valid, false);
  assert.ok(result.fields.patientId);
  assert.ok(result.fields.painScore);
  assert.ok(result.fields.medicineQuantity);
});

test('scheduled follow-up requires a real clinic date today or later and no date is stored otherwise', () => {
  const now = new Date('2026-08-15T17:00:00.000Z'); // August 16 in Asia/Manila
  const missing = validateVisitPayload({ ...validVisit, followUp: true }, { now });
  assert.equal(missing.valid, false);
  assert.ok(missing.fields.followUpDate);

  const past = validateVisitPayload({ ...validVisit, followUp: true, followUpDate: '2026-08-15' }, { now });
  assert.equal(past.valid, false);
  assert.match(past.fields.followUpDate, /today or later/);

  const invalid = validateVisitPayload({ ...validVisit, followUp: true, followUpDate: '2026-02-30' }, { now });
  assert.equal(invalid.valid, false);

  const today = validateVisitPayload({ ...validVisit, followUp: true, followUpDate: '2026-08-16' }, { now });
  assert.equal(today.valid, true);
  assert.equal(today.value.followUpDate, '2026-08-16');

  const notScheduled = validateVisitPayload({ ...validVisit, followUp: false }, { now });
  assert.equal(notScheduled.valid, true);
  assert.equal(Object.hasOwn(notScheduled.value, 'followUpDate'), false);
  const staleDate = validateVisitPayload({ ...validVisit, followUp: false, followUpDate: '2026-08-20' }, { now });
  assert.equal(staleDate.valid, false);
});

test('queue prioritizes urgency before arrival and preserves FIFO within priority', () => {
  const sorted = sortQueueEntries([
    { id: 'late-urgent', priority: 3, arrivalAt: '2026-04-01T09:20:00Z' },
    { id: 'first-routine', priority: 1, arrivalAt: '2026-04-01T08:00:00Z' },
    { id: 'early-urgent', priority: 3, arrivalAt: '2026-04-01T09:00:00Z' },
  ]);
  assert.deepEqual(sorted.map((entry) => entry.id), ['early-urgent', 'late-urgent', 'first-routine']);
  assert.deepEqual([riskPriority('high'), riskPriority('moderate'), riskPriority('low'), riskPriority('other')], [3, 2, 1, 0]);
});

test('reopening a released queue entry is rejected when another active entry exists', () => {
  assert.equal(queueStatusConflict('Released', 'Waiting', true), true);
  assert.equal(queueStatusConflict('Released', 'Released', true), false);
  assert.equal(queueStatusConflict('Released', 'Waiting', false), false);
});

test('queue triage requires a nurse reason for classified priorities', () => {
  assert.equal(validateQueueTriage({ triagePriority: 'unclassified' }).valid, true);
  assert.equal(validateQueueTriage({ triagePriority: 'high' }).valid, false);
  assert.equal(validateQueueTriage({ triagePriority: 'high', triageReason: 'Observed urgent warning sign' }).value.prioritySource, 'nurse_triage');
  assert.equal(validateQueueTriage({ triagePriority: 'low', triageReason: 'x'.repeat(241) }).valid, false);
});
