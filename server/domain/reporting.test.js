import test from 'node:test';
import assert from 'node:assert/strict';
import { buildClinicReport } from './reporting.js';

test('report includes only records inside the requested period', () => {
  const report = buildClinicReport({
    visits: [
      { id: 1, studentId: 10, date: '2026-09-01', chiefComplaint: 'Headache', type: 'Illness', treatment: 'Rest' },
      { id: 2, studentId: 11, date: '2026-10-01', chiefComplaint: 'Cough', type: 'Illness', treatment: 'Hydration' },
    ],
    incidents: [{ id: 3, date: '2026-09-15' }],
    appointments: [],
    dispenseLogs: [{ id: 4, date: '2026-09-01', medicineName: 'Bandage', quantity: 2 }],
  }, '2026-09-01', '2026-09-30');
  assert.equal(report.totals.visits, 1);
  assert.equal(report.totals.uniquePatients, 1);
  assert.equal(report.totals.incidents, 1);
  assert.equal(report.totals.medicinesDispensed, 2);
  assert.deepEqual(report.complaints, { Headache: 1 });
});
