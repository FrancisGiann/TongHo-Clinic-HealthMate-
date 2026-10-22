import test from 'node:test';
import assert from 'node:assert/strict';
import { patientSummaryForRange, projectPatientSummaryHealth, projectPatientSummaryVisit, validateSummaryRange } from './patientSummary.js';

test('summary range validates real calendar dates and bounds the requested period', () => {
  assert.equal(validateSummaryRange('2026-02-01', '2026-02-28').valid, true);
  assert.equal(validateSummaryRange('2026-02-31', '2026-03-01').valid, false);
  assert.equal(validateSummaryRange('2025-01-01', '2026-01-03').valid, false);
});

test('student health summary includes the accepted projection and excludes drafts and attestations', () => {
  const patient = { patient_type: 'student', data: {
    studentId: 'S-1', name: 'Student One', allergies: 'old profile value', privateNotes: 'PRIVATE',
    guardianHealthRecord: { allergies: 'Peanuts', allergiesStatus: 'reported', bloodType: 'O+', submittedAt: 'PRIVATE', approvalAttestation: 'PRIVATE' },
    guardianHealthRecordDraft: { allergies: 'UNAPPROVED DRAFT' }, healthRecordSubmission: { status: 'pending', answers: { allergies: 'PENDING' } },
  } };
  const health = projectPatientSummaryHealth(patient);
  assert.equal(health.allergies, 'Peanuts');
  assert.equal(health.bloodType, 'O+');
  assert.equal('privateNotes' in health, false);
  assert.equal('guardianHealthRecordDraft' in health, false);
  assert.equal('submittedAt' in health, false);
  assert.equal('approvalAttestation' in health, false);
});

test('faculty current health is included without student guardian workflow data', () => {
  const health = projectPatientSummaryHealth({ patient_type: 'faculty', data: { allergies: 'Latex', conditions: 'Asthma', medications: 'Inhaler', guardianHealthRecord: { allergies: 'Wrong' } } });
  assert.deepEqual(health, { allergies: 'Latex', conditions: 'Asthma', medications: 'Inhaler' });
});

test('patient-wide summary includes all matching dates and only approved summary text', () => {
  const result = patientSummaryForRange({
    patient: { id: 'patient-1', patient_type: 'faculty', data: { facultyId: 'F-1', name: 'Faculty One', allergies: 'Latex', privateNotes: 'PRIVATE' } },
    start: '2026-01-01', end: '2026-01-31',
    visits: [
      { id: 'a', data: { date: '2026-01-02', chiefComplaint: 'Headache', treatment: 'Water', notes: 'PRIVATE', riskAssessment: { category: 'high' }, summaryApprovedBy: 'nurse', consultationSummary: 'Approved' } },
      { id: 'b', data: { date: '2026-01-04', chiefComplaint: 'Cough', summaryApprovedBy: null, consultationSummary: 'UNAPPROVED' } },
      { id: 'c', data: { date: '2025-12-31', chiefComplaint: 'Outside range' } },
    ],
  });
  assert.equal(result.totals.visits, 2);
  assert.equal(result.visits[0].id, 'b');
  assert.equal(result.visits[0].summary, undefined);
  assert.equal(result.visits[1].summary, 'Approved');
  assert.equal('notes' in result.visits[1], false);
  assert.equal('riskAssessment' in result.visits[1], false);
  assert.equal('privateNotes' in result.currentHealth, false);
  assert.equal(projectPatientSummaryVisit({ id: 'x', data: { notes: 'PRIVATE' } }).notes, undefined);
});
