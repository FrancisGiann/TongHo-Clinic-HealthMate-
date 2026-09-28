import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ClipboardCheck, HeartPulse, Save, Send } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import HealthRecordFields, { emptyHealthRecord } from '../components/HealthRecordFields';
import { api } from '../utils/api';
import { hasAlreadySubmittedForSchoolYear, isHealthRecordRenewalDue } from '../utils/guardian-health-records';

const mergeAnswers = (source) => {
  const empty = emptyHealthRecord();
  const input = source && typeof source === 'object' ? source : {};
  return {
    ...empty,
    ...input,
    hospitalizationHistory: normalizeBooleanAnswer(input.hospitalizationHistory),
    onTherapy: normalizeBooleanAnswer(input.onTherapy),
    hasConcerns: normalizeBooleanAnswer(input.hasConcerns),
    pastIllness: { ...empty.pastIllness, ...(input.pastIllness || {}) },
    presentIllness: { ...empty.presentIllness, ...(input.presentIllness || {}) },
    medicationAtHome: { ...empty.medicationAtHome, ...(input.medicationAtHome || {}) },
    documentsSubmitted: { ...empty.documentsSubmitted, ...(input.documentsSubmitted || input.documents || {}) },
    allergiesStatus: input.allergiesStatus || (input.allergies ? 'reported' : 'unknown'),
    conditionsStatus: input.conditionsStatus || (input.conditions ? 'reported' : 'unknown'),
    medicationsStatus: input.medicationsStatus || (input.medications ? 'reported' : 'unknown'),
  };
};

function normalizeBooleanAnswer(value) {
  if (value === true || value === 'yes') return true;
  if (value === false || value === 'no') return false;
  return null;
}

const labelStatus = (status) => ({ pending_review: 'Waiting for nurse review', changes_requested: 'Changes requested', accepted: 'Accepted by clinic', superseded: 'Replaced by a newer submission' })[status] || 'No submission yet';
export default function GuardianHealthRecords() {
  const { patientId } = useParams();
  const [records, setRecords] = useState([]);
  const [schoolYear, setSchoolYear] = useState('');
  const [form, setForm] = useState(emptyHealthRecord);
  const [attested, setAttested] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const result = await api.get('/api/guardian/health-records');
      setSchoolYear(result.schoolYear || '');
      setRecords(result.records || []);
    } catch (loadError) {
      setError(loadError.message || 'Health records could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const selectedRecord = useMemo(() => records.find((record) => String(record.patient.id) === String(patientId)), [records, patientId]);
  useEffect(() => {
    if (!selectedRecord) return;
    const latest = selectedRecord.submissions?.[0];
    const initial = selectedRecord.draft?.payload
      || (latest?.status === 'changes_requested' ? latest.payload : null)
      || selectedRecord.currentAnswers;
    setForm(mergeAnswers(initial));
    setAttested(false);
    setError('');
    setMessage('');
  }, [selectedRecord?.patient.id]);

  const latestSubmission = selectedRecord?.submissions?.[0];
  const currentYearSubmission = selectedRecord?.submissions?.find((submission) => submission.school_year === schoolYear);
  const statusSubmission = currentYearSubmission || latestSubmission;
  const renewalDue = isHealthRecordRenewalDue(selectedRecord?.submissions, schoolYear);
  const alreadySubmitted = hasAlreadySubmittedForSchoolYear(selectedRecord?.submissions, schoolYear, form);

  const saveDraft = async () => {
    if (!selectedRecord) return null;
    const result = await api.put(`/api/guardian/health-records/${encodeURIComponent(selectedRecord.patient.id)}/draft`, {
      payload: form,
      version: selectedRecord.draft?.version || 0,
    });
    setRecords((current) => current.map((record) => String(record.patient.id) === String(selectedRecord.patient.id)
      ? { ...record, draft: { payload: result.draft.payload, version: result.draft.version, updatedAt: result.draft.updated_at } }
      : record));
    return result.draft;
  };

  const handleSave = async () => {
    setSaving(true); setError(''); setMessage('');
    try {
      await saveDraft();
      setMessage('Draft saved. You can return and update it before submitting.');
    } catch (saveError) {
      setError(saveError.message || 'Draft could not be saved.');
    } finally { setSaving(false); }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!attested) { setError('Confirm the guardian attestation before submitting.'); return; }
    setSaving(true); setError(''); setMessage('');
    try {
      const draft = await saveDraft();
      await api.post(`/api/guardian/health-records/${encodeURIComponent(selectedRecord.patient.id)}/submit`, { version: draft.version, attest: true });
      setMessage('Your health record was submitted for school nurse review.');
      setAttested(false);
      await load();
    } catch (submitError) {
      setError(submitError.message || 'The health record could not be submitted.');
    } finally { setSaving(false); }
  };

  if (loading) return <div className="loading-screen">Loading guardian health records…</div>;
  if (error && !records.length) return <div className="portal-record-page"><div className="error-banner" role="alert">{error}</div><button className="secondary-btn" onClick={load}>Try again</button></div>;

  if (!patientId) {
    return (
      <div className="portal-record-page">
        <div className="page-intro"><div><p className="section-kicker">Guardian health records</p><h2>Student Health Record</h2><p>Complete the yearly health information for each linked student. Nurses review submissions before accepted answers update the student’s profile.</p></div></div>
        <div className="privacy-notice" role="note"><strong>Privacy notice</strong><p>Health information is available to the linked guardian and authorized school clinic staff for school health support. Submit only information needed for the clinic to care for your child. This form does not replace urgent or emergency care.</p></div>
        {error && <div className="error-banner" role="alert">{error}</div>}
        {records.length ? <section className="panel portal-detail-panel"><div className="panel-heading"><div><h3>Linked student records</h3><p>Current school year: {schoolYear || 'Not configured'}</p></div></div><div className="portal-profile-list">{records.map((record) => {
          const latest = record.submissions?.[0];
          const currentYearSubmission = record.submissions?.find((submission) => submission.school_year === schoolYear);
          const renewalDue = isHealthRecordRenewalDue(record.submissions, schoolYear);
          const status = renewalDue ? 'Annual confirmation due' : labelStatus(currentYearSubmission?.status || latest?.status);
          return <article className="portal-profile-row" key={record.patient.id}><div className="portal-profile-name"><strong>{record.patient.name || 'Student'}</strong><span>{[record.patient.studentId, record.patient.gradeLevel, record.patient.section].filter(Boolean).join(' · ') || 'Student roster record'}</span></div><div><small>Submission status</small><strong>{status}</strong></div><Link className="portal-row-action" to={`/health-records/${encodeURIComponent(record.patient.id)}`}>{renewalDue ? 'Renew this year' : currentYearSubmission?.status === 'changes_requested' ? 'Update record' : currentYearSubmission?.status === 'pending_review' ? 'View draft' : 'Open health record'} <ClipboardCheck size={14} aria-hidden="true" /></Link></article>;
        })}</div></section> : <section className="panel portal-detail-panel"><div className="portal-empty-state"><HeartPulse size={22} aria-hidden="true" /><div><strong>No student is linked yet</strong><p>Contact the school clinic to link your guardian account to a student record.</p></div></div></section>}
      </div>
    );
  }

  if (!selectedRecord) return <div className="portal-record-page"><h2>Student record unavailable</h2><p>This student is not linked to your guardian account.</p><Link className="portal-back-link" to="/health-records"><ArrowLeft size={15} /> Back to linked students</Link></div>;
  const patient = selectedRecord.patient;
  return (
    <div className="form-page">
      <Link to="/health-records" className="back-link"><ArrowLeft size={16} /> Back to linked students</Link>
      <div className="page-intro"><div><p className="section-kicker">{schoolYear || 'School health record'}</p><h2>{patient.name}</h2><p>{[patient.studentId, patient.gradeLevel, patient.section].filter(Boolean).join(' · ')}</p></div><span className={`status-chip ${!renewalDue && statusSubmission?.status === 'accepted' ? 'success' : 'warn'}`}>{renewalDue ? 'Annual confirmation due' : labelStatus(statusSubmission?.status)}</span></div>
      {renewalDue && <div className="review-notice"><strong>Annual confirmation due</strong><p>The latest submission was for {latestSubmission.school_year}. Review the information and submit this school year’s confirmation for {schoolYear}. You may keep unchanged answers.</p></div>}
      {statusSubmission?.status === 'changes_requested' && <div className="review-notice"><strong>Clinic requested changes</strong><p>{statusSubmission.nurse_notes || 'Please review the record and submit an updated version.'}</p></div>}
      {!renewalDue && statusSubmission?.status === 'accepted' && <div className="success-message" role="status">The latest submission for this school year was accepted. You can update this health record again at any time.</div>}
      <div className="privacy-notice" role="note"><strong>Privacy notice</strong><p>Provide information needed for school health support. The school nurse reviews each submission before accepted answers are added to the clinic profile. Do not use this form for emergencies.</p></div>
      {error && <div className="error-banner" role="alert">{error}</div>}{message && <div className="success-message" role="status">{message}</div>}
      <form className="panel form-panel registration-form" onSubmit={handleSubmit}>
        <section className="form-section"><h3 className="section-title">School roster information</h3><div className="three-fields"><label>Student ID<input value={patient.studentId || ''} readOnly /></label><label>Grade<input value={patient.gradeLevel || ''} readOnly /></label><label>Section<input value={patient.section || ''} readOnly /></label></div><p className="field-hint">The school manages student identity and class placement.</p></section>
        <HealthRecordFields value={form} onChange={setForm} disabled={saving} />
        <section className="form-section"><h3 className="section-title">Clinic document receipt status</h3><p className="field-hint">The school nurse records receipt status. Your answers above only say which documents you submitted; they do not mark a document as received.</p><div className="checkbox-group">{[['psychiatricEvaluation', 'Psychiatric evaluation'], ['diagnosticAssessment', 'Diagnostic assessment'], ['medicationRecords', 'Medication records']].map(([field, label]) => <label className="checkbox-label" key={field}><input type="checkbox" checked={selectedRecord.currentAnswers?.documentsReceived?.[field] === true} readOnly disabled />{label} — {selectedRecord.currentAnswers?.documentsReceived?.[field] === true ? 'received by clinic' : 'not confirmed received'}</label>)}</div></section>
        <section className="form-section guardian-attestation"><h3 className="section-title">Guardian attestation</h3><label className="checkbox-label"><input type="checkbox" checked={attested} onChange={(event) => setAttested(event.target.checked)} disabled={saving} /> I am this student’s parent or legal guardian. The information I provided is accurate to the best of my knowledge, and I authorize the school nurse to review it for school health support. I understand the clinic reviews this record before accepted answers update the student’s health profile.</label></section>
        <div className="form-actions"><button className="secondary-btn" type="button" onClick={handleSave} disabled={saving}><Save size={15} /> {saving ? 'Saving…' : 'Save draft'}</button><button className="primary-btn" type="submit" disabled={saving || !attested || alreadySubmitted}><Send size={15} /> {saving ? 'Submitting…' : 'Submit for nurse review'}</button></div>
        {alreadySubmitted && <p className="field-hint">This version has already been submitted. Make a change to submit an updated version.</p>}
      </form>
      {!!selectedRecord.submissions?.length && <section className="panel portal-detail-panel submission-history"><div className="panel-heading"><div><h3>Submission history</h3><p>Previous submissions remain in the clinic record.</p></div></div>{selectedRecord.submissions.map((submission) => <div key={submission.id}><p><strong>{submission.school_year} · revision {submission.revision}</strong> — {labelStatus(submission.status)} · {submission.source === 'paper' ? 'Transcribed from paper form' : 'Submitted online'}</p>{submission.nurse_notes && <p><strong>Clinic feedback:</strong> {submission.nurse_notes}</p>}</div>)}</section>}
    </div>
  );
}
