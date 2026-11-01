import { useRef, useState } from 'react';
import { ArrowLeft, UserPlus } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../utils/api';
import { STUDENT_GRADE_LEVELS } from '../../shared/grades.js';

export default function StudentRegistration({ schemaVersion, reload, embedded = false, onClose, onSaved, onBusyChange }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ studentId: '', name: '', gradeLevel: 'Kindergarten', section: '', adviser: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const saveLock = useRef(false);

  const update = (event) => setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  const save = async (event) => {
    event.preventDefault();
    if (saveLock.current) return;
    setError('');
    const studentId = form.studentId.trim();
    const name = form.name.trim();
    if (!studentId || !name || !form.gradeLevel) { setError('Student ID, name, and grade level are required.'); return; }
    saveLock.current = true;
    setSaving(true);
    onBusyChange?.(true);
    try {
      const rosterRecord = { studentId, name, gradeLevel: form.gradeLevel, section: form.section.trim(), adviser: form.adviser.trim(), patientType: 'student' };
      await api.post('/api/patients', { patient: rosterRecord, schemaVersion });
      await reload?.();
      if (onSaved) { onSaved(); return; }
      const returnTo = location.state?.returnTo;
      navigate(typeof returnTo === 'string' && /^\/users(?:\?.*)?$/.test(returnTo) ? returnTo : '/students');
    } catch (saveError) {
      setError(saveError.message || 'The roster record could not be saved.');
    } finally { saveLock.current = false; setSaving(false); onBusyChange?.(false); }
  };

  return (
    <div className={embedded ? "embedded-registration" : "form-page"}>
      {!embedded && <><Link to="/students" className="back-link"><ArrowLeft size={16} /> Back to patients</Link>
      <div className="page-intro"><div><p className="section-kicker">Student directory</p><h2>Add student roster record</h2><p>Enter school identity and class placement. A linked guardian completes the health record.</p></div></div></>}
      {error && <div className="error-banner" role="alert">{error}</div>}
      <form className={embedded ? "context-dialog-form registration-form" : "panel form-panel registration-form"} onSubmit={save}>
        <div className="form-section"><h3 className="section-title">School roster information</h3><div className="two-fields"><label>Student ID *<input name="studentId" maxLength={80} value={form.studentId} onChange={update} required autoFocus disabled={saving} /></label><label>Student name *<input name="name" maxLength={160} value={form.name} onChange={update} required disabled={saving} /></label></div><div className="three-fields"><label>Grade *<select name="gradeLevel" value={form.gradeLevel} onChange={update} required disabled={saving}>{STUDENT_GRADE_LEVELS.map((grade) => <option key={grade}>{grade}</option>)}</select></label><label>Section<input name="section" maxLength={80} value={form.section} onChange={update} disabled={saving} /></label><label>Class adviser<input name="adviser" maxLength={160} value={form.adviser} onChange={update} disabled={saving} /></label></div></div>
        <div className="privacy-notice"><strong>Guardian health record</strong><p>An administrator verifies and links guardian accounts to the student. The guardian can then complete a yearly health record or update it when information changes.</p></div>
        <div className="form-actions">{embedded && <button type="button" className="secondary-btn" onClick={onClose} disabled={saving}>Cancel</button>}<button className="primary-btn" type="submit" disabled={saving}><UserPlus size={16} /> {saving ? 'Saving roster…' : 'Save roster record'}</button></div>
      </form>
    </div>
  );
}
