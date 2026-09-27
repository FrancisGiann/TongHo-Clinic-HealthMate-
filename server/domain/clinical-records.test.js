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

test('new and changed screening or incident records return FEATURE_REMOVED while unchanged history remains readable', () => {
  const before = {
    screenings: [{ id: 'legacy-screen', patientId: 'student-1', date: '2025-01-01' }],
    incidents: [{ id: 'legacy-incident', patientId: 'student-1', type: 'Other' }],
  };
  assert.deepEqual(validateChangedClinicalRecords(before, { ...base, ...before }), { valid: true });

  for (const [collection, record] of [
    ['screenings', { id: 'screen-1', patientId: 'student-1', schoolYear: '2026-2027', date: '2026-09-23' }],
    ['incidents', { id: 'incident-1', patientId: 'student-1', date: '2026-09-23T10:30', location: 'Hallway', type: 'Other' }],
  ]) {
    const created = validateChangedClinicalRecords({}, { ...base, [collection]: [record] });
    assert.equal(created.valid, false);
    assert.equal(created.status, 410);
    assert.equal(created.code, 'FEATURE_REMOVED');
    assert.match(created.message, /cannot be created or changed/);

    const updated = validateChangedClinicalRecords({ ...base, [collection]: [record] }, {
      ...base,
      [collection]: [{ ...record, notes: 'edited legacy value' }],
    });
    assert.equal(updated.status, 410);
    assert.equal(updated.code, 'FEATURE_REMOVED');
  }
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
