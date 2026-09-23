import test from 'node:test';
import assert from 'node:assert/strict';
import { compareImmunizationLatest, latestImmunizationsByStudentVaccine } from '../../shared/immunizationOrder.js';

test('immunization ordering uses valid administration date, creation time, then lexical ID', () => {
  const base = { vaccineName: 'Td', patientId: 'student-1' };
  const older = { ...base, id: 'record-a', dateAdministered: '2026-08-20', createdAt: '2026-08-20T01:00:00Z' };
  const correction = { ...base, id: 'record-b', dateAdministered: '2026-08-20', createdAt: '2026-08-20T02:00:00Z' };
  const invalidDate = { ...base, id: 'record-z', dateAdministered: '2026-02-30', createdAt: '2026-08-21T02:00:00Z' };
  assert.equal(compareImmunizationLatest(correction, older), 1);
  assert.equal(compareImmunizationLatest(older, invalidDate), 1);
  assert.equal(compareImmunizationLatest({ ...base, id: 'dose-b', dateAdministered: '2026-08-20', createdAt: older.createdAt }, { ...base, id: 'dose-a', dateAdministered: '2026-08-20', createdAt: older.createdAt }), 1);
});

test('latest vaccine grouping keeps distinct unknown vaccines and selects valid records over invalid dates', () => {
  const latest = latestImmunizationsByStudentVaccine([
    { id: 'unknown-1', patientId: 'student-1', nextDueDate: '2026-09-01' },
    { id: 'unknown-2', patientId: 'student-1', nextDueDate: '2026-09-02' },
    { id: 'invalid-dose', patientId: 'student-1', vaccineName: 'MMR', dateAdministered: '2026-02-30', createdAt: '2026-08-30T02:00:00Z' },
    { id: 'valid-dose', patientId: 'student-1', vaccineName: 'mmr', dateAdministered: '2026-02-28', createdAt: '2026-08-29T02:00:00Z' },
  ]);
  assert.deepEqual(new Set(latest.map((record) => record.id)), new Set(['unknown-1', 'unknown-2', 'valid-dose']));
});
