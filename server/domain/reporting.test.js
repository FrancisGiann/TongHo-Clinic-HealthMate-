import test from 'node:test';
import assert from 'node:assert/strict';
import { buildClinicReport, reportForRole, suppressSmallCellAggregates } from './reporting.js';

test('report includes only records inside the requested period', () => {
  const report = buildClinicReport({
    visits: [
      { id: 1, studentId: 10, date: '2026-09-01', chiefComplaint: 'Headache', type: 'Illness', treatment: 'Rest' },
      { id: 2, studentId: 11, date: '2026-10-01', chiefComplaint: 'Cough', type: 'Illness', treatment: 'Hydration' },
    ],
    incidents: [{ id: 3, date: '2026-09-15' }],
    appointments: [],
    dispenseLogs: [{ id: 4, date: '2026-09-01', medicineName: 'Bandage', quantity: 2 }],
    students: [{ id: 10, gradeLevel: 'Grade 4' }],
  }, '2026-09-01', '2026-09-30');
  assert.equal(report.totals.visits, 1);
  assert.equal(report.totals.uniquePatients, 1);
  assert.equal(report.totals.incidents, 1);
  assert.equal(report.totals.medicinesDispensed, 2);
  assert.deepEqual(report.complaints, { Headache: 1 });
  assert.deepEqual(report.grades, { 'Grade 4': 1 });
  assert.deepEqual(report.timeSeries, { '2026-09-01': 1, '2026-09-02': 0, '2026-09-03': 0, '2026-09-04': 0, '2026-09-05': 0, '2026-09-06': 0, '2026-09-07': 0, '2026-09-08': 0, '2026-09-09': 0, '2026-09-10': 0, '2026-09-11': 0, '2026-09-12': 0, '2026-09-13': 0, '2026-09-14': 0, '2026-09-15': 0, '2026-09-16': 0, '2026-09-17': 0, '2026-09-18': 0, '2026-09-19': 0, '2026-09-20': 0, '2026-09-21': 0, '2026-09-22': 0, '2026-09-23': 0, '2026-09-24': 0, '2026-09-25': 0, '2026-09-26': 0, '2026-09-27': 0, '2026-09-28': 0, '2026-09-29': 0, '2026-09-30': 0 });
});

test('administrator aggregate view suppresses small cells across all categories and totals', () => {
  const report = buildClinicReport({
    visits: [
      { id: '1', patientId: 'p1', date: '2026-09-01', chiefComplaint: 'Headache', type: 'Illness', treatment: 'Rest', riskCategory: 'low' },
      { id: '2', patientId: 'p2', date: '2026-09-01', chiefComplaint: 'Cough', type: 'Injury', treatment: 'Ice', riskCategory: 'high' },
      { id: '3', patientId: 'p3', date: '2026-09-01', chiefComplaint: 'Cough', type: 'Illness', treatment: 'Rest', riskCategory: 'moderate' },
      { id: '4', patientId: 'p4', date: '2026-09-01', chiefComplaint: 'Cough', type: 'Illness', treatment: 'Rest', riskCategory: 'moderate' },
      { id: '5', patientId: 'p5', date: '2026-09-01', chiefComplaint: 'Cough', type: 'Illness', treatment: 'Rest', riskCategory: 'moderate' },
      { id: '6', patientId: 'p6', date: '2026-09-01', chiefComplaint: 'Cough', type: 'Illness', treatment: 'Rest', riskCategory: 'moderate' },
      ...Array.from({ length: 6 }, (_, index) => ({ id: `7-${index}`, patientId: `p${index + 7}`, date: '2026-09-02', chiefComplaint: 'Stomachache', type: 'Illness', treatment: 'Rest', riskCategory: 'moderate' })),
    ],
    students: [
      { id: 'p1', gradeLevel: 'Grade 4' }, { id: 'p2', gradeLevel: 'Grade 5' },
      { id: 'p3', gradeLevel: 'Grade 4' }, { id: 'p4', gradeLevel: 'Grade 4' }, { id: 'p5', gradeLevel: 'Grade 4' }, { id: 'p6', gradeLevel: 'Grade 4' },
      ...Array.from({ length: 6 }, (_, index) => ({ id: `p${index + 7}`, gradeLevel: 'Grade 4' })),
    ],
    incidents: [{ id: 'i1', date: '2026-09-01', severity: 'Minor' }],
    appointments: [],
    dispenseLogs: [{ id: 'm1', date: '2026-09-01', medicineName: 'Medicine A', quantity: 2 }],
  }, '2026-09-01', '2026-09-02');
  const adminView = suppressSmallCellAggregates(report);

  assert.deepEqual(adminView.complaints, { Stomachache: 6 });
  assert.deepEqual(adminView.consultationTypes, {});
  assert.deepEqual(adminView.treatments, {});
  assert.deepEqual(adminView.medicines, {});
  assert.deepEqual(adminView.riskCategories, { moderate: 10 });
  assert.deepEqual(adminView.grades, {});
  assert.deepEqual(adminView.incidentSeverities, {});
  assert.equal(adminView.totals.visits, null);
  assert.ok(adminView.suppressedTotals.includes('visits'));
  assert.equal(adminView.totals.uniquePatients, 12);
  assert.equal(adminView.totals.incidents, null);
  assert.ok(adminView.suppressedAggregates.includes('complaints'));
  assert.ok(adminView.suppressedAggregates.includes('medicines'));
  assert.ok(adminView.suppressedTotals.includes('incidents'));
  assert.equal(adminView.timeSeries['2026-09-01'], null);
  assert.equal(adminView.timeSeriesSuppressed, true);
  assert.equal(report.totals.incidents, 1, 'suppression does not mutate the stored/full report');
});

test('empty report categories remain distinguishable from suppressed categories', () => {
  const adminView = suppressSmallCellAggregates({ totals: { visits: 0 }, complaints: {}, timeSeries: {} });
  assert.deepEqual(adminView.complaints, {});
  assert.deepEqual(adminView.suppressedAggregates, []);
  assert.deepEqual(adminView.suppressedTotals, []);
  assert.equal(adminView.totals.visits, 0);
  assert.equal(adminView.timeSeriesSuppressed, false);
});

test('a small patient cohort suppresses categories even when repeat visits inflate cell counts', () => {
  const repeatVisits = Array.from({ length: 8 }, (_, index) => ({
    id: String(index), patientId: index < 4 ? 'p1' : 'p2', date: `2026-09-0${index < 4 ? 1 : 2}`,
    chiefComplaint: 'Repeated concern', type: 'Illness', treatment: 'Rest', riskCategory: 'low',
  }));
  const report = buildClinicReport({ visits: repeatVisits }, '2026-09-01', '2026-09-02');
  const adminView = suppressSmallCellAggregates(report);

  assert.equal(report.totals.visits, 8);
  assert.equal(report.totals.uniquePatients, 2);
  assert.equal(adminView.smallCohortSuppressed, true);
  assert.deepEqual(adminView.complaints, {});
  assert.deepEqual(adminView.consultationTypes, {});
  assert.ok(adminView.suppressedAggregates.includes('treatments'));
  assert.deepEqual(Object.values(adminView.timeSeries), [null, null]);
  assert.equal(adminView.timeSeriesSuppressed, true);
});

test('role-specific report views keep nurse detail and suppress administrator snapshots', () => {
  const savedSnapshot = buildClinicReport({
    visits: Array.from({ length: 6 }, (_, index) => ({ id: String(index), patientId: `p${index}`, date: '2026-09-01', chiefComplaint: index ? 'Cough' : 'Headache', type: 'Illness', treatment: 'Rest' })),
  }, '2026-09-01', '2026-09-01');
  const nurseView = reportForRole(savedSnapshot, 'school_nurse');
  const adminView = reportForRole(savedSnapshot, 'system_administrator');

  assert.deepEqual(nurseView.complaints, { Headache: 1, Cough: 5 });
  assert.deepEqual(adminView.complaints, {});
  assert.ok(adminView.suppressedAggregates.includes('complaints'));
});
