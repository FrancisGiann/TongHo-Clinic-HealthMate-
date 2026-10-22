import test from 'node:test';
import assert from 'node:assert/strict';
import { clinicReportPrintModel, formatHealthField, patientSummaryPrintModel } from './reportPrint.js';

test('clinic print model carries the full requested range and permitted categories with suppression notes', () => {
  const timeSeries = Object.fromEntries(Array.from({ length: 31 }, (_, index) => [`2026-01-${String(index + 1).padStart(2, '0')}`, index + 1]));
  const report = clinicReportPrintModel({
    totals: { visits: 2, uniquePatients: 2 },
    suppressedTotals: ['visits'],
    timeSeries,
    complaints: { Headache: 4, Fever: 3 },
    suppressedAggregates: ['complaints'],
  });
  assert.equal(report.totals.find((item) => item.label === 'Visits').value, 'Withheld');
  assert.equal(report.timeSeries.length, 31);
  assert.deepEqual(report.categories.find((item) => item.title === 'Complaints'), {
    title: 'Complaints', entries: [['Headache', 4], ['Fever', 3]], withheld: true,
  });
  assert.ok(report.categories.some((item) => item.title === 'Unclassified historical items'));
});

test('patient summary print model keeps all whitelisted visits, identity, and approved projection fields only', () => {
  const visits = Array.from({ length: 37 }, (_, index) => ({
    id: `visit-${index}`, date: '2026-01-20', chiefComplaint: 'Headache', treatment: 'Rest', disposition: 'Returned to class',
    nurseName: 'Clinic nurse', summary: 'Approved summary', privateNotes: 'Private', riskClassification: 'high', rawAiOutput: 'hidden',
  }));
  const model = patientSummaryPrintModel({
    patient: { id: 'internal-id', patientType: 'student', name: 'Student Example', studentId: 'STU-1', gradeLevel: 'Grade 4', section: 'A', private: 'hidden' },
    currentHealth: { birthDate: '2015-01-01', gender: 'Female', bloodType: 'O+', allergies: 'Peanuts', privateNotes: 'hidden' },
    period: { start: '2026-01-01', end: '2026-01-31' }, visits,
  });
  assert.equal(model.totalVisits, 37);
  assert.equal(model.patient.studentId, 'STU-1');
  assert.equal(model.patient.gradeLevel, 'Grade 4');
  assert.equal(model.health.birthDate, '2015-01-01');
  assert.equal(model.visits[0].summary, 'Approved summary');
  assert.equal(model.visits[0].privateNotes, undefined);
  assert.equal(model.visits[0].riskClassification, undefined);
  assert.equal(model.health.privateNotes, undefined);

  const faculty = patientSummaryPrintModel({ patient: { patientType: 'faculty', facultyId: 'FAC-1', department: 'Science', position: 'Teacher', gradeLevel: 'hidden' } });
  assert.equal(faculty.patient.facultyId, 'FAC-1');
  assert.equal(faculty.patient.department, 'Science');
  assert.equal(faculty.patient.gradeLevel, '');
});

test('patient summary labels explicit No, None, and Unknown values without rendering objects directly', () => {
  assert.equal(formatHealthField('hospitalizationHistory', { hospitalizationHistory: false }), 'No');
  assert.equal(formatHealthField('allergies', { allergies: '', allergiesStatus: 'none' }), 'None reported');
  assert.equal(formatHealthField('conditions', { conditions: '', conditionsStatus: 'unknown' }), 'Unknown');
  assert.equal(formatHealthField('pastIllness', { pastIllness: { asthma: true, pneumonia: false } }), 'Asthma: Yes');
  assert.equal(formatHealthField('presentIllness', { presentIllness: { asthma: false, eyeDisorder: false } }), 'None reported');
});
