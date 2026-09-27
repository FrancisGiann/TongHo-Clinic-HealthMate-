import test from 'node:test';
import assert from 'node:assert/strict';
import { validateChangedClinicalRecords } from './clinical-records.js';

const base = {
  students: [{ id: 'student-1' }],
  screenings: [],
  immunizations: [],
  incidents: [],
};

test('unchanged legacy records are not rejected when supplied in both snapshots', () => {
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

test('new and changed screening or incident records return a retired-feature response', () => {
  const screening = { id: 'screen-1', patientId: 'student-1', schoolYear: '2026-2027', date: '2026-09-23' };
  const incident = { id: 'incident-1', patientId: 'student-1', date: '2026-09-23T10:30', location: 'Hallway', type: 'Other' };
  for (const [collection, record] of [['screenings', screening], ['incidents', incident]]) {
    const created = validateChangedClinicalRecords({}, { ...base, [collection]: [record] });
    assert.equal(created.valid, false);
    assert.equal(created.status, 410);
    assert.equal(created.code, 'FEATURE_REMOVED');
    assert.match(created.message, /cannot be created or changed/);

    const changed = validateChangedClinicalRecords({ ...base, [collection]: [record] }, {
      ...base,
      [collection]: [{ ...record, location: 'Courtyard', updatedAt: '2026-09-23T11:00' }],
    });
    assert.equal(changed.status, 410);
    assert.equal(changed.code, 'FEATURE_REMOVED');
  }
});

test('unchanged screening and incident records can pass through without being rewritten', () => {
  const before = {
    screenings: [{ id: 'legacy-screen', patientId: 'student-1', result: 'Pass' }],
    incidents: [{ id: 'legacy-incident', patientId: 'student-1', type: 'Other' }],
  };
  assert.deepEqual(validateChangedClinicalRecords(before, { ...base, ...before }), { valid: true });
});

test('legacy immunization records cannot be created or changed', () => {
  const record = { id: 'vaccine-1', patientId: 'student-1', vaccineName: 'Vaccine outside suggestions', doseNumber: 'Dose 1', dateAdministered: '2026-09-22', source: 'external' };
  const created = validateChangedClinicalRecords({}, { ...base, immunizations: [record] });
  assert.deepEqual(created, {
    valid: false,
    status: 410,
    code: 'FEATURE_REMOVED',
    message: 'Immunization records are retained as historical data and cannot be created or changed.',
  });

  const changed = validateChangedClinicalRecords({ ...base, immunizations: [record] }, {
    ...base,
    immunizations: [{ ...record, remarks: 'Updated' }],
  });
  assert.equal(changed.status, 410);
  assert.equal(changed.code, 'FEATURE_REMOVED');
});
