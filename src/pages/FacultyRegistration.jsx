import { useRef, useState } from 'react';
import { ArrowLeft, Check, UserPlus } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../utils/api';

const initialForm = {
  facultyId: '', name: '', department: '', position: '', email: '', contactNumber: '',
  birthDate: '', gender: '', bloodType: '', allergies: '', conditions: '', medications: '',
};

export default function FacultyRegistration({ schemaVersion, reload, embedded = false, onClose, onSaved, onBusyChange }) {
  const navigate = useNavigate();
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const saveLock = useRef(false);

  const update = (event) => {
    setError('');
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  };

  const save = async (event) => {
    event.preventDefault();
    if (saving || saveLock.current) return;
    const facultyId = form.facultyId.trim();
    const name = form.name.trim();
    if (!facultyId || !name) return setError('Faculty ID and full name are required.');
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return setError('Enter a valid email address.');
    saveLock.current = true;
    setSaving(true);
    onBusyChange?.(true);
    try {
      const record = {
        ...form,
        facultyId,
        studentId: facultyId,
        name,
        patientType: 'faculty',
        email: form.email.trim().toLowerCase(),
      };
      await api.post('/api/patients/faculty', { ...record, schemaVersion });
      await reload?.();
      setSaved(true);
      if (onSaved) onSaved();
      else navigate('/students');
    } catch (requestError) {
      setError(requestError.message || 'Faculty record could not be saved.');
    } finally { saveLock.current = false; setSaving(false); onBusyChange?.(false); }
  };

  return (
    <div className={embedded ? "embedded-registration" : "form-page"}>
      {!embedded && <><Link to="/students" className="back-link"><ArrowLeft size={16} /> Back to people</Link>
      <div className="page-intro"><div><p className="section-kicker">Faculty directory</p><h2>New faculty health record</h2><p>Register a faculty member for clinic visits and appointments.</p></div></div></>}
      {error && <div className="error-banner" role="alert">{error}</div>}
      <form className={embedded ? "context-dialog-form registration-form" : "panel form-panel registration-form"} onSubmit={save}>
        <div className="form-section"><h3 className="section-title">Faculty information</h3>
          <div className="two-fields">
            <label>Faculty ID *<input name="facultyId" value={form.facultyId} onChange={update} maxLength={80} required disabled={saving} autoFocus /></label>
            <label>Full name *<input name="name" value={form.name} onChange={update} maxLength={160} required disabled={saving} /></label>
          </div>
          <details className="optional-form-group"><summary>Work and contact details (optional)</summary><div className="context-form-fields"><div className="two-fields">
            <label>Department<input name="department" value={form.department} onChange={update} maxLength={120} disabled={saving} /></label>
            <label>Position<input name="position" value={form.position} onChange={update} maxLength={120} disabled={saving} /></label>
          </div>
          <div className="two-fields">
            <label>Email<input name="email" type="email" value={form.email} onChange={update} maxLength={254} disabled={saving} /></label>
            <label>Contact number<input name="contactNumber" type="tel" value={form.contactNumber} onChange={update} maxLength={40} disabled={saving} /></label>
          </div>
          </div></details><details className="optional-form-group"><summary>Personal details (optional)</summary><div className="three-fields">
            <label>Birth date<input name="birthDate" type="date" value={form.birthDate} onChange={update} disabled={saving} /></label>
            <label>Gender<select name="gender" value={form.gender} onChange={update} disabled={saving}><option value="">Select</option><option>Female</option><option>Male</option><option>Prefer not to say</option></select></label>
            <label>Blood type<select name="bloodType" value={form.bloodType} onChange={update} disabled={saving}><option value="">Not recorded</option>{['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((value) => <option key={value}>{value}</option>)}</select></label>
          </div>
          </details>
        </div>
        <details className="optional-form-group"><summary>Health information (optional)</summary><div className="form-section">
          <label>Allergies<textarea name="allergies" value={form.allergies} onChange={update} maxLength={2000} disabled={saving} /></label>
          <label>Medical conditions<textarea name="conditions" value={form.conditions} onChange={update} maxLength={2000} disabled={saving} /></label>
          <label>Medications<textarea name="medications" value={form.medications} onChange={update} maxLength={2000} disabled={saving} /></label>
        </div>
        </details><div className="form-actions">{embedded && <button type="button" className="secondary-btn" onClick={onClose} disabled={saving}>Cancel</button>}<button type="submit" className="primary-btn" disabled={saving}><UserPlus size={16} /> {saving ? 'Saving…' : saved ? <><Check size={16} /> Saved</> : 'Save faculty record'}</button></div>
      </form>
    </div>
  );
}
