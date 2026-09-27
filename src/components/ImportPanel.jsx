import { useRef, useState } from 'react';
import { Download, RotateCcw, Upload } from 'lucide-react';
import { api } from '../utils/api';
import { downloadCsv, importCsvRecords, parseCsv } from '../utils/csv';

const templates = {
  students: [{ 'Student ID': 'PTHI-DEMO-001', Name: 'Fictional Student', Grade: 'Grade 4', Section: 'Rizal', Adviser: 'Fictional Adviser', 'Birth Date': '2016-05-14', Gender: 'Prefer not to say', Guardian: 'Fictional Guardian', Phone: '' }],
  faculty: [{ 'Faculty ID': 'PTHI-FAC-DEMO-001', Name: 'Fictional Faculty Member', Department: 'Science', Position: 'Teacher', Email: 'faculty@example.test', 'Contact Number': '' }],
  visits: [{ 'Patient ID': 'PTHI-DEMO-001', Date: '2026-01-15', Type: 'Illness', Complaint: 'Headache', Treatment: 'Rest', Disposition: 'Returned to class', Notes: '' }],
};

export default function ImportPanel({ type, title, description, onComplete }) {
  const inputRef = useRef(null);
  const [previewRows, setPreviewRows] = useState([]);
  const [selectedIndices, setSelectedIndices] = useState([]);
  const [duplicateChoice, setDuplicateChoice] = useState('skip');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [batchId, setBatchId] = useState('');
  const [rolledBack, setRolledBack] = useState(false);

  const chooseFile = async (event) => {
    const file = event.target.files?.[0];
    setError('');
    setMessage('');
    setBatchId('');
    setRolledBack(false);
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setError('CSV files must be 2 MB or smaller.');
      event.target.value = '';
      return;
    }
    setBusy(true);
    try {
      const rows = importCsvRecords(parseCsv(await file.text()), type);
      const result = await api.post(`/api/import/${type}/preview`, { rows });
      setPreviewRows(result.rows || []);
      setSelectedIndices((result.rows || []).filter((row) => row.status === 'ready').map((row) => row.index));
      if (!(result.rows || []).length) setError('The CSV does not contain any importable rows.');
    } catch (requestError) {
      setPreviewRows([]);
      setSelectedIndices([]);
      setError(requestError.message || 'The CSV could not be previewed.');
    } finally {
      setBusy(false);
      event.target.value = '';
    }
  };

  const toggleRow = (index) => setSelectedIndices((current) => current.includes(index)
    ? current.filter((value) => value !== index)
    : [...current, index].sort((first, second) => first - second));

  const commit = async () => {
    if (busy || duplicateChoice === 'cancel' || !selectedIndices.length) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await api.post(`/api/import/${type}`, {
        rows: previewRows.map(({ record }) => record),
        selectedIndices,
      });
      setBatchId(result.batchId || '');
      setMessage(`${result.imported} imported; ${result.skipped} skipped. Any selected-row error rolls back the whole batch.`);
      setPreviewRows([]);
      setSelectedIndices([]);
      await onComplete?.();
    } catch (requestError) {
      setError(requestError.message || 'The import failed. No rows from this batch were saved. Refresh the preview before retrying.');
    } finally {
      setBusy(false);
    }
  };

  const rollback = async () => {
    if (!batchId || busy || rolledBack || !window.confirm('Roll back this import batch? Any record with later edits or linked clinic activity will prevent rollback.')) return;
    setBusy(true);
    setError('');
    try {
      const result = await api.post(`/api/import/batches/${encodeURIComponent(batchId)}/rollback`, {});
      setRolledBack(true);
      setMessage(`${result.deleted} imported records rolled back.`);
      setBatchId('');
      await onComplete?.();
    } catch (requestError) {
      setError(requestError.message || 'This batch could not be rolled back.');
    } finally {
      setBusy(false);
    }
  };

  const downloadTemplate = () => downloadCsv(`healthmate-${type}-import-template.csv`, templates[type]);
  const hasDuplicates = previewRows.some((row) => row.status === 'duplicate');
  const hasErrors = previewRows.some((row) => row.errors?.length);

  return (
    <section className="panel settings-tab-panel import-panel">
      <div className="settings-panel-heading"><div><h3>{title}</h3><p className="field-hint">{description}</p></div></div>
      <div className="data-command-grid">
        <button type="button" className="data-action" onClick={downloadTemplate}><Download size={17} /><span><strong>Download CSV template</strong><small>Uses fictional example information</small></span></button>
        <button type="button" className="data-action" onClick={() => inputRef.current?.click()} disabled={busy}><Upload size={17} /><span><strong>Choose CSV file</strong><small>Preview up to 1,000 rows before saving</small></span></button>
      </div>
      <input ref={inputRef} type="file" accept="text/csv,.csv" hidden onChange={chooseFile} />
      {hasDuplicates && <label className="import-duplicate-choice">Duplicate rows
        <select value={duplicateChoice} onChange={(event) => setDuplicateChoice(event.target.value)} disabled={busy}>
          <option value="skip">Skip duplicates and import selected new rows</option>
          <option value="cancel">Cancel this import</option>
        </select>
      </label>}
      {previewRows.length > 0 && <>
        <div className="import-preview-summary" role="status">{previewRows.filter((row) => row.status === 'ready').length} ready · {previewRows.filter((row) => row.status === 'duplicate').length} duplicates · {previewRows.filter((row) => row.status === 'invalid').length} rows with errors</div>
        <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Import</th><th>Row</th><th>Record</th><th>Result</th></tr></thead><tbody>
          {previewRows.map((row) => <tr key={row.index}>
            <td><input aria-label={`Import row ${row.index + 1}`} type="checkbox" checked={selectedIndices.includes(row.index)} disabled={busy || row.status !== 'ready' || duplicateChoice === 'cancel'} onChange={() => toggleRow(row.index)} /></td>
            <td>{row.index + 1}</td>
            <td>{row.record?.name || row.record?.patientId || 'Unnamed row'} · {row.record?.studentId || row.record?.facultyId || row.record?.date || ''}</td>
            <td><strong>{row.status}</strong>{row.errors?.length > 0 && <small>{row.errors.join(' ')}</small>}{row.duplicateReason && <small>{row.duplicateReason}</small>}</td>
          </tr>)}
        </tbody></table></div>
        <div className="form-actions"><button type="button" className="primary-btn" onClick={commit} disabled={busy || !selectedIndices.length || (hasDuplicates && duplicateChoice === 'cancel') || hasErrors && selectedIndices.some((index) => previewRows.find((row) => row.index === index)?.status !== 'ready')}>{busy ? 'Saving…' : `Import ${selectedIndices.length} selected rows`}</button><span className="field-hint">The server checks the selected rows again inside one transaction.</span></div>
      </>}
      {message && <p className="success-message" role="status">{message}</p>}
      {batchId && !rolledBack && <button type="button" className="secondary-btn" onClick={rollback} disabled={busy}><RotateCcw size={16} /> Roll back this batch</button>}
      {error && <div className="error-banner" role="alert">{error}</div>}
      {type === 'students' && <p className="disabled-note">Import actual records only after PTHI authorization and privacy review. Previewing a file never writes its contents.</p>}
    </section>
  );
}
