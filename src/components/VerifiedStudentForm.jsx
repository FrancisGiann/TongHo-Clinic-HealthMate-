import { useRef, useState } from 'react';
import { STUDENT_GRADE_LEVELS } from '../../shared/grades.js';
import { api } from '../utils/api';

export default function VerifiedStudentForm({ onSaved, onCancel, onBusyChange }) {
  const [form, setForm] = useState({ studentId: '', name: '', gradeLevel: '', section: '', adviser: '' });
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const refresh = async () => {
    const data = await api.get('/api/data');
    const student = data.students?.find((record) => String(record.studentId).trim().toLowerCase() === form.studentId.trim().toLowerCase());
    if (!student) throw new Error('Record saved. Refresh the roster to find it before approving this request.');
    onSaved(student);
  };
  const submit = async (event) => {
    event.preventDefault();
    if (lock.current || !verified) return;
    lock.current = true;
    setBusy(true);
    onBusyChange?.(true);
    setError('');
    try {
      if (!saved) {
        const rows = [{ ...form, studentId: form.studentId.trim(), name: form.name.trim() }];
        const preview = await api.post('/api/import/students/preview', { rows });
        const row = preview.rows?.[0];
        if (row?.status !== 'ready') throw new Error(row?.errors?.join(' ') || row?.duplicateReason || 'A student with this ID already exists. Choose the existing record.');
        const result = await api.post('/api/import/students', { rows, selectedIndices: [0] });
        if (result.imported !== 1) throw new Error('The student record was not saved. Refresh the roster before trying again.');
        setSaved(true);
      }
      await refresh();
    } catch (failure) { setError(failure.message || 'The record could not be saved.'); }
    finally { lock.current = false; setBusy(false); onBusyChange?.(false); }
  };
  return <form className="context-dialog-form" onSubmit={submit}>
    <p className="field-hint">Enter identity and class placement from official school records. Saving a roster record does not approve or link the guardian.</p>
    {saved && <p className="success-message" role="status">Student record saved. Refresh the roster to return to the request.</p>}
    {error && <div className="error-banner" role="alert">{error}</div>}
    <fieldset disabled={busy || saved} className="context-form-fields">
      <div className="two-fields">{[['studentId', 'Official student ID', 80], ['name', 'Student name', 160]].map(([key, label, max]) => <label key={key}>{label}<input required maxLength={max} value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} /></label>)}</div>
      <label>Grade<select required value={form.gradeLevel} onChange={(event) => setForm({ ...form, gradeLevel: event.target.value })}><option value="">Choose grade</option>{STUDENT_GRADE_LEVELS.map((grade) => <option key={grade}>{grade}</option>)}</select></label>
      <div className="two-fields">{[['section', 'Section', 80], ['adviser', 'Class adviser', 160]].map(([key, label, max]) => <label key={key}>{label}<input maxLength={max} value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} /></label>)}</div>
      <label className="check-label"><input type="checkbox" required checked={verified} onChange={(event) => setVerified(event.target.checked)} /> I verified the student ID, name and grade against official school records.</label>
    </fieldset>
    <div className="form-actions"><button type="button" className="secondary-btn" disabled={busy} onClick={onCancel}>Back to request</button><button type="submit" className="primary-btn" disabled={busy || !verified}>{busy ? 'Saving…' : saved ? 'Refresh saved record' : 'Save verified student record'}</button></div>
  </form>;
}
