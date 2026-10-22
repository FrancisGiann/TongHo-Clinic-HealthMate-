import test from 'node:test';
import assert from 'node:assert/strict';
import { clinicCalendarDate, validateVisitPayload, visitRiskInput } from './visit.js';

const validVisit = {
  patientId: 'student-17',
  visitType: 'Illness',
  chiefComplaint: 'Headache',
  treatment: 'Rest and hydration',
  disposition: 'Returned to class',
  painScore: 5,
};

test('visit calendar dates follow the Asia/Manila day across UTC midnight boundaries', () => {
  assert.equal(clinicCalendarDate(new Date('2026-09-22T15:59:59.000Z')), '2026-09-22');
  assert.equal(clinicCalendarDate(new Date('2026-09-22T16:00:00.000Z')), '2026-09-23');
});

test('visit validation normalizes valid inputs without trusting client risk metadata', () => {
  const result = validateVisitPayload({ ...validVisit, recentVisitCount: 999, riskAssessment: { category: 'high' }, followUp: true, followUpDate: '2026-09-01' }, { now: new Date('2026-08-15T00:00:00.000Z') });
  assert.equal(result.valid, true);
  assert.equal(result.value.patientId, 'student-17');
  assert.equal(result.value.followUp, true);
  assert.equal(result.value.clinicianRedFlagAssessed, false);
  assert.equal('recentVisitCount' in result.value, false);
  assert.equal('riskAssessment' in result.value, false);
  assert.deepEqual(visitRiskInput(result.value, 2), {
    painScore: 5,
    clinicianRedFlag: null,
    recentVisitCount: 2,
    temperature: null,
    pulse: null,
  });
});

test('visit validation distinguishes an unanswered warning-sign screen from an assessed negative screen', () => {
  const unanswered = validateVisitPayload({ ...validVisit, clinicianRedFlag: null, clinicianRedFlagAssessed: false });
  assert.equal(unanswered.valid, true);
  assert.equal(unanswered.value.clinicianRedFlag, false);
  assert.equal(unanswered.value.clinicianRedFlagAssessed, false);
  assert.equal(visitRiskInput(unanswered.value, 0).clinicianRedFlag, null);

  const assessedNegative = validateVisitPayload({ ...validVisit, clinicianRedFlag: false, clinicianRedFlagAssessed: true });
  assert.equal(assessedNegative.valid, true);
  assert.equal(visitRiskInput(assessedNegative.value, 0).clinicianRedFlag, false);

  const contradictory = validateVisitPayload({ ...validVisit, clinicianRedFlag: true, clinicianRedFlagAssessed: false });
  assert.equal(contradictory.valid, false);
  assert.ok(contradictory.fields.clinicianRedFlagAssessed);

  const malformedFlag = validateVisitPayload({ ...validVisit, clinicianRedFlag: 'no' });
  assert.equal(malformedFlag.valid, false);
  assert.ok(malformedFlag.fields.clinicianRedFlag);

  const malformedAssessment = validateVisitPayload({ ...validVisit, clinicianRedFlag: false, clinicianRedFlagAssessed: 'false' });
  assert.equal(malformedAssessment.valid, false);
  assert.ok(malformedAssessment.fields.clinicianRedFlagAssessed);

  const assessedWithoutAnswer = validateVisitPayload({ ...validVisit, clinicianRedFlagAssessed: true });
  assert.equal(assessedWithoutAnswer.valid, false);
  assert.ok(assessedWithoutAnswer.fields.clinicianRedFlag);
});

test('visit validation rejects missing patient, invalid pain and unsafe dispense quantities', () => {
  const result = validateVisitPayload({ ...validVisit, patientId: '', painScore: 11, medicineId: 'med-1', medicineQuantity: 0 });
  assert.equal(result.valid, false);
  assert.ok(result.fields.patientId);
  assert.ok(result.fields.painScore);
  assert.ok(result.fields.medicineQuantity);
});

test('visit dispense validation supports multiple distinct typed items and preserves legacy medicine fields', () => {
  const multi = validateVisitPayload({
    ...validVisit,
    dispensations: [{ itemId: 'supply-1', quantity: 2 }, { itemId: 'med-2', quantity: '1' }],
  });
  assert.equal(multi.valid, true);
  assert.deepEqual(multi.value.dispensations, [{ itemId: 'supply-1', quantity: 2 }, { itemId: 'med-2', quantity: 1 }]);
  assert.equal(multi.value.medicineId, null);

  const legacy = validateVisitPayload({ ...validVisit, medicineId: 'med-legacy', medicineQuantity: 3 });
  assert.equal(legacy.valid, true);
  assert.deepEqual(legacy.value.dispensations, [{ itemId: 'med-legacy', quantity: 3 }]);
  assert.equal(legacy.value.medicineId, 'med-legacy');

  for (const dispensations of [
    [{ itemId: 'med-1', quantity: 0 }],
    [{ itemId: 'med-1', quantity: 101 }],
    [{ itemId: 'med-1', quantity: 1.5 }],
    [{ itemId: 'med-1', quantity: 1 }, { itemId: 'med-1', quantity: 2 }],
  ]) {
    const invalid = validateVisitPayload({ ...validVisit, dispensations });
    assert.equal(invalid.valid, false);
    assert.ok(invalid.fields.dispensations);
  }
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


test('clinical numeric fields reject boolean and array coercion while decimal temperatures remain valid', () => {
  for (const patch of [{ painScore: true }, { painScore: [5] }, { temperature: [36.5] }, { pulse: [70] }, { medicineId: 'qa-item', medicineQuantity: true }, { dispensations: [{ itemId: 'qa-item', quantity: [1] }] }]) {
    assert.equal(validateVisitPayload({ ...validVisit, ...patch }).valid, false, JSON.stringify(patch));
  }
  assert.equal(validateVisitPayload({ ...validVisit, temperature: 36.5, pulse: 70 }).valid, true);
  assert.equal(validateVisitPayload({ ...validVisit, temperature: '36.5', pulse: '70' }).valid, true);
});
