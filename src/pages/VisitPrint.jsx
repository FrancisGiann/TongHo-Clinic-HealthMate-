import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { complaintLabels, initialPass, resolvePrintContext, summaryFields } from '../utils/printDocuments.js';
import { PassDocument, SummaryDocument } from '../components/print/PrintDocuments.jsx';
import '../components/print/print.css';
import { consultationReportReturn } from '../utils/consultationReport.js';

export default function VisitPrint({ data, user }) {
  const { studentId, visitId, passType } = useParams();
  const [search] = useSearchParams();
  const selectedVisit = visitId || search.get('visit');
  const context = resolvePrintContext(data, user, studentId, selectedVisit, passType);
  const fromReports = !passType && search.get('from') === 'reports' && user?.role === 'school_nurse';
  if (!context) return <section className="panel"><h2>Document unavailable</h2><p>A school nurse must select a valid student and consultation.</p><Link to={fromReports ? consultationReportReturn() : '/'}>{fromReports ? 'Back to Reports' : 'Back'}</Link></section>;
  return <PrintWorkspace key={`${user.id}:${studentId}:${selectedVisit || ''}:${passType || 'summary'}`} context={context} type={passType} fromReports={fromReports} />;
}
function PrintWorkspace({ context, type, fromReports }) {
  const [draft, setDraft] = useState(() => initialPass(context));
  const [preview, setPreview] = useState(!type);
  const [fits, setFits] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const root = useRef(null);
  const navigate = useNavigate();
  const back = fromReports ? consultationReportReturn(context.student.id, context.visit.id) : `/students/${encodeURIComponent(context.student.id)}`;
  const update = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  useEffect(() => {
    const escape = (event) => { if (event.key === 'Escape') { if (type && preview) setPreview(false); else navigate(back); } };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [back, navigate, preview, type]);
  useLayoutEffect(() => {
    if (!preview) return;
    const measure = () => setFits(!type || [...root.current.querySelectorAll('.pass-copy')].every((element) => element.scrollHeight <= element.clientHeight + 1 && element.scrollWidth <= element.clientWidth + 1));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root.current);
    return () => observer.disconnect();
  }, [preview, draft, type]);
  useEffect(() => {
    document.body.classList.add('document-print-active');
    document.body.classList.toggle('document-print-blocked', !preview || !fits);
    return () => document.body.classList.remove('document-print-active', 'document-print-blocked');
  }, [preview, fits]);
  const field = (key, label, inputType = 'text', maxLength = 160) => <label key={key}>{label}<input type={inputType} value={draft[key]} maxLength={maxLength} onChange={(event) => update(key, event.target.value)} /></label>;
  return <section className="print-workspace">
    <div className="page-intro"><div><h2>{type ? (type === 'clinic' ? 'Clinic Pass' : 'Student Gate Pass') : 'Consultation summary'}</h2><p>{type ? 'Fill and print. This form is not saved.' : 'Only the selected consultation is included.'}</p></div></div>
    <div className="print-actions"><Link className="secondary-btn" to={back}>{fromReports ? 'Cancel / Back to Reports' : 'Cancel / Back to profile'}</Link>{preview && type && <button className="secondary-btn" onClick={() => setPreview(false)}>Back to form</button>}{preview && <button className="primary-btn" disabled={!fits} onClick={() => window.print()}>Print</button>}</div>
    {!type && <p className="field-hint">Current grade, section and school year are omitted because they are not historical consultation snapshots. Unverified summary text and private notes are excluded.</p>}
    {type && !preview && <form className="panel pass-editor" onSubmit={(event) => { event.preventDefault(); setPreview(true); }}>
      <p>Check the year, grade and teacher: suggestions come from the current profile, not a historical snapshot. Time fields are optional and are never filled from consultation save time.</p>
      <div className="pass-fields">{field('schoolYear', 'School year')}{field('date', 'Date', 'date')}{field('name', 'Student name')}{field('grade', 'Grade / section')}
        {type === 'clinic' ? <>{field('teacher', 'Teacher')}<fieldset><legend>Complaints</legend>{complaintLabels.map((label) => <label className="check-label" key={label}><input type="checkbox" checked={draft.complaints.includes(label)} onChange={(event) => update('complaints', event.target.checked ? [...draft.complaints, label] : draft.complaints.filter((item) => item !== label))} />{label}</label>)}</fieldset>{field('other', 'Others', 'text', 300)}<label>Nurse notes<textarea rows="4" maxLength={2000} value={draft.notes} onChange={(event) => update('notes', event.target.value)} /></label>{field('timeIn', 'Time in', 'time')}{field('timeOut', 'Time out', 'time')}<p>Nurse attribution: {draft.nurse || 'Not configured in clinic settings'}</p></> : <><label>Reason<textarea rows="3" maxLength={300} value={draft.reason} onChange={(event) => update('reason', event.target.value)} /></label><label>Departure<select value={draft.departure} onChange={(event) => update('departure', event.target.value)}><option value="">Leave blank</option><option value="alone">Left Alone</option><option value="fetched">Fetched by</option></select></label>{draft.departure === 'fetched' && <>{field('fetcher', 'Fetcher printed name')}{field('relationship', 'Relationship')}</>}{field('timeLeft', 'Time Left', 'time')}{field('timeArrived', 'Time Arrived (optional)', 'time')}<p>Signatures are completed by hand. Time Arrived has no assumed meaning.</p></>}
      </div><label className="check-label"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />I checked the suggested identity, date, year and grade for this form.</label><button className="primary-btn" disabled={!confirmed}>Preview two copies</button>
    </form>}
    {preview && <><p className="field-hint">Use A4 {type ? 'landscape' : 'portrait'}, 100% scale, with browser headers and footers off. Canceling print keeps this preview open.</p>{!fits && type && <p className="error-banner" role="alert">This form exceeds the two-copy page. Go back and shorten the temporary text before printing; nothing will be clipped or reduced.</p>}</>}
    {preview && createPortal(<div ref={root} className={`document-print-root ${type ? 'pass-preview' : 'summary-preview'}`}><style>{`@media print { @page { size: A4 ${type ? 'landscape' : 'portrait'}; margin: 10mm; } }`}</style>{type ? <PassDocument draft={draft} type={type} /> : <SummaryDocument fields={summaryFields(context)} />}</div>, document.body)}
  </section>;
}
