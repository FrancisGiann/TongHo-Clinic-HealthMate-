import { useState } from 'react';
import { ArrowLeft, UserPlus } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { addRecord } from '../db/database';

const gradeLevels = ['Kindergarten', ...Array.from({ length: 10 }, (_, index) => `Grade ${index + 1}`)];

export default function StudentRegistration({ data, commitData }) {
  const navigate = useNavigate();
  const [form, setForm] = useState({ studentId: '', name: '', gradeLevel: 'Kindergarten', section: '', adviser: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const update = (event) => setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  const save = async (event) => {
    event.preventDefault();
    setError('');
    const studentId = form.studentId.trim();
    const name = form.name.trim();
    if (!studentId || !name || !form.gradeLevel) { setError('Student ID, name, and grade level are required.'); return; }
    if (data.students?.some((student) => String(student.studentId || '').trim().toLowerCase() === studentId.toLowerCase())) {
      setError('A student with this ID is already on the roster.'); return;
    }
    setSaving(true);
    try {
      const rosterRecord = { studentId, name, gradeLevel: form.gradeLevel, section: form.section.trim(), adviser: form.adviser.trim(), patientType: 'student' };
      await commitData((current) => addRecord(current, 'students', rosterRecord));
      navigate('/students');
    } catch (saveError) {
      setError(saveError.message || 'The roster record could not be saved.');
      setSaving(false);
    }
  };

  return (
    <div className="form-page">
      <Link to="/students" className="back-link"><ArrowLeft size={16} /> Back to patients</Link>
      <div className="page-intro"><div><p className="section-kicker">Student directory</p><h2>Add student roster record</h2><p>Enter school identity and class placement. A linked guardian completes the health record.</p></div></div>
      {error && <div className="error-banner" role="alert">{error}</div>}
      <form className="panel form-panel registration-form" onSubmit={save}>
        <div className="form-section"><h3 className="section-title">School roster information</h3><div className="two-fields"><label>Student ID <span className="required">*</span><input name="studentId" maxLength={80} value={form.studentId} onChange={update} required autoFocus disabled={saving} /></label><label>Student name <span className="required">*</span><input name="name" maxLength={160} value={form.name} onChange={update} required disabled={saving} /></label></div><div className="three-fields"><label>Grade <span className="required">*</span><select name="gradeLevel" value={form.gradeLevel} onChange={update} required disabled={saving}>{gradeLevels.map((grade) => <option key={grade}>{grade}</option>)}</select></label><label>Section<input name="section" maxLength={80} value={form.section} onChange={update} disabled={saving} /></label><label>Class adviser<input name="adviser" maxLength={160} value={form.adviser} onChange={update} disabled={saving} /></label></div></div>
        <div className="privacy-notice"><strong>Guardian health record</strong><p>Use Settings → User management to invite a parent or guardian and link the account to this student. The guardian can then complete a yearly health record or update it when information changes.</p></div>
        <div className="form-actions"><button className="primary-btn" type="submit" disabled={saving}><UserPlus size={16} /> {saving ? 'Saving roster…' : 'Save roster record'}</button></div>
      </form>
    </div>
  );
}
