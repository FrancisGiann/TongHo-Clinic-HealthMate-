import { useEffect, useRef, useState } from 'react';
import { Check, ClipboardCheck, FileText, RotateCcw, Search } from 'lucide-react';
import HealthRecordFields, { emptyHealthRecord } from '../components/HealthRecordFields';
import { api } from '../utils/api';
import './HealthRecordReview.css';

const summaryFields = [
  ['motherName', 'Mother’s name'], ['fatherName', 'Father’s name'], ['guardianRelation', 'Relationship'], ['lastTreatmentDate', 'Last treatment date'], ['takingRegularMedication', 'Taking regular medication'], ['birthDate', 'Date of birth'], ['gender', 'Gender'], ['guardianName', 'Parent or guardian'], ['guardianPhone', 'Contact number'],
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
  const [view, setView] = useState('queue');
  const [query, setQuery] = useState('');
  const [studentQuery, setStudentQuery] = useState('');
  const [paperStep, setPaperStep] = useState(0);
  const [queueOffset, setQueueOffset] = useState(null);
  const requestId = useRef(0);
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
    const currentRequest = ++requestId.current;
    setLoading(true); setError('');
    const search = `&q=${encodeURIComponent(query.trim())}`;
    try {
      const [result, prior] = await Promise.all([
        api.get(`/api/nurse/health-record-submissions?offset=0${search}`),
        api.get(`/api/nurse/health-record-submissions?history=true&offset=0${search}`),
      ]);
      if (currentRequest !== requestId.current) return;
      setQueueOffset(result.nextOffset ?? null);
      setSubmissions(result.submissions || []);
      setHistory(prior.submissions || []);
      setHistoryOffset(prior.nextOffset ?? null);
      setReceiptForms((current) => ({ ...current, ...Object.fromEntries([...(result.submissions || []), ...(prior.submissions || [])].map((submission) => [submission.id, current[submission.id] || submission.documents_received || defaultReceipts()])) }));
    } catch (loadError) { if (currentRequest === requestId.current) setError(loadError.message || 'Submissions could not be loaded.'); }
    finally { if (currentRequest === requestId.current) setLoading(false); }
  };

  useEffect(() => {
    ++requestId.current;
    setLoading(true);
    const timer = setTimeout(load, 250);
    return () => { clearTimeout(timer); ++requestId.current; };
  }, [query]);

  const loadMoreHistory = async (queue = false) => {
    const offset = queue ? queueOffset : historyOffset;
    if (offset === null || loadingMoreHistory) return;
    const currentRequest = requestId.current;
    setLoadingMoreHistory(true);
    try {
      const result = await api.get(`/api/nurse/health-record-submissions?history=${!queue}&offset=${offset}&q=${encodeURIComponent(query.trim())}`);
      if (currentRequest !== requestId.current) return;
      (queue ? setSubmissions : setHistory)((current) => [...current, ...(result.submissions || [])]);
      (queue ? setQueueOffset : setHistoryOffset)(result.nextOffset ?? null);
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
    if (!patientId || !schoolYear.trim() || transcribing) return;
    if (paperStep < 2) { setPaperStep(paperStep + 1); return; }
    setTranscribing(true); setError(''); setMessage('');
    try {
      await api.post(`/api/nurse/health-records/${encodeURIComponent(patientId)}/transcribe`, {
        schoolYear,
        payload: paperAnswers,
        paperSignaturePresence: { guardianPresent: guardianSignaturePresent, studentPresent: studentSignaturePresent },
      });
      setMessage('Paper form transcription entered and added to the nurse review queue. No paper image was stored.');
      setPaperAnswers(emptyHealthRecord()); setGuardianSignaturePresent(false); setStudentSignaturePresent(false); setPatientId(''); setStudentQuery(''); setPaperStep(0);
      await load();
    } catch (transcribeError) { setError(transcribeError.message || 'The paper form could not be transcribed.'); }
    finally { setTranscribing(false); }
  };

  const students = (data.students || []).filter((patient) => patient.patientType !== 'faculty');
  const matchingStudents = students.filter((student) => `${student.name || ''} ${student.studentId || ''}`.toLowerCase().includes(studentQuery.trim().toLowerCase()));
  const selectedStudent = students.find((student) => student.id === patientId);
  const changeStudent = () => {
    const dirty = JSON.stringify(paperAnswers) !== JSON.stringify(emptyHealthRecord()) || guardianSignaturePresent || studentSignaturePresent;
    if (dirty && !window.confirm('Change student and discard the unsaved paper answers?')) return;
    setPatientId(''); setPaperAnswers(emptyHealthRecord()); setGuardianSignaturePresent(false); setStudentSignaturePresent(false); setPaperStep(0);
  };
  return (
    <div className="form-page health-record-review-page">
      <div className="page-intro"><div><h2>Health record review</h2><p>Review guardian submissions before they update patient profiles. Paper signature information is recorded as presence only.</p></div><span className="status-chip warn">Review before live use</span></div>
      {error && <div className="error-banner" role="alert">{error}</div>}{message && <div className="success-message" role="status">{message}</div>}

      <nav className="health-review-tabs" aria-label="Health record workflows">{[['queue', 'Awaiting review'], ['history', 'Record history'], ['paper', 'Transcribe paper form']].map(([key, label]) => <button type="button" key={key} className={view === key ? 'active' : ''} aria-current={view === key ? 'page' : undefined} onClick={() => { setView(key); setMessage(''); }}>{label}</button>)}</nav>
      {view !== 'paper' && <div className="health-review-search"><label htmlFor="review-student-search">Search by student name or ID</label><div><Search size={17} aria-hidden="true" /><input id="review-student-search" type="search" maxLength={200} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Enter a student name or ID" />{query && <button className="secondary-btn" type="button" onClick={() => setQuery('')}>Clear search</button>}</div></div>}
      {view === 'queue' && <section className="panel table-panel"><div className="panel-heading"><div><h3>Awaiting nurse review</h3><p>{submissions.length}{queueOffset !== null ? '+' : ''} record{submissions.length === 1 ? '' : 's'} in the review queue</p></div><button type="button" className="secondary-btn" onClick={load} disabled={loading}><RotateCcw size={14} /> Refresh</button></div>
        {loading ? <p className="field-hint" role="status">Loading submissions…</p> : submissions.length ? <div className="review-submission-list">{submissions.map((submission) => <details className="review-submission" name="review-queue" key={submission.id}><summary className="review-record-summary"><span><strong>{submission.patient_name || 'Student'}</strong><span>{[submission.student_id || 'Student ID unavailable', submission.grade_level, submission.school_year].filter(Boolean).join(' · ')}</span></span><span className={`status-chip ${submission.status === 'changes_requested' ? 'warn' : 'success'}`}>{submission.status === 'changes_requested' ? 'Changes requested' : 'Pending review'}</span><span>Open review</span></summary><div className="review-record-body">
          <div className="panel-heading"><div><p>{submission.source === 'paper' ? 'Paper transcription' : 'Guardian online submission'}</p><h3>{submission.patient_name || 'Student'} · {submission.student_id || 'Student ID unavailable'}</h3><p>{[submission.grade_level, submission.school_year, `Revision ${submission.revision}`, submission.guardian_name].filter(Boolean).join(' · ')}</p></div><span className={`status-chip ${submission.status === 'changes_requested' ? 'warn' : 'success'}`}>{submission.status === 'changes_requested' ? 'Changes requested' : 'Pending review'}</span></div>
          {submission.source === 'paper' && <div className="paper-signature-metadata"><strong>Paper signature presence:</strong> guardian {submission.paper_signature_presence?.guardianPresent ? 'present' : 'not marked'}; student {submission.paper_signature_presence?.studentPresent ? 'present' : 'not marked'}. No signature image is stored.</div>}
          <details><summary>Review submitted answers</summary><RecordAnswers payload={submission.payload} /></details>
          <fieldset className="form-section document-receipt-review"><legend className="section-title">Documents received by clinic</legend><p className="field-hint">These are nurse-verified receipt statuses. Guardian answers about documents submitted remain separate.</p><div className="checkbox-group">{documentLabels.map(([field, label]) => <label className="checkbox-label" key={field}><input type="checkbox" checked={(receiptForms[submission.id] || submission.documents_received || defaultReceipts())[field] === true} onChange={(event) => setReceiptForms((current) => ({ ...current, [submission.id]: { ...(current[submission.id] || submission.documents_received || defaultReceipts()), [field]: event.target.checked } }))} disabled={busyId === submission.id} />{label} received</label>)}</div></fieldset>
          <label>Feedback visible to guardian<textarea maxLength={2000} rows={2} value={notes[submission.id] || ''} onChange={(event) => setNotes((current) => ({ ...current, [submission.id]: event.target.value }))} disabled={busyId === submission.id} placeholder="Tell the guardian what to update. This feedback is visible to them." /></label>
          <div className="form-actions"><button type="button" className="secondary-btn" onClick={() => review(submission, 'request_changes')} disabled={busyId === submission.id}><RotateCcw size={15} /> Request changes</button><button type="button" className="primary-btn" onClick={() => review(submission, 'accept')} disabled={busyId === submission.id}><Check size={15} /> Accept into patient profile</button></div>
        </div></details>)}</div> : <div className="empty-state health-review-empty-state">{query.trim() ? 'No submissions match this student. Try another name or ID, or clear the search.' : 'No submissions are awaiting nurse review.'}</div>}
      {queueOffset !== null && <div className="form-actions"><button type="button" className="secondary-btn" onClick={() => loadMoreHistory(true)} disabled={loadingMoreHistory || loading}>{loadingMoreHistory ? 'Loading records…' : 'Load more submissions'}</button></div>}</section>}

      {view === 'history' && <section className="panel table-panel"><div className="panel-heading"><div><h3>Accepted and superseded records</h3><p>Review retained submissions by school year and revision.</p></div></div>{loading ? <p role="status">Loading records…</p> : history.length ? <div className="review-history-list">{history.map((record) => <details className="review-history-item" key={record.id}><summary>{record.patient_name || 'Student'} · {record.student_id || 'Student ID unavailable'} · {record.school_year} · revision {record.revision} · {record.status}</summary><p>{record.source === 'paper' ? 'Transcribed from a paper form' : `Guardian: ${record.guardian_name || 'account unavailable'}`} · Reviewed {record.nurse_reviewed_at ? new Date(record.nurse_reviewed_at).toLocaleString() : 'not recorded'}</p>{record.nurse_notes && <p><strong>Feedback visible to guardian:</strong> {record.nurse_notes}</p>}<RecordAnswers payload={record.payload} /><p><strong>Clinic document receipt:</strong> {documentLabels.map(([field, label]) => `${label}: ${record.documents_received?.[field] ? 'received' : 'not confirmed'}`).join(' · ')}</p></details>)}</div> : <p className="empty-state">{query.trim() ? 'No history matches this student. Try another name or ID, or clear the search.' : 'No accepted or superseded health record revisions are available.'}</p>}{historyOffset !== null && <div className="form-actions"><button className="secondary-btn" type="button" onClick={() => loadMoreHistory()} disabled={loadingMoreHistory}>{loadingMoreHistory ? 'Loading older records…' : 'Load older records'}</button></div>}</section>}

      {view === 'paper' && <section className="panel form-panel"><div className="panel-heading"><div><h3><FileText size={17} /> Transcribe a paper health record</h3><p>Enter the same health fields from the paper record. Do not upload or attach a scan.</p></div></div>
        <form onSubmit={transcribe}>
          {!selectedStudent ? <div className="paper-student-picker"><label htmlFor="paper-student-search">Find a student by name or ID</label><input id="paper-student-search" type="search" value={studentQuery} onChange={(event) => setStudentQuery(event.target.value)} placeholder="Search the student roster" disabled={transcribing} />{studentQuery && <button type="button" className="secondary-btn" onClick={() => setStudentQuery('')}>Clear student search</button>}<p className="field-hint" role="status">{matchingStudents.length ? `${matchingStudents.length} matching students${matchingStudents.length > 20 ? ' · showing first 20; refine your search' : ''}` : students.length ? 'No students match. Try another name or ID.' : 'No student records are available. Add a student to the roster first.'}</p><ul className="paper-student-results">{matchingStudents.slice(0, 20).map((student) => <li key={student.id}><button type="button" onClick={() => { setPatientId(student.id); setPaperStep(0); }}><strong>{student.name}</strong><span>{[student.studentId || 'Student ID unavailable', student.gradeLevel, student.section].filter(Boolean).join(' · ')}</span></button></li>)}</ul></div> : <>
          <div className="paper-selected-student"><div><strong>{selectedStudent.name}</strong><span>{[selectedStudent.studentId, selectedStudent.gradeLevel, selectedStudent.section].filter(Boolean).join(' · ')}</span></div><button type="button" className="secondary-btn" onClick={changeStudent} disabled={transcribing}>Change student</button></div>
          <label>School year<input maxLength={40} value={schoolYear} onChange={(event) => setSchoolYear(event.target.value)} required disabled={transcribing} /></label>
          <p className="field-hint">School identity comes from the roster. Enter the guardian’s paper answers below; blanks remain unknown.</p>
          <nav className="health-review-tabs paper-section-tabs" aria-label="Paper form sections">{['Student and family', 'Health information', 'Care and signatures'].map((label, index) => <button key={label} type="button" className={paperStep === index ? 'active' : ''} aria-current={paperStep === index ? 'step' : undefined} disabled={transcribing} onClick={() => setPaperStep(index)}>{index + 1}. {label}</button>)}</nav>
          <HealthRecordFields value={paperAnswers} onChange={setPaperAnswers} disabled={transcribing} section={paperStep} />
          {paperStep === 2 && <>
          <fieldset className="form-section"><legend className="section-title">Paper signature presence</legend><p className="field-hint">Record whether a signature was present on the paper. Do not capture a signature image or claim an online attestation.</p><div className="checkbox-group"><label className="checkbox-label"><input type="checkbox" checked={guardianSignaturePresent} onChange={(event) => setGuardianSignaturePresent(event.target.checked)} disabled={transcribing} /> Guardian signature present on paper</label><label className="checkbox-label"><input type="checkbox" checked={studentSignaturePresent} onChange={(event) => setStudentSignaturePresent(event.target.checked)} disabled={transcribing} /> Student signature present on paper</label></div></fieldset>
          </>}
          <div className="form-actions">{paperStep > 0 && <button type="button" className="secondary-btn" onClick={() => setPaperStep(paperStep - 1)} disabled={transcribing}>Previous section</button>}{paperStep < 2 ? <button className="primary-btn" type="submit">Next section</button> : <button className="primary-btn" type="submit" disabled={transcribing || !patientId || !schoolYear.trim()}><ClipboardCheck size={15} /> {transcribing ? 'Saving transcription…' : 'Save for nurse review'}</button>}</div>
          </>}
        </form>
      </section>}
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
