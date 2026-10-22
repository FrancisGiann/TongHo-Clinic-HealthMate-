import { useEffect, useState } from 'react';
import { Check, ClipboardCheck, FileText, RotateCcw } from 'lucide-react';
import HealthRecordFields, { emptyHealthRecord } from '../components/HealthRecordFields';
import { api } from '../utils/api';

const summaryFields = [
  ['birthDate', 'Date of birth'], ['gender', 'Gender'], ['guardianName', 'Parent or guardian'], ['guardianPhone', 'Contact number'],
  ['bloodType', 'Blood type'], ['allergies', 'Allergies'], ['conditions', 'Medical conditions'], ['medications', 'Current medications'],
  ['hospitalizationDetails', 'Hospitalization'], ['g6pdDeficiency', 'G6PD deficiency'], ['regularMedicationName', 'Regular medication'],
  ['therapistName', 'Therapy professional'], ['therapyInterventions', 'Therapy/intervention occasions'], ['concernsDetails', 'Family concerns'],
];
const documentLabels = [['psychiatricEvaluation', 'Psychiatric evaluation'], ['diagnosticAssessment', 'Diagnostic assessment'], ['medicationRecords', 'Medication records']];
const illnessLabels = {
  pastIllness: [['chickenpox', 'Chickenpox'], ['pneumonia', 'Pneumonia'], ['dengue', 'Dengue'], ['measles', 'Measles'], ['gastroenteritis', 'Gastroenteritis'], ['amoebasis', 'Amoebiasis'], ['typhoidFever', 'Typhoid fever'], ['heartDisease', 'Heart disease'], ['asthma', 'Asthma'], ['headInjury', 'Head injury']],
  presentIllness: [['allergicRhinitis', 'Allergic rhinitis'], ['hyperacidity', 'Hyperacidity'], ['asthma', 'Asthma'], ['skinDisorder', 'Skin disorder'], ['eyeDisorder', 'Eye disorder']],
};
const homeMedicationLabels = [['pain', 'Pain reliever', 'painName'], ['fever', 'Fever medicine', 'feverName'], ['allergies', 'Allergy medicine', 'allergiesName'], ['stomachache', 'Stomach medicine', 'stomachacheName']];
const defaultReceipts = () => Object.fromEntries(documentLabels.map(([field]) => [field, false]));

export default function HealthRecordReview({ data }) {
  const [submissions, setSubmissions] = useState([]);
  const [history, setHistory] = useState([]);
  const [historyOffset, setHistoryOffset] = useState(null);
  const [loadingMoreHistory, setLoadingMoreHistory] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [notes, setNotes] = useState({});
  const [receiptForms, setReceiptForms] = useState({});
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [patientId, setPatientId] = useState('');
  const [schoolYear, setSchoolYear] = useState(data.settings?.schoolYear || '');
  const [paperAnswers, setPaperAnswers] = useState(emptyHealthRecord);
  const [guardianSignaturePresent, setGuardianSignaturePresent] = useState(false);
  const [studentSignaturePresent, setStudentSignaturePresent] = useState(false);
  const [transcribing, setTranscribing] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [result, prior] = await Promise.all([
        api.get('/api/nurse/health-record-submissions'),
        api.get('/api/nurse/health-record-submissions?history=true&offset=0'),
      ]);
      setSubmissions(result.submissions || []);
      setHistory(prior.submissions || []);
      setHistoryOffset(prior.nextOffset ?? null);
      setReceiptForms((current) => Object.fromEntries([...(result.submissions || []), ...(prior.submissions || [])].map((submission) => [submission.id, current[submission.id] || submission.documents_received || defaultReceipts()])));
    } catch (loadError) { setError(loadError.message || 'Submissions could not be loaded.'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const loadMoreHistory = async () => {
    if (historyOffset === null || loadingMoreHistory) return;
    setLoadingMoreHistory(true);
    try {
      const result = await api.get(`/api/nurse/health-record-submissions?history=true&offset=${historyOffset}`);
      setHistory((current) => [...current, ...(result.submissions || [])]);
      setHistoryOffset(result.nextOffset ?? null);
    } catch (loadError) { setError(loadError.message || 'Older health record history could not be loaded.'); }
    finally { setLoadingMoreHistory(false); }
  };

  const review = async (submission, action) => {
    setBusyId(submission.id); setError(''); setMessage('');
    try {
      await api.post(`/api/nurse/health-record-submissions/${encodeURIComponent(submission.id)}/review`, {
        action,
        version: submission.version,
        notes: notes[submission.id] || '',
        documentsReceived: receiptForms[submission.id] || submission.documents_received || defaultReceipts(),
      });
      setMessage(action === 'accept' ? 'Submission accepted and added to the patient profile.' : 'Changes requested. The submission remains available in the review list.');
      await load();
    } catch (reviewError) { setError(reviewError.message || 'The submission could not be reviewed.'); }
    finally { setBusyId(''); }
  };

  const transcribe = async (event) => {
    event.preventDefault();
    setTranscribing(true); setError(''); setMessage('');
    try {
      await api.post(`/api/nurse/health-records/${encodeURIComponent(patientId)}/transcribe`, {
        schoolYear,
        payload: paperAnswers,
        paperSignaturePresence: { guardianPresent: guardianSignaturePresent, studentPresent: studentSignaturePresent },
      });
      setMessage('Paper form transcription entered and added to the nurse review queue. No paper image was stored.');
      setPaperAnswers(emptyHealthRecord()); setGuardianSignaturePresent(false); setStudentSignaturePresent(false);
      await load();
    } catch (transcribeError) { setError(transcribeError.message || 'The paper form could not be transcribed.'); }
    finally { setTranscribing(false); }
  };

  const students = (data.students || []).filter((patient) => patient.patientType !== 'faculty');
  return (
    <div className="form-page health-record-review-page">
      <div className="page-intro"><div><p className="section-kicker">Patient care</p><h2>Health record review</h2><p>Review guardian submissions before they update patient profiles. Paper signature information is recorded as presence only.</p></div><span className="status-chip warn">Review before live use</span></div>
      {error && <div className="error-banner" role="alert">{error}</div>}{message && <div className="success-message" role="status">{message}</div>}

      <section className="panel table-panel"><div className="panel-heading"><div><h3>Awaiting nurse review</h3><p>{submissions.length} record{submissions.length === 1 ? '' : 's'} in the review queue</p></div><button type="button" className="secondary-btn" onClick={load} disabled={loading}><RotateCcw size={14} /> Refresh</button></div>
        {loading ? <p className="field-hint">Loading submissions…</p> : submissions.length ? <div className="review-submission-list">{submissions.map((submission) => <article className="review-submission" key={submission.id}>
          <div className="panel-heading"><div><p className="section-kicker">{submission.source === 'paper' ? 'Paper transcription' : 'Guardian online submission'}</p><h3>{submission.patient_name || 'Student'} · {submission.student_id || 'Student ID unavailable'}</h3><p>{[submission.grade_level, submission.school_year, `Revision ${submission.revision}`, submission.guardian_name].filter(Boolean).join(' · ')}</p></div><span className={`status-chip ${submission.status === 'changes_requested' ? 'warn' : 'success'}`}>{submission.status === 'changes_requested' ? 'Changes requested' : 'Pending review'}</span></div>
          {submission.source === 'paper' && <div className="paper-signature-metadata"><strong>Paper signature presence:</strong> guardian {submission.paper_signature_presence?.guardianPresent ? 'present' : 'not marked'}; student {submission.paper_signature_presence?.studentPresent ? 'present' : 'not marked'}. No signature image is stored.</div>}
          <details><summary>Review submitted answers</summary><RecordAnswers payload={submission.payload} /></details>
          <fieldset className="form-section document-receipt-review"><legend className="section-title">Documents received by clinic</legend><p className="field-hint">These are nurse-verified receipt statuses. Guardian answers about documents submitted remain separate.</p><div className="checkbox-group">{documentLabels.map(([field, label]) => <label className="checkbox-label" key={field}><input type="checkbox" checked={receiptForms[submission.id]?.[field] === true} onChange={(event) => setReceiptForms((current) => ({ ...current, [submission.id]: { ...(current[submission.id] || submission.documents_received || defaultReceipts()), [field]: event.target.checked } }))} disabled={busyId === submission.id} />{label} received</label>)}</div></fieldset>
          <label>Feedback visible to guardian<textarea maxLength={2000} rows={2} value={notes[submission.id] || ''} onChange={(event) => setNotes((current) => ({ ...current, [submission.id]: event.target.value }))} disabled={busyId === submission.id} placeholder="Tell the guardian what to update. This feedback is visible to them." /></label>
          <div className="form-actions"><button type="button" className="secondary-btn" onClick={() => review(submission, 'request_changes')} disabled={busyId === submission.id}><RotateCcw size={15} /> Request changes</button><button type="button" className="primary-btn" onClick={() => review(submission, 'accept')} disabled={busyId === submission.id}><Check size={15} /> Accept into patient profile</button></div>
        </article>)}</div> : <div className="empty-state health-review-empty-state">No submissions are awaiting nurse review.</div>}
      </section>

      <section className="panel table-panel"><div className="panel-heading"><div><h3>Accepted and superseded records</h3><p>Review retained submissions by school year and revision.</p></div></div>{history.length ? <div className="review-history-list">{history.map((record) => <details className="review-history-item" key={record.id}><summary>{record.patient_name || 'Student'} · {record.student_id || 'Student ID unavailable'} · {record.school_year} · revision {record.revision} · {record.status}</summary><p>{record.source === 'paper' ? 'Transcribed from a paper form' : `Guardian: ${record.guardian_name || 'account unavailable'}`} · Reviewed {record.nurse_reviewed_at ? new Date(record.nurse_reviewed_at).toLocaleString() : 'not recorded'}</p>{record.nurse_notes && <p><strong>Feedback visible to guardian:</strong> {record.nurse_notes}</p>}<RecordAnswers payload={record.payload} /><p><strong>Clinic document receipt:</strong> {documentLabels.map(([field, label]) => `${label}: ${record.documents_received?.[field] ? 'received' : 'not confirmed'}`).join(' · ')}</p></details>)}</div> : <p className="empty-state">No accepted or superseded health record revisions are available.</p>}{historyOffset !== null && <div className="form-actions"><button className="secondary-btn" type="button" onClick={loadMoreHistory} disabled={loadingMoreHistory}>{loadingMoreHistory ? 'Loading older records…' : 'Load older records'}</button></div>}</section>

      <section className="panel form-panel"><div className="panel-heading"><div><p className="section-kicker">Paper workflow</p><h3><FileText size={17} /> Transcribe a paper health record</h3><p>Enter the same health fields from the paper record. Do not upload or attach a scan.</p></div></div>
        <form onSubmit={transcribe}>
          <div className="two-fields"><label>Student record<select value={patientId} onChange={(event) => setPatientId(event.target.value)} required disabled={transcribing}><option value="">Select a student</option>{students.map((student) => <option key={student.id} value={student.id}>{student.name} · {student.studentId || student.id}</option>)}</select></label><label>School year<input maxLength={40} value={schoolYear} onChange={(event) => setSchoolYear(event.target.value)} required disabled={transcribing} /></label></div>
          {patientId && <p className="field-hint">School identity is taken from the roster. Only guardian supplied health answers are entered below.</p>}
          <HealthRecordFields value={paperAnswers} onChange={setPaperAnswers} disabled={transcribing} />
          <fieldset className="form-section"><legend className="section-title">Paper signature presence</legend><p className="field-hint">Record whether a signature was present on the paper. Do not capture a signature image or claim an online attestation.</p><div className="checkbox-group"><label className="checkbox-label"><input type="checkbox" checked={guardianSignaturePresent} onChange={(event) => setGuardianSignaturePresent(event.target.checked)} disabled={transcribing} /> Guardian signature present on paper</label><label className="checkbox-label"><input type="checkbox" checked={studentSignaturePresent} onChange={(event) => setStudentSignaturePresent(event.target.checked)} disabled={transcribing} /> Student signature present on paper</label></div></fieldset>
          <div className="form-actions"><button className="primary-btn" type="submit" disabled={transcribing || !patientId || !schoolYear.trim()}><ClipboardCheck size={15} /> {transcribing ? 'Saving transcription…' : 'Save for nurse review'}</button></div>
        </form>
      </section>
    </div>
  );
}

function RecordAnswers({ payload = {} }) {
  const display = (value) => value === undefined || value === null || value === '' ? 'Not answered' : value;
  const binary = (value) => value === true ? 'Yes' : value === false ? 'No' : 'Unknown / not answered';
  const healthAnswer = (valueKey, statusKey) => {
    const status = payload[statusKey];
    if (status === 'none') return 'None reported';
    if (status === 'unknown' || !status) return payload[valueKey] ? `Unknown; last accepted information: ${payload[valueKey]}` : 'Unknown / not answered';
    return display(payload[valueKey]);
  };
  return <>
    <dl className="portal-detail-grid">{summaryFields.map(([key, label]) => {
      const statusKey = { allergies: 'allergiesStatus', conditions: 'conditionsStatus', medications: 'medicationsStatus' }[key];
      return <div className="portal-detail-field" key={key}><dt>{label}</dt><dd>{statusKey ? healthAnswer(key, statusKey) : display(payload[key])}</dd></div>;
    })}<div className="portal-detail-field"><dt>Hospitalized in past year</dt><dd>{binary(payload.hospitalizationHistory)}</dd></div><div className="portal-detail-field"><dt>Receiving therapy/intervention</dt><dd>{binary(payload.onTherapy)}</dd></div><div className="portal-detail-field"><dt>Family health concern</dt><dd>{binary(payload.hasConcerns)}</dd></div></dl>
    <div className="review-answer-groups">{Object.entries(illnessLabels).map(([group, fields]) => <section key={group}><h4>{group === 'pastIllness' ? 'Past illnesses' : 'Current conditions'}</h4><ul>{fields.map(([field, label]) => <li key={field}>{label}: {binary(payload[group]?.[field])}</li>)}{group === 'presentIllness' && <><li>Skin disorder, specify: {display(payload.presentIllness?.skinDisorderDetails)}</li><li>Eye disorder, specify: {display(payload.presentIllness?.eyeDisorderDetails)}</li></>}<li>Other: {display(payload[group]?.[group === 'pastIllness' ? 'otherPastIllness' : 'otherPresentIllness'])}</li></ul></section>)}
      <section><h4>Medication kept at home</h4><ul>{homeMedicationLabels.map(([field, label, nameField]) => <li key={field}>{label}: {binary(payload.medicationAtHome?.[field])}{payload.medicationAtHome?.[field] === true && payload.medicationAtHome?.[nameField] ? ` · ${payload.medicationAtHome[nameField]}` : ''}</li>)}<li>Other: {display(payload.medicationAtHome?.otherMedication)}</li></ul></section>
      <section><h4>Documents guardian reports submitting</h4><ul>{documentLabels.map(([field, label]) => <li key={field}>{label}: {binary(payload.documentsSubmitted?.[field])}</li>)}</ul></section>
    </div>
  </>;
}
