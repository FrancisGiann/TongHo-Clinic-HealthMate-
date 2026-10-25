import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from 'react-dom';
import { useSearchParams } from "react-router-dom";
import { BarChart3, Download, FileText, PieChart, Save } from "lucide-react";
import { api } from "../utils/api";
import { formatManilaDateTime, manilaCalendarDate, shiftCalendarDate } from "../utils/dateTime";
import { clinicReportPrintModel, formatHealthField, patientSummaryPrintModel } from '../utils/reportPrint.js';
import StudentPicker from '../components/StudentPicker';
import IndividualConsultationReport from '../components/IndividualConsultationReport';
import '../components/print/print.css';
import "./Reports.css";
export default function Reports({ data = {}, user }) {
  const [printPreview, setPrintPreview] = useState(false);
  const printPreviewRef = useRef(null);
  const printPreviewReturnFocusRef = useRef(null);
  const today = manilaCalendarDate();
  const [searchParams, setSearchParams] = useSearchParams();
  const reportTab = user?.role === 'school_nurse' && ['patient', 'consultation'].includes(searchParams.get('tab')) ? searchParams.get('tab') : 'clinic';
  const initialPeriod = searchParams.get('period') === 'daily' ? 'daily' : 'monthly';
  const [period, setPeriod] = useState(initialPeriod);
  const [start, setStart] = useState(initialPeriod === 'daily' ? today : `${today.slice(0, 8)}01`);
  const [end, setEnd] = useState(today);
  const [serverReport, setServerReport] = useState(null);
  const [snapshots, setSnapshots] = useState([]);
  const [reportLoading, setReportLoading] = useState(true);
  const [snapshotsLoading, setSnapshotsLoading] = useState(true);
  const [snapshotsError, setSnapshotsError] = useState('');
  const [reportMessage, setReportMessage] = useState('');
  const [reportError, setReportError] = useState('');
  const [savingSnapshot, setSavingSnapshot] = useState(false);
  const reportReady = !reportLoading && Boolean(serverReport);
  const [patientId, setPatientId] = useState(searchParams.get('patientId') || '');
  const [summaryStart, setSummaryStart] = useState(`${today.slice(0, 8)}01`);
  const [summaryEnd, setSummaryEnd] = useState(today);
  const [patientSummary, setPatientSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState('');
  const [summaryRetry, setSummaryRetry] = useState(0);
  const summaryPatient = useMemo(() => (data.students || []).find((record) => String(record.id) === String(patientId)), [data.students, patientId]);
  const printReady = reportTab === 'clinic' ? reportReady : Boolean(patientSummary) && !summaryLoading;

  useEffect(() => {
    setPatientId(searchParams.get('patientId') || '');
  }, [searchParams]);
  useEffect(() => {
    let active = true;
    setReportError('');
    setReportMessage('');
    setReportLoading(true);
    setServerReport(null);
    api.get(`/api/reports?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`)
      .then((result) => { if (active) setServerReport(result); })
      .catch((error) => { if (active) setReportError(error.message); })
      .finally(() => { if (active) setReportLoading(false); });
    return () => { active = false; };
  }, [start, end]);
  useEffect(() => {
    if (reportTab !== 'patient' || !patientId) {
      setPatientSummary(null);
      setSummaryError('');
      setSummaryLoading(false);
      return undefined;
    }
    let active = true;
    setSummaryLoading(true);
    setSummaryError('');
    setPatientSummary(null);
    api.get(`/api/reports/patients/${encodeURIComponent(patientId)}/summary?start=${encodeURIComponent(summaryStart)}&end=${encodeURIComponent(summaryEnd)}`)
      .then((result) => { if (active) setPatientSummary(result); })
      .catch((error) => { if (active) setSummaryError(error.message || 'Patient summary could not be loaded.'); })
      .finally(() => { if (active) setSummaryLoading(false); });
    return () => { active = false; };
  }, [reportTab, patientId, summaryStart, summaryEnd, summaryRetry]);
  useEffect(() => {
    document.body.classList.toggle('document-print-active', printPreview);
    if (printPreview) {
      printPreviewReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      printPreviewRef.current?.focus();
      const closeOnEscape = (event) => { if (event.key === 'Escape') setPrintPreview(false); };
      window.addEventListener('keydown', closeOnEscape);
      return () => {
        window.removeEventListener('keydown', closeOnEscape);
        document.body.classList.remove('document-print-active');
        if (printPreviewReturnFocusRef.current?.isConnected) {
          printPreviewReturnFocusRef.current.focus({ preventScroll: true });
        }
      };
    }
    return () => document.body.classList.remove('document-print-active');
  }, [printPreview]);
  useEffect(() => { if (!printReady) setPrintPreview(false); }, [printReady]);
  const exportReport = () => { if (printReady) setPrintPreview(true); };
  const containPrintPreviewFocus = (event) => {
    if (event.key !== 'Tab') return;
    const dialog = event.currentTarget;
    const controls = [...dialog.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      .filter((element) => element.getClientRects().length > 0);
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (!first) {
      event.preventDefault();
      dialog.focus();
    } else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) {
      event.preventDefault();
      first.focus();
    }
  };
  const changeTab = (tab) => {
    const next = new URLSearchParams(searchParams);
    if (['patient', 'consultation'].includes(tab)) next.set('tab', tab);
    else next.delete('tab');
    setSearchParams(next);
  };
  const selectPatient = (id) => {
    setPatientId(id);
    const next = new URLSearchParams(searchParams);
    if (id) next.set('patientId', id); else next.delete('patientId');
    setSearchParams(next);
  };
  useEffect(() => {
    let active = true;
    setSnapshotsLoading(true);
    setSnapshotsError('');
    api.get('/api/reports/snapshots')
      .then((result) => { if (active) setSnapshots(result.snapshots || []); })
      .catch((error) => { if (active) setSnapshotsError(error.message || 'Saved snapshots could not be loaded.'); })
      .finally(() => { if (active) setSnapshotsLoading(false); });
    return () => { active = false; };
  }, []);
  const choosePeriod = (value) => {
    setPeriod(value);
    if (value === 'daily') setStart(today);
    if (value === 'weekly') setStart(shiftCalendarDate(today, -6));
    if (value === 'monthly') setStart(`${today.slice(0, 8)}01`);
    setEnd(today);
  };
  const saveSnapshot = async () => {
    if (savingSnapshot || !reportReady) return;
    setSavingSnapshot(true);
    setReportError('');
    try {
      await api.post('/api/reports/snapshots', { start, end, type: period });
      const result = await api.get('/api/reports/snapshots');
      setSnapshots(result.snapshots || []);
      setSnapshotsError('');
      setReportMessage(`Report snapshot saved for ${start} to ${end}.`);
    } catch (error) { setReportError(error.message); }
    finally { setSavingSnapshot(false); }
  };
  const complaintCounts = serverReport?.complaints || {};
  const complaintSuppressed = serverReport?.suppressedAggregates?.includes('complaints');
  const visitTotalSuppressed = serverReport?.suppressedTotals?.includes('visits');
  const topComplaint =
    Object.entries(complaintCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ||
    "None";
  const gradeCounts = serverReport?.grades || {};
  
  return (
    <div className="form-page reports-page">
      {user?.role === 'school_nurse' && <div className="report-tabs" role="tablist" aria-label="Report type"><button type="button" role="tab" aria-selected={reportTab === 'clinic'} className={reportTab === 'clinic' ? 'active' : ''} onClick={() => changeTab('clinic')}>Clinic report</button><button type="button" role="tab" aria-selected={reportTab === 'patient'} className={reportTab === 'patient' ? 'active' : ''} onClick={() => changeTab('patient')}>Patient summary</button><button type="button" role="tab" aria-selected={reportTab === 'consultation'} className={reportTab === 'consultation' ? 'active' : ''} onClick={() => changeTab('consultation')}>Individual consultation</button></div>}
      {reportTab === 'consultation' ? <IndividualConsultationReport data={data} user={user} /> : reportTab === 'patient' ? <PatientSummaryPanel
        patients={data.students || []} patientId={patientId} patient={summaryPatient}
        start={summaryStart} end={summaryEnd} setStart={setSummaryStart} setEnd={setSummaryEnd}
        summary={patientSummary} loading={summaryLoading} error={summaryError}
        retry={() => setSummaryRetry((value) => value + 1)} onSelectPatient={selectPatient}
        onPrint={exportReport} printPreview={printPreview} closePreview={() => setPrintPreview(false)}
      /> : <>
      <div className="page-intro">
        <div>
          <h2>Reports & insights</h2>
          <p>Understand the patterns behind your clinic’s daily work.</p>
        </div>
        <div className="intro-actions"><button type="button" className="secondary-btn" onClick={saveSnapshot} disabled={!reportReady || savingSnapshot}><Save size={16} /> {savingSnapshot ? 'Saving…' : 'Save snapshot'}</button><button type="button" className="secondary-btn" onClick={exportReport} disabled={!reportReady}><Download size={16} /> Print / PDF</button></div>
      </div>
      <section className="panel inline-entry-form"><div className="report-filter-grid"><label>Report period<select value={period} onChange={(event) => choosePeriod(event.target.value)}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="custom">Custom</option></select></label><label>Start date<input type="date" value={start} max={end} onChange={(event) => { setPeriod('custom'); setStart(event.target.value); }} /></label><label>End date<input type="date" value={end} min={start} max={today} onChange={(event) => { setPeriod('custom'); setEnd(event.target.value); }} /></label></div>{reportLoading && <p className="field-hint" role="status">Loading the selected date range…</p>}{reportMessage && <p className="success-message" role="status">{reportMessage}</p>}{reportError && <div className="error-banner" role="alert">{reportError}</div>}</section>
      <div className="report-kpis">
        <div>
          <span>Visits this period</span>
          <strong>{!reportReady ? (reportLoading ? 'Loading…' : 'Unavailable') : serverReport.suppressedTotals?.includes('visits') ? 'Withheld' : serverReport.totals?.visits ?? 0}</strong>
          <small>{start} to {end}</small>
        </div>
        <div>
          <span>Top complaint</span>
          <strong className="report-word">{complaintSuppressed ? 'Withheld' : Object.entries(serverReport?.complaints || complaintCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || topComplaint}</strong>
          <small>{complaintSuppressed ? 'Small categories are suppressed' : 'Most recorded concern'}</small>
        </div>
      </div>
      <section className="panel table-panel"><div className="panel-heading"><h3>Patients with visits by type</h3></div>{serverReport?.suppressedAggregates?.includes('patientTypes') ? <p className="field-hint" role="note">Small patient-type groups are suppressed to protect privacy.</p> : Object.entries(serverReport?.patientTypes || {}).map(([type, count]) => <div className="queue-row" key={type}><span>{type === 'faculty' ? 'Faculty' : 'Students'}</span><strong>{count}</strong></div>)}{serverReport && !serverReport.suppressedAggregates?.includes('patientTypes') && !Object.keys(serverReport.patientTypes || {}).length && <p className="empty-state">No visits were recorded in this period.</p>}</section>
      <div className="reports-grid">
        <section className="panel report-chart">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">Visit volume</p>
              <h3>Visits by day</h3>
            </div>
            <BarChart3 size={19} className="chart-icon" />
          </div>
          {serverReport?.timeSeriesSuppressed && <p className="field-hint" role="note">Daily totals are suppressed to protect small groups.</p>}
          <div className="report-bars">
            {Object.entries(serverReport?.timeSeries || {}).slice(-7).map(([date, count]) => (
              <div key={date}>
                <span aria-label={count === null ? 'Daily total suppressed' : `${count} visits`} style={{ height: `${count === null ? 4 : Math.min(120, Math.max(4, Number(count) * 18))}px` }} />
                <small>{new Date(`${date}T12:00:00`).toLocaleDateString([], { weekday: 'short' })}</small>
              </div>
            ))}
          </div>
        </section>
        <section className="panel report-chart">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">Common concerns</p>
              <h3>Top complaints</h3>
            </div>
            <PieChart size={19} className="chart-icon" />
          </div>
          <div className="complaint-list">
            {Object.entries(complaintCounts).map(
              ([complaint, count], index) => (
                <div key={complaint}>
                  <i className={`legend-dot dot-${index}`} />
                  <span>{complaint}</span>
                  <strong>{count}</strong>
                  {!visitTotalSuppressed && <em style={{ width: `${serverReport?.totals?.visits ? (count / serverReport.totals.visits) * 100 : 0}%` }} />}
                </div>
              ),
            )}
            {complaintSuppressed && <p className="field-hint" role="note">Some complaint categories are suppressed to protect privacy.</p>}
            {visitTotalSuppressed && !complaintSuppressed && <p className="field-hint" role="note">Category shares are withheld with the visit total.</p>}
            {!complaintSuppressed && !Object.keys(complaintCounts).length && <p className="empty-state">No complaint records in this period.</p>}
          </div>
        </section>
      </div>
      <section className="panel table-panel">
        <div className="panel-heading"><div><h3>Saved report snapshots</h3><p className="field-hint">Server-stored aggregate reports for audit and reference.</p></div></div>
        {snapshotsLoading && <p className="empty-state" role="status">Loading saved snapshots…</p>}
        {snapshotsError && <div className="error-banner" role="alert">Saved snapshots could not be loaded. {snapshotsError}</div>}
        {!snapshotsLoading && !snapshotsError && snapshots.slice(0, 5).map((snapshot) => <div className="queue-row" key={snapshot.id}><strong>{snapshot.report_type} · {snapshot.source === 'automated' ? 'Automatic' : 'Manual'}</strong><span>{snapshot.period_start} to {snapshot.period_end}</span><span>{snapshot.data?.suppressedTotals?.includes('visits') ? 'Withheld visits' : `${snapshot.data?.totals?.visits ?? 0} visits`}</span><time>{new Date(snapshot.created_at).toLocaleDateString()}</time></div>)}
        {!snapshotsLoading && !snapshotsError && !snapshots.length && <p className="empty-state">No saved snapshots yet.</p>}
      </section>
      <div className="reports-grid">
        {[["Consultation types", "consultationTypes", serverReport?.consultationTypes], ["Treatments", "treatments", serverReport?.treatments], ["Medication use", "medications", serverReport?.medications], ["Supply use", "supplies", serverReport?.supplies], ["Unclassified historical items", "unclassifiedItems", serverReport?.unclassifiedItems]].map(([title, key, values]) => {
          const entries = Object.entries(values || {});
          const suppressed = serverReport?.suppressedAggregates?.includes(key);
          return <section className="panel table-panel" key={key}><div className="panel-heading"><h3>{title}</h3></div>{entries.map(([label, count]) => <div className="queue-row" key={label}><span>{label}</span><strong>{count}</strong></div>)}{suppressed && <p className="field-hint" role="note">Small categories are suppressed to protect privacy.</p>}{!suppressed && !entries.length && <p className="empty-state">No records in this period.</p>}</section>;
        })}
      </div>
      <section className="panel table-panel">
        <div className="panel-heading">
          <div>
            <p className="section-kicker">Student distribution</p>
            <h3>Visits by grade level</h3>
          </div>
          <button className="text-btn" onClick={exportReport} disabled={!reportReady}>
            <FileText size={15} /> Print view
          </button>
        </div>
        <table>
          <thead>
            <tr>
              <th>Grade level</th>
              <th>Visits</th>
              <th>Share of period visits</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(gradeCounts).map(([grade, count]) => (
              <tr key={grade}>
                <td>
                  <strong>{grade}</strong>
                </td>
                <td>{count}</td>
                <td>{visitTotalSuppressed ? 'Withheld' : `${Math.round((count / (serverReport?.totals?.visits || 1)) * 100)}%`}</td>
              </tr>
            ))}
            {!Object.keys(gradeCounts).length && <tr><td colSpan="3" className={serverReport?.suppressedAggregates?.includes('grades') ? 'field-hint' : 'empty-state'}>{serverReport?.suppressedAggregates?.includes('grades') ? 'Small grade categories are suppressed to protect privacy.' : 'No grade-level visit records in this period.'}</td></tr>}
          </tbody>
        </table>
      </section>
      </>}
      {printPreview && printReady && createPortal(<div className="document-print-root report-print-root" role="dialog" aria-modal="true" aria-label="Print preview" tabIndex={-1} ref={printPreviewRef} onKeyDown={containPrintPreviewFocus}>
        <div className="print-preview-actions"><button type="button" className="secondary-btn" onClick={() => setPrintPreview(false)}>Close preview</button><button type="button" className="primary-btn" onClick={() => window.print()}>Print / Save PDF</button></div>
        <style>{`@media print { @page { size: A4 portrait; margin: 12mm; } }`}</style>
        {reportTab === 'clinic' ? <ClinicReportDocument report={serverReport} start={start} end={end} schoolName={data.settings?.schoolName} /> : <PatientSummaryDocument summary={patientSummary} patient={summaryPatient} schoolName={data.settings?.schoolName} />}
      </div>, document.body)}
    </div>
  );
}

function PatientSummaryPanel({ patients, patientId, patient, start, end, setStart, setEnd, summary, loading, error, retry, onSelectPatient, onPrint }) {
  const health = summary?.currentHealth || {};
  return <>
    <div className="page-intro"><div><p className="section-kicker">Nurse-only report</p><h2>Patient summary</h2><p>Current approved health overview and visits in the selected period.</p></div><button type="button" className="secondary-btn" onClick={onPrint} disabled={!summary || loading}><FileText size={16} /> Print summary</button></div>
    <section className="panel inline-entry-form">
      <div className="report-filter-grid"><StudentPicker students={patients} value={patientId} onChange={onSelectPatient} label="Student or faculty member" itemLabel="patient" searchPlaceholder="Search by name or ID" description="Select a clinic patient record." />
        <label>Start date<input type="date" value={start} max={end} onChange={(event) => setStart(event.target.value)} /></label>
        <label>End date<input type="date" value={end} min={start} onChange={(event) => setEnd(event.target.value)} /></label>
      </div>
      {loading && <p className="field-hint" role="status">Loading selected patient summary…</p>}
      {error && <div className="error-banner" role="alert">{error} <button type="button" className="secondary-btn" onClick={retry}>Retry</button></div>}
      {!patientId && <p className="empty-state">Choose a student or faculty member to view their summary.</p>}
    </section>
    {summary && <>
      <section className="panel patient-summary-identity"><div><p className="section-kicker">{summary.patient.patientType === 'faculty' ? 'Faculty member' : 'Student'}</p><h3>{summary.patient.name || patient?.name || 'Patient'}</h3><p>{summary.patient.studentId || summary.patient.facultyId || patient?.studentId || patient?.facultyId || 'ID unavailable'} · {summary.patient.patientType === 'faculty' ? [summary.patient.department, summary.patient.position].filter(Boolean).join(' · ') || 'Faculty' : [summary.patient.gradeLevel, summary.patient.section].filter(Boolean).join(' · ') || 'Student'}</p></div><div><span>Visits in period</span><strong>{summary.totals.visits}</strong><small>{summary.period.start} to {summary.period.end}</small></div></section>
      <section className="panel patient-summary-health"><div className="panel-heading"><h3>Current health overview</h3><span>Current record, not a historical snapshot</span></div><div className="summary-health-grid">{[['Allergies', 'allergies'], ['Conditions', 'conditions'], ['Medications', 'medications'], ['Blood type', 'bloodType'], ['Past illness', 'pastIllness'], ['Present illness', 'presentIllness'], ['Hospitalization history', 'hospitalizationHistory'], ['Therapy and interventions', 'therapyInterventions'], ['Health concerns', 'concernsDetails']].map(([label, key]) => <div className="summary-health-field" key={key}><strong>{label}</strong><p>{formatHealthField(key, health)}</p></div>)}</div></section>
      <section className="panel table-panel"><div className="panel-heading"><h3>Visit history for this period</h3></div>{summary.visits.length ? <div className="admin-table-wrap"><table className="admin-table patient-summary-visits"><thead><tr><th>Date / time</th><th>Complaint</th><th>Treatment</th><th>Disposition</th><th>Follow-up</th><th>Nurse</th><th>Approved summary</th></tr></thead><tbody>{summary.visits.map((visit) => <tr key={visit.id}><td>{visit.date || '—'}{visit.time ? ` · ${visit.time}` : ''}</td><td>{visit.chiefComplaint || visit.type || '—'}</td><td>{visit.treatment || '—'}</td><td>{visit.disposition || '—'}</td><td>{visit.followUp ? (visit.followUpDate || 'Yes') : '—'}</td><td>{visit.nurseName || '—'}</td><td>{visit.summary || '—'}</td></tr>)}</tbody></table></div> : <p className="empty-state">No visits were recorded for this patient in the selected period.</p>}</section>
    </>}
  </>;
}

function ReportTable({ title, entries, withheld = false }) {
  return <section className="report-print-section"><h3>{title}</h3>{entries.length ? <table><thead><tr><th scope="col">Category</th><th scope="col">Count</th></tr></thead><tbody>{entries.map(([label, count]) => <tr key={label}><td>{label}</td><td>{count}</td></tr>)}</tbody></table> : !withheld && <p>No records in this period.</p>}{withheld && <p>Some categories are withheld to protect privacy.</p>}</section>;
}

function ClinicReportDocument({ report = {}, start, end, schoolName }) {
  const model = clinicReportPrintModel(report);
  const generated = formatManilaDateTime(report.generatedAt || new Date());
  return <article className="report-print-document">
    <header><p>{schoolName || 'Philippine Tong Ho Institute'}</p><h1>HealthMate+ Clinic Report</h1><p>Report period: {start} to {end}</p><p>Generated: {generated}</p></header>
    <h2>Totals</h2><table><thead><tr><th scope="col">Measure</th><th scope="col">Total</th></tr></thead><tbody>{model.totals.map(({ label, value }) => <tr key={label}><td>{label}</td><td>{value}</td></tr>)}</tbody></table>
    <ReportTable title="Visits by day" entries={model.timeSeries} withheld={report.timeSeriesSuppressed} />
    {model.categories.map(({ title, entries, withheld }) => <ReportTable key={title} title={title} entries={entries} withheld={withheld} />)}
  </article>;
}

function PatientSummaryDocument({ summary, patient, schoolName }) {
  const model = patientSummaryPrintModel(summary, patient);
  const health = model.health;
  const identity = model.patient;
  const patientId = identity.patientType === 'faculty' ? identity.facultyId || identity.studentId : identity.studentId;
  const identityDetails = identity.patientType === 'faculty'
    ? [identity.department, identity.position].filter(Boolean).join(' · ')
    : [identity.gradeLevel, identity.section].filter(Boolean).join(' · ');
  const demographics = [health.birthDate && `Birth date: ${formatDisplayDate(health.birthDate)}`, health.gender && `Gender: ${health.gender}`, health.bloodType && `Blood type: ${health.bloodType}`].filter(Boolean).join(' · ');
  const fields = [['Allergies', 'allergies'], ['Conditions', 'conditions'], ['Medications', 'medications'], ['Blood type', 'bloodType'], ['Past illness', 'pastIllness'], ['Present illness', 'presentIllness'], ['Hospitalization history', 'hospitalizationHistory'], ['Therapy and interventions', 'therapyInterventions'], ['Health concerns', 'concernsDetails']];
  return <article className="report-print-document patient-summary-print">
    <header><p>{schoolName || 'Philippine Tong Ho Institute'}</p><h1>Patient Health Summary</h1><p>{identity.name || 'Patient'} · {identity.patientType === 'faculty' ? 'Faculty' : 'Student'} · ID: {patientId || 'Unavailable'}</p><p>{identityDetails || (identity.patientType === 'faculty' ? 'Faculty' : 'Student')}</p>{demographics && <p>{demographics}</p>}<p>Period: {summary?.period?.start} to {summary?.period?.end} · Generated: {formatManilaDateTime(new Date())}</p></header>
    <h2>Current health overview</h2><table><thead><tr><th scope="col">Field</th><th scope="col">Current record</th></tr></thead><tbody>{fields.map(([label, key]) => <tr key={key}><td>{label}</td><td>{formatHealthField(key, health)}</td></tr>)}</tbody></table>
    <h2>Visits in selected period ({model.totalVisits})</h2>{model.visits.length ? model.visits.map((visit, index) => <section className="patient-summary-visit" key={visit.id}>
      <h3>Visit {index + 1} · {visit.date || 'Date unavailable'}{visit.time ? ` · ${visit.time}` : ''}</h3>
      <p><strong>Visit type:</strong> {visit.type || '—'}</p>
      <p><strong>Nurse:</strong> {visit.nurseName || '—'}</p>
      <p><strong>Complaint:</strong> {visit.chiefComplaint || '—'}</p>
      <p><strong>Treatment:</strong> {visit.treatment || '—'}</p>
      <p><strong>Disposition:</strong> {visit.disposition || '—'}</p>
      <p><strong>Follow-up:</strong> {visit.followUp ? (visit.followUpDate || 'Needed') : '—'}</p>
      <p><strong>Approved summary:</strong> {visit.summary || '—'}</p>
    </section>) : <p>No visits were recorded for this patient in the selected period.</p>}
  </article>;
}

function formatDisplayDate(value) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? new Date(`${value}T00:00:00+08:00`) : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium' }).format(date);
}
