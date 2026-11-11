import test from 'node:test';
import assert from 'node:assert/strict';
import { clinicCalendarDate, validateVisitPayload } from './visit.js';

const validVisit = {
  patientId: 'student-17',
  visitType: 'Illness',
  chiefComplaint: 'Headache',
  treatment: 'Rest and hydration',
  disposition: 'Returned to class',
  clinicianRedFlag: false,
  clinicianRedFlagAssessed: true,
};

test('visit calendar dates follow the Asia/Manila day across UTC midnight boundaries', () => {
  assert.equal(clinicCalendarDate(new Date('2026-09-22T15:59:59.000Z')), '2026-09-22');
  assert.equal(clinicCalendarDate(new Date('2026-09-22T16:00:00.000Z')), '2026-09-23');
});

test('paper-log visit fields validate without a numeric pain score or client scoring metadata', () => {
  const result = validateVisitPayload({ ...validVisit, recentVisitCount: 999, riskAssessment: { category: 'high' } });
  assert.equal(result.valid, true);
  assert.equal(result.value.patientId, 'student-17');
  assert.equal(result.value.chiefComplaint, 'Headache');
  assert.equal(result.value.clinicianRedFlag, false);
  assert.equal(result.value.clinicianRedFlagAssessed, true);
  assert.equal('painScore' in result.value, false);
  assert.equal('recentVisitCount' in result.value, false);
  assert.equal('riskAssessment' in result.value, false);
});

test('urgent warning signs require a bounded documented action', () => {
  const missingAction = validateVisitPayload({ ...validVisit, clinicianRedFlag: true });
  assert.equal(missingAction.valid, false);
  assert.ok(missingAction.fields.warningSignAction);

  const savedAction = validateVisitPayload({ ...validVisit, clinicianRedFlag: true, warningSignAction: 'Referred to emergency services.' });
  assert.equal(savedAction.valid, true);
  assert.equal(savedAction.value.warningSignAction, 'Referred to emergency services.');

  const tooLong = validateVisitPayload({ ...validVisit, clinicianRedFlag: true, warningSignAction: 'A'.repeat(2001) });
  assert.equal(tooLong.valid, false);
  assert.ok(tooLong.fields.warningSignAction);
});

test('visit validation requires a completed explicit warning-sign screen', () => {
  for (const patch of [
    { clinicianRedFlag: null, clinicianRedFlagAssessed: false },
    { clinicianRedFlag: 'no' },
    { clinicianRedFlagAssessed: 'false' },
    { clinicianRedFlagAssessed: false },
  ]) {
    const invalid = validateVisitPayload({ ...validVisit, ...patch });
    assert.equal(invalid.valid, false, JSON.stringify(patch));
  }
  assert.equal(validateVisitPayload({ ...validVisit, clinicianRedFlag: true, warningSignAction: 'Transferred for urgent evaluation.' }).valid, true);
});

test('visit validation rejects missing patient and unsafe dispense quantities', () => {
  const result = validateVisitPayload({ ...validVisit, patientId: '', medicineId: 'med-1', medicineQuantity: 0 });
  assert.equal(result.valid, false);
  assert.ok(result.fields.patientId);
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
  for (const patch of [{ temperature: [36.5] }, { pulse: [70] }, { medicineId: 'qa-item', medicineQuantity: true }, { dispensations: [{ itemId: 'qa-item', quantity: [1] }] }]) {
    assert.equal(validateVisitPayload({ ...validVisit, ...patch }).valid, false, JSON.stringify(patch));
  }
  assert.equal(validateVisitPayload({ ...validVisit, temperature: 36.5, pulse: 70 }).valid, true);
  assert.equal(validateVisitPayload({ ...validVisit, temperature: '36.5', pulse: '70' }).valid, true);
});
