import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { BarChart3, Download, FileText, PieChart, Save } from "lucide-react";
import { api } from "../utils/api";
import { manilaCalendarDate, shiftCalendarDate } from "../utils/dateTime";
import "./Reports.css";
export default function Reports() {
  const exportReport = () => window.print();
  const today = manilaCalendarDate();
  const [searchParams] = useSearchParams();
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
  useEffect(() => {
    let active = true;
    setReportError('');
    setReportLoading(true);
    setServerReport(null);
    api.get(`/api/reports?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`)
      .then((result) => { if (active) setServerReport(result); })
      .catch((error) => { if (active) setReportError(error.message); })
      .finally(() => { if (active) setReportLoading(false); });
    return () => { active = false; };
  }, [start, end]);
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
    if (savingSnapshot || reportLoading) return;
    setSavingSnapshot(true);
    setReportError('');
    try {
      await api.post('/api/reports/snapshots', { start, end, type: period });
      const result = await api.get('/api/reports/snapshots');
      setSnapshots(result.snapshots || []);
      setSnapshotsError('');
      setReportMessage('Report snapshot saved for audit and future reference.');
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
      <div className="page-intro">
        <div>
          <h2>Reports & insights</h2>
          <p>Understand the patterns behind your clinic’s daily work.</p>
        </div>
        <div className="intro-actions"><button type="button" className="secondary-btn" onClick={saveSnapshot} disabled={reportLoading || savingSnapshot}><Save size={16} /> {savingSnapshot ? 'Saving…' : 'Save snapshot'}</button><button type="button" className="secondary-btn" onClick={exportReport}><Download size={16} /> Print / PDF</button></div>
      </div>
      <section className="panel inline-entry-form"><div className="report-filter-grid"><label>Report period<select value={period} onChange={(event) => choosePeriod(event.target.value)}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="custom">Custom</option></select></label><label>Start date<input type="date" value={start} max={end} onChange={(event) => { setPeriod('custom'); setStart(event.target.value); }} /></label><label>End date<input type="date" value={end} min={start} max={today} onChange={(event) => { setPeriod('custom'); setEnd(event.target.value); }} /></label></div>{reportLoading && <p className="field-hint" role="status">Loading the selected date range…</p>}{reportMessage && <p className="success-message" role="status">{reportMessage}</p>}{reportError && <div className="error-banner" role="alert">{reportError}</div>}</section>
      <div className="report-kpis">
        <div>
          <span>Visits this period</span>
          <strong>{serverReport?.suppressedTotals?.includes('visits') ? 'Withheld' : serverReport?.totals?.visits ?? 0}</strong>
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
          <button className="text-btn" onClick={exportReport}>
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
    </div>
  );
}
