import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import ModalDialog from './ModalDialog';
import { api } from '../utils/api';
import { manilaCalendarDate } from '../utils/dateTime';
import { PatientSummaryDocument } from '../pages/Reports';
import './print/print.css';

export default function PatientSummaryDialog({ patient, settings, onClose }) {
  const today = manilaCalendarDate();
  const [start, setStart] = useState(`${today.slice(0, 8)}01`);
  const [end, setEnd] = useState(today);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setSummary(null);
    api.get(`/api/reports/patients/${encodeURIComponent(patient.id)}/summary?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`)
      .then((value) => { if (active) setSummary(value); })
      .catch((failure) => { if (active) setError(failure.message || 'Patient summary could not be loaded.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [patient.id, start, end, retry]);
  useEffect(() => {
    document.body.classList.toggle('document-print-active', Boolean(summary) && !loading);
    return () => document.body.classList.remove('document-print-active');
  }, [summary, loading]);
  const summaryDocument = summary && <PatientSummaryDocument summary={summary} patient={patient} schoolName={settings?.schoolName} />;
  return <ModalDialog open title={`Patient summary · ${patient.name}`} eyebrow="Approved health overview" onClose={onClose} historyKey="patient-summary" className="admin-context-dialog consultation-summary-dialog">
    <div className="two-fields"><label>Start date<input type="date" value={start} max={end} onChange={(event) => setStart(event.target.value)} /></label><label>End date<input type="date" value={end} min={start} onChange={(event) => setEnd(event.target.value)} /></label></div>
    {loading && <p role="status">Loading patient summary…</p>}
    {error && <div className="error-banner" role="alert">{error} <button type="button" className="secondary-btn" onClick={() => setRetry((value) => value + 1)}>Retry</button></div>}
    {summaryDocument && <div className="print-preview-viewport" role="region" aria-label="Patient summary preview"><div className="document-print-root summary-preview">{summaryDocument}</div></div>}
    <div className="form-actions summary-modal-footer"><button type="button" className="secondary-btn" onClick={onClose}>Close</button><button type="button" className="primary-btn" disabled={loading || !summary} onClick={() => window.print()}>Print summary</button></div>
    {summaryDocument && createPortal(<div className="document-print-root print-document-mirror summary-preview"><style>{'@media print { @page { size: A4 portrait; margin: 12mm; } }'}</style>{summaryDocument}</div>, window.document.body)}
  </ModalDialog>;
}
