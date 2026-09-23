import test from 'node:test';
import assert from 'node:assert/strict';
import { validateChangedClinicalRecords } from './clinical-records.js';

const base = {
  students: [{ id: 'student-1' }],
  screenings: [],
  immunizations: [],
  incidents: [],
};

test('unchanged historical clinical records remain readable without being revalidated', () => {
  const before = {
    screenings: [{ id: 'legacy-screen', studentId: 'student-1', result: 'Pass' }],
    immunizations: [{ id: 'legacy-vaccine', studentId: 'student-1', vaccineName: 'Legacy vaccine' }],
    incidents: [{ id: 'legacy-incident', studentId: 'student-1', type: 'Other' }],
  };
  assert.deepEqual(validateChangedClinicalRecords(before, {
    ...base,
    screenings: before.screenings,
    immunizations: before.immunizations,
    incidents: before.incidents,
  }), { valid: true });
});

test('new screening records require findings and keep BMI tied to recorded measurements', () => {
  const empty = validateChangedClinicalRecords({}, {
    ...base,
    screenings: [{ id: 'screen-1', patientId: 'student-1', schoolYear: '2026-2027', date: '2026-09-23' }],
  });
  assert.equal(empty.valid, false);
  assert.match(empty.message, /measured screening finding/);

  const valid = validateChangedClinicalRecords({}, {
    ...base,
    screenings: [{ id: 'screen-2', patientId: 'student-1', schoolYear: '2026-2027', date: '2026-09-23', visionFinding: 'Right eye 20/30', heightCm: 150, weightKg: 45, bmi: 20 }],
  });
  assert.deepEqual(valid, { valid: true });

  const mismatch = validateChangedClinicalRecords({}, {
    ...base,
    screenings: [{ id: 'screen-3', patientId: 'student-1', schoolYear: '2026-2027', date: '2026-09-23', heightCm: 150, weightKg: 45, bmi: 22 }],
  });
  assert.equal(mismatch.valid, false);
  assert.match(mismatch.message, /BMI must match/);
});

test('screening dates use the Asia/Manila day boundary and reject future days', () => {
  const now = new Date('2026-09-22T16:00:00Z'); // September 23 in Manila
  const record = { id: 'screen-today', patientId: 'student-1', schoolYear: '2026-2027', date: '2026-09-23', visionFinding: '20/20' };
  assert.deepEqual(validateChangedClinicalRecords({}, { ...base, screenings: [record] }, { now }), { valid: true });
  const future = validateChangedClinicalRecords({}, {
    ...base,
    screenings: [{ ...record, id: 'screen-tomorrow', date: '2026-09-24' }],
  }, { now });
  assert.equal(future.valid, false);
  assert.match(future.message, /Screening date cannot be in the future/);
});

test('new immunization records require external clinic details and reject future dates', () => {
  const record = { id: 'vaccine-1', patientId: 'student-1', vaccineName: 'Vaccine outside suggestions', doseNumber: 'Dose 1', dateAdministered: '2026-09-22', source: 'external' };
  const missingClinic = validateChangedClinicalRecords({}, { ...base, immunizations: [record] }, { now: new Date('2026-09-23T02:00:00Z') });
  assert.equal(missingClinic.valid, false);
  assert.match(missingClinic.message, /external clinic name/);

  const future = validateChangedClinicalRecords({}, {
    ...base,
    immunizations: [{ ...record, clinicName: 'Community Clinic', dateAdministered: '2026-09-24' }],
  }, { now: new Date('2026-09-23T02:00:00Z') });
  assert.equal(future.valid, false);
  assert.match(future.message, /cannot be in the future/);

  const pastDue = validateChangedClinicalRecords({}, {
    ...base,
    immunizations: [{ ...record, clinicName: 'Community Clinic', nextDueDate: '2026-09-21' }],
  }, { now: new Date('2026-09-23T02:00:00Z') });
  assert.equal(pastDue.valid, false);
  assert.match(pastDue.message, /cannot be before/);
});

test('new Other incidents require a custom type description', () => {
  const result = validateChangedClinicalRecords({}, {
    ...base,
    incidents: [{ id: 'incident-1', patientId: 'student-1', date: '2026-09-23T10:30', location: 'Hallway', type: 'Other', description: 'Slip', actionTaken: 'Assisted student' }],
  });
  assert.equal(result.valid, false);
  assert.match(result.message, /Describe the incident type/);
});

test('incident datetimes compare as Manila local time and allow the exact current-time boundary', () => {
  const now = new Date('2026-09-23T01:00:00Z'); // 09:00 in Manila
  const record = { id: 'incident-now', patientId: 'student-1', date: '2026-09-23T09:00', location: 'Hallway', type: 'Sports injury', description: 'Slip', actionTaken: 'Assisted student' };
  assert.deepEqual(validateChangedClinicalRecords({}, { ...base, incidents: [record] }, { now }), { valid: true });
  const futureMinute = validateChangedClinicalRecords({}, {
    ...base,
    incidents: [{ ...record, id: 'incident-future', date: '2026-09-23T09:01' }],
  }, { now });
  assert.equal(futureMinute.valid, false);
  assert.match(futureMinute.message, /Incident date and time cannot be in the future/);

  const futureOffset = validateChangedClinicalRecords({}, {
    ...base,
    incidents: [{ ...record, id: 'incident-offset', date: '2026-09-23T01:01Z' }],
  }, { now });
  assert.equal(futureOffset.valid, false);
  assert.match(futureOffset.message, /Incident date and time cannot be in the future/);

  const exactOffset = validateChangedClinicalRecords({}, {
    ...base,
    incidents: [{ ...record, id: 'incident-exact-offset', date: '2026-09-23T01:00Z' }],
  }, { now });
  assert.deepEqual(exactOffset, { valid: true });
});
