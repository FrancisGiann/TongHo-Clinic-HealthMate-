import { useState } from 'react';
import { ArrowLeft, Check, UserPlus } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../utils/api';

const initialForm = {
  facultyId: '', name: '', department: '', position: '', email: '', contactNumber: '',
  birthDate: '', gender: '', bloodType: '', allergies: '', conditions: '', medications: '',
};

export default function FacultyRegistration({ data, reload }) {
  const navigate = useNavigate();
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const update = (event) => {
    setError('');
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  };

  const save = async (event) => {
    event.preventDefault();
    if (saving) return;
    const facultyId = form.facultyId.trim();
    const name = form.name.trim();
    if (!facultyId || !name) return setError('Faculty ID and full name are required.');
    if (data.students.some((record) => String(record.studentId || record.facultyId || '').trim().toLowerCase() === facultyId.toLowerCase())) {
      return setError('That ID is already used by a student or faculty record.');
    }
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return setError('Enter a valid email address.');
    setSaving(true);
    try {
      const record = {
        ...form,
        facultyId,
        studentId: facultyId,
        name,
        patientType: 'faculty',
        email: form.email.trim().toLowerCase(),
      };
      await api.post('/api/patients/faculty', record);
      await reload?.();
      setSaved(true);
      setTimeout(() => navigate('/students'), 700);
    } catch (requestError) {
      setError(requestError.message || 'Faculty record could not be saved.');
      setSaving(false);
    }
  };

  return (
    <div className="form-page">
      <Link to="/students" className="back-link"><ArrowLeft size={16} /> Back to people</Link>
      <div className="page-intro"><div><p className="section-kicker">Faculty directory</p><h2>New faculty health record</h2><p>Register a faculty member for clinic visits and appointments.</p></div></div>
      {error && <div className="error-banner" role="alert">{error}</div>}
      <form className="panel form-panel registration-form" onSubmit={save}>
        <div className="form-section"><h3 className="section-title">Faculty information</h3>
          <div className="two-fields">
            <label>Faculty ID <span className="required">*</span><input name="facultyId" value={form.facultyId} onChange={update} maxLength={80} required disabled={saving} autoFocus /></label>
            <label>Full name <span className="required">*</span><input name="name" value={form.name} onChange={update} maxLength={160} required disabled={saving} /></label>
          </div>
          <div className="two-fields">
            <label>Department<input name="department" value={form.department} onChange={update} maxLength={120} disabled={saving} /></label>
            <label>Position<input name="position" value={form.position} onChange={update} maxLength={120} disabled={saving} /></label>
          </div>
          <div className="two-fields">
            <label>Email<input name="email" type="email" value={form.email} onChange={update} maxLength={254} disabled={saving} /></label>
            <label>Contact number<input name="contactNumber" type="tel" value={form.contactNumber} onChange={update} maxLength={40} disabled={saving} /></label>
          </div>
          <div className="three-fields">
            <label>Birth date<input name="birthDate" type="date" value={form.birthDate} onChange={update} disabled={saving} /></label>
            <label>Gender<select name="gender" value={form.gender} onChange={update} disabled={saving}><option value="">Select</option><option>Female</option><option>Male</option><option>Prefer not to say</option></select></label>
            <label>Blood type<select name="bloodType" value={form.bloodType} onChange={update} disabled={saving}><option value="">Not recorded</option>{['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((value) => <option key={value}>{value}</option>)}</select></label>
          </div>
        </div>
        <div className="form-section"><h3 className="section-title">Health information</h3>
          <label>Allergies<textarea name="allergies" value={form.allergies} onChange={update} maxLength={2000} disabled={saving} /></label>
          <label>Medical conditions<textarea name="conditions" value={form.conditions} onChange={update} maxLength={2000} disabled={saving} /></label>
          <label>Medications<textarea name="medications" value={form.medications} onChange={update} maxLength={2000} disabled={saving} /></label>
        </div>
        <div className="form-actions"><button type="submit" className="primary-btn" disabled={saving}><UserPlus size={16} /> {saving ? 'Saving…' : saved ? <><Check size={16} /> Saved</> : 'Save faculty record'}</button></div>
      </form>
    </div>
  );
}
