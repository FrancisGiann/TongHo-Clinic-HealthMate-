import PatientSummaryDialog from '../components/PatientSummaryDialog';
import ModalDialog from '../components/ModalDialog';
import {
  ArrowLeft,
  Calendar,
  Camera,
  Check,
  Pencil,
  Phone,
  ShieldAlert,
  Stethoscope,
  X,
} from "lucide-react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useState, useRef, useEffect } from "react";
import { saveData } from "../db/database";
import { api } from "../utils/api";

export default function StudentProfile({ data, commitData, reload }) {
  const { studentId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const student = data.students.find((item) => String(item.id) === String(studentId));
  const profileSaveLock = useRef(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(null);
  const [showPatientSummary, setShowPatientSummary] = useState(false);
  const [showContact, setShowContact] = useState(false);
  const [editorPhotoOpen, setEditorPhotoOpen] = useState(false);
  const [imagePreview, setImagePreview] = useState(null);
  const [consentStatus, setConsentStatus] = useState(student?.consentStatus || 'unrecorded');
  const [consentDueDate, setConsentDueDate] = useState(student?.consentDueDate || '');
  const [consentSaving, setConsentSaving] = useState(false);
  const [consentMessage, setConsentMessage] = useState('');
  const [recordSaving, setRecordSaving] = useState(false);
  const [recordSaveError, setRecordSaveError] = useState('');
  const [recordSaveMessage, setRecordSaveMessage] = useState('');
  const fileInputRef = useRef(null);

  useEffect(() => {
    setConsentStatus(student?.consentStatus || 'unrecorded');
    setConsentDueDate(student?.consentDueDate || '');
  }, [student?.id, student?.consentStatus, student?.consentDueDate]);

  if (!student)
    return (
      <div className="empty-page">
        <h2>Patient not found</h2>
        <Link to="/students">Back to patients</Link>
      </div>
    );

  const visits = data.visits.filter((visit) => String(visit.studentId || visit.patientId) === String(student.id));
  const isFaculty = student.patientType === 'faculty';
  const patientLabel = isFaculty ? 'faculty member' : 'student';

  const openEditor = (showPhoto = false) => {
    setEditorPhotoOpen(showPhoto);
    setRecordSaveError('');
    setForm({ ...student });
    setImagePreview(student.profileImage || null);
  };

  const update = (event) => {
    setRecordSaveError('');
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  };

  /**
   * Handle image file selection and convert to base64
   */
  const handleImageUpload = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setRecordSaveError('Please select a valid image file.');
      event.target.value = '';
      return;
    }

    // Validate file size (limit to 2MB)
    const maxSize = 2 * 1024 * 1024;
    if (file.size > maxSize) {
      setRecordSaveError('Image size must be less than 2MB.');
      event.target.value = '';
      return;
    }

    setRecordSaveError('');
    // Convert to base64
    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = e.target?.result;
      setImagePreview(base64);
      setForm((current) => ({ ...current, profileImage: base64 }));
    };
    reader.onerror = () => setRecordSaveError('The selected image could not be read. Try another file.');
    reader.readAsDataURL(file);
  };

  /**
   * Clear the uploaded image
   */
  const clearImage = () => {
    setImagePreview(null);
    setForm((current) => ({ ...current, profileImage: null }));
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  /**
   * Validate form before saving
   */
  const validateStudentForm = (studentForm) => {
    if (!studentForm.name?.trim()) {
      setRecordSaveError('Patient name is required.');
      return false;
    }
    const externalId = (studentForm.facultyId || studentForm.studentId || '').trim();
    if (!externalId) {
      setRecordSaveError(`${isFaculty ? 'Faculty' : 'Student'} ID is required.`);
      return false;
    }

    // Check for duplicate student ID among OTHER students
    const normalizedId = externalId.toLowerCase();
    const duplicateId = data.students?.some((s) => String(s.id) !== String(student.id)
      && String(s.studentId || s.facultyId || '').trim().toLowerCase() === normalizedId);

    if (duplicateId) {
      setRecordSaveError('Another patient record already uses this ID.');
      return false;
    }

    return true;
  };

  const save = async (event) => {
    event.preventDefault();

    if (recordSaving || profileSaveLock.current) return;
    // Validate form
    if (!validateStudentForm(form)) {
      return;
    }

    profileSaveLock.current = true;
    setRecordSaving(true);
    setRecordSaveError('');
    try {
      const updated = isFaculty ? { ...form, studentId: form.facultyId || form.studentId } : form;
      await commitData((current) => saveData({
        ...current,
        students: current.students.map((item) => String(item.id) === String(student.id) ? updated : item),
      }));
      setRecordSaveMessage('Patient record saved to clinic records.');
      setForm(null);
      setImagePreview(null);
      setEditing(false);
    } catch (error) {
      console.error("Failed to save student record:", error);
      setRecordSaveError(error.message || "Failed to save changes. Please try again.");
    } finally {
      profileSaveLock.current = false;
      setRecordSaving(false);
    }
  };

  const saveConsentTracking = async (event) => {
    event.preventDefault();
    setConsentSaving(true);
    setConsentMessage('');
    try {
      await api.patch(`/api/patients/${encodeURIComponent(student.id)}/consent`, {
        consentStatus,
        consentDueDate: consentStatus === 'pending' ? consentDueDate : null,
      });
      await reload();
      setConsentMessage('Consent tracking saved.');
    } catch (error) {
      setConsentMessage(error.message || 'Consent tracking could not be saved.');
    } finally {
      setConsentSaving(false);
    }
  };
  return (
    <div className="profile-page">
      <Link to="/students" className="back-link">
        <ArrowLeft size={16} /> Back to patients
      </Link>
      <section className="profile-head">
        <div className="avatar-container">
          {student.profileImage ? (
            <img
              src={student.profileImage}
              alt={student.name}
              className="avatar-image large"
            />
          ) : (
            <div className="avatar coral large">
              {student.name
                .split(" ")
                .map((part) => part[0])
                .join("")
                .slice(0, 2)}
            </div>
          )}
          <button
            className="image-upload-btn"
            onClick={() => openEditor(true)}
            title="Upload profile image"
            aria-label={`Upload ${isFaculty ? 'faculty' : 'student'} profile image`}
          >
            <Camera size={16} />
          </button>
        </div>
        <div>
          <p className="section-kicker">{isFaculty ? 'Faculty profile' : 'Student profile'}</p>
          <h2>{student.name}</h2>
          {recordSaveMessage && <p className="success-message" role="status">{recordSaveMessage}</p>}
          <p>
            {isFaculty ? student.facultyId || student.studentId : student.studentId} <span>·</span> {isFaculty ? [student.department, student.position].filter(Boolean).join(' · ') || 'Faculty' : [student.gradeLevel, student.section].filter(Boolean).join(', ')}
          </p>
        </div>
        <div className="profile-actions">
          <button type="button" className="secondary-btn" onClick={() => setShowPatientSummary(true)}>Patient summary</button>
          {student.patientType === 'student' && <><Link className="secondary-btn" to={`/students/${encodeURIComponent(student.id)}/passes/clinic`} state={{ backgroundLocation: location }}>Clinic Pass</Link><Link className="secondary-btn" to={`/students/${encodeURIComponent(student.id)}/passes/gate`} state={{ backgroundLocation: location }}>Student Gate Pass</Link></>}
          <button className="secondary-btn" onClick={() => openEditor(false)}><Pencil size={16} /> Edit profile</button>
          {(student.contactNumber || student.guardianPhone) && <button className="secondary-btn" onClick={() => setShowContact(true)}>
            <Phone size={16} /> {isFaculty ? 'Contact' : 'Guardian'}
          </button>}
          <Link to="/new-visit" state={{ selectedStudent: student }} className="primary-btn">
            <Stethoscope size={16} /> Start visit
          </Link>
        </div>
      </section>
      {student.allergies && (
        <div className="allergy-banner">
          <ShieldAlert size={19} />
          <div>
            <strong>Allergy alert</strong>
            <p>
              {student.allergies} allergy recorded. Review before administering
              medication.
            </p>
          </div>
        </div>
      )}
      <div className="profile-grid">
        <section className="panel info-panel">
          <div className="panel-heading">
            <h3>Personal details</h3>
          </div>
          <div className="detail-list">
            <Detail label="Date of birth" value={student.birthDate} />
            <Detail label="Gender" value={student.gender} />
            <Detail label="Blood type" value={student.bloodType} />
            <Detail
              label="Medical conditions"
              value={student.conditions || "None recorded"}
            />
            {isFaculty ? <><Detail label="Department" value={student.department} /><Detail label="Position" value={student.position} /><Detail label="Email" value={student.email} /><Detail label="Contact" value={student.contactNumber} /></> : <><Detail label="Guardian" value={student.guardianName} /><Detail label="Contact" value={student.guardianPhone} /></>}
          </div>
        </section>
        <section className="panel history-panel">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">Care record</p>
              <h3>Visit history</h3>
            </div>
            <button className="text-btn" onClick={() => navigate('/new-visit', { state: { selectedStudent: student } })}>Log visit</button>
          </div>
          {visits.length > 0 ? (
            visits.map((visit) => (
              <div className="history-row" key={visit.id}>
                <div className="history-date">
                  <Calendar size={15} />
                  <span>
                    {visit.date || 'Date unavailable'}
                    <br />
                    <b>{visit.time}</b>
                  </span>
                </div>
                <div>
                  <strong>{visit.chiefComplaint}</strong>
                  <p>
                    {visit.type} · {visit.treatment}
                  </p>
                </div>
                <span className="status-chip success">{visit.disposition}</span>
                {student.patientType === 'student' && <div><Link className="text-btn" to={`/students/${encodeURIComponent(student.id)}/visits/${encodeURIComponent(visit.id)}/print`} state={{ backgroundLocation: location }}>Print visit summary</Link>{['clinic', 'gate'].map((type) => <Link key={type} className="text-btn" to={`/students/${encodeURIComponent(student.id)}/passes/${type}?visit=${encodeURIComponent(visit.id)}`} state={{ backgroundLocation: location }}>{type === 'clinic' ? 'Clinic Pass' : 'Gate Pass'}</Link>)}</div>}
              </div>
            ))
          ) : (
            <div className="empty-state">
              <p>No clinic visits yet</p>
              <small>Visit history will appear here once you log a visit for this {patientLabel}.</small>
            </div>
          )}
        </section>
        {!isFaculty && <section className="panel consent-tracking-panel">
          <div className="panel-heading">
            <div>
              <h3>Consent tracking</h3>
              <p className="field-hint">Status and reminder date only—signed forms are not uploaded or stored here.</p>
            </div>
          </div>
          <form className="consent-tracking-form" onSubmit={saveConsentTracking}>
            <label>Consent status
              <select value={consentStatus} onChange={(event) => setConsentStatus(event.target.value)}>
                <option value="unrecorded">Not recorded</option>
                <option value="pending">Pending</option>
                <option value="received">Received</option>
                <option value="not_required">Not required</option>
              </select>
            </label>
            {consentStatus === 'pending' && <label>Due date
              <input type="date" value={consentDueDate} onChange={(event) => setConsentDueDate(event.target.value)} required />
            </label>}
            <p className="field-hint consent-reminder-note">Linked accounts receive one reminder when a pending date is due within 30 days or overdue.</p>
            <div className="form-actions">
              <button type="submit" className="primary-btn" disabled={consentSaving || (consentStatus === 'pending' && !consentDueDate)}>
                {consentSaving ? 'Saving…' : 'Save consent status'}
              </button>
              {consentMessage && <span className="field-hint" role="status">{consentMessage}</span>}
            </div>
          </form>
        </section>}
      </div>
      {showPatientSummary && <PatientSummaryDialog key={student.id} patient={student} settings={data.settings} onClose={() => setShowPatientSummary(false)} />}
      {showContact && <ModalDialog open title={`${isFaculty ? 'Contact' : 'Guardian contact'} · ${student.name}`} eyebrow="Patient contacts" onClose={() => setShowContact(false)} historyKey="patient-contact" className="admin-context-dialog">
        <dl className="context-record-summary"><div><dt>Name</dt><dd>{isFaculty ? student.name : student.guardianName || 'Guardian name not recorded'}</dd></div><div><dt>Phone</dt><dd>{isFaculty ? student.contactNumber : student.guardianPhone}</dd></div></dl>
        <div className="form-actions"><button type="button" className="secondary-btn" onClick={() => setShowContact(false)}>Close</button><a className="primary-btn" href={`tel:${isFaculty ? student.contactNumber : student.guardianPhone}`}><Phone size={16} /> Call {isFaculty ? 'contact' : 'guardian'}</a></div>
      </ModalDialog>}
      {form && (
        <ModalDialog open title={`Edit profile · ${student.name}`} eyebrow={isFaculty ? 'Faculty record' : 'Student record'} onClose={() => setForm(null)} busy={recordSaving} historyKey="patient-edit" className="admin-context-dialog patient-edit-dialog">
          <form className="context-dialog-form" onSubmit={save} aria-busy={recordSaving}>
            {/* Profile Image Section */}
            {recordSaveError && <div className="error-banner" role="alert">{recordSaveError}</div>}
            <fieldset className="form-fieldset" disabled={recordSaving}>
            <details className="optional-form-group" open={editorPhotoOpen} onToggle={(event) => setEditorPhotoOpen(event.currentTarget.open)}><summary>Profile photo (optional)</summary><div className="image-upload-section">
              <label className="image-preview-label">Profile Image</label>
              <div className="image-preview-container">
                {imagePreview ? (
                  <>
                    <img
                      src={imagePreview}
                      alt="Preview"
                      className="image-preview"
                    />
                    <button
                      type="button"
                      className="clear-image-btn"
                      onClick={clearImage}
                      aria-label="Remove image"
                      title="Remove image"
                    >
                      <X size={16} />
                    </button>
                  </>
                ) : (
                  <div className="image-placeholder">
                    <Camera size={32} />
                    <p>No image uploaded</p>
                  </div>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="file-input"
                aria-label="Choose image file"
              />
              <button
                type="button"
                className="secondary-btn"
                onClick={() => fileInputRef.current?.click()}
                style={{ marginBottom: '16px' }}
              >
                <Camera size={16} /> Choose Image
              </button>
              <small className="file-info">
                JPG, PNG or WebP. Max 2MB.
              </small>
            </div>

            </details><div className="two-fields">
              <label>
                {isFaculty ? 'Faculty ID *' : 'Student ID *'}
                <input
                  name={isFaculty ? 'facultyId' : 'studentId'}
                  value={isFaculty ? form.facultyId || form.studentId : form.studentId}
                  onChange={update}
                  required
                />
              </label>
              <label>
                Full name *
                <input
                  name="name"
                  value={form.name}
                  onChange={update}
                  required
                />
              </label>
            </div>

            {isFaculty ? <div className="two-fields">
              <label>Department<input name="department" value={form.department || ''} onChange={update} maxLength={120} /></label>
              <label>Position<input name="position" value={form.position || ''} onChange={update} maxLength={120} /></label>
            </div> : <div className="two-fields">
              <label>
                Grade level
                <select name="gradeLevel" value={form.gradeLevel} onChange={update}>
                  <option>Kindergarten</option>
                  {Array.from({ length: 12 }, (_, index) => (
                    <option key={index}>Grade {index + 1}</option>
                  ))}
                </select>
              </label>
              <label>
                Section
                <input name="section" value={form.section || ""} onChange={update} />
              </label>
            </div>}

            <details className="optional-form-group"><summary>Personal, contact and health details</summary><div className="context-form-fields">
            {isFaculty && <div className="two-fields">
              <label>Email<input name="email" type="email" value={form.email || ''} onChange={update} maxLength={254} /></label>
              <label>Contact number<input name="contactNumber" type="tel" value={form.contactNumber || ''} onChange={update} maxLength={40} /></label>
            </div>}

            <div className="two-fields">
              {!isFaculty && <label>
                Adviser
                <input name="adviser" value={form.adviser || ""} onChange={update} />
              </label>}
              <label>
                Birth date
                <input
                  type="date"
                  name="birthDate"
                  value={form.birthDate || ""}
                  onChange={update}
                />
              </label>
            </div>

            <label>
              Gender
              <select name="gender" value={form.gender || ""} onChange={update}>
                <option value="">Select gender</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
                <option value="Prefer not to say">Prefer not to say</option>
              </select>
            </label>

            {!isFaculty && <div className="two-fields">
              <label>
                Guardian name
                <input
                  name="guardianName"
                  value={form.guardianName || ""}
                  onChange={update}
                />
              </label>
              <label>
                Guardian phone
                <input
                  name="guardianPhone"
                  value={form.guardianPhone || ""}
                  onChange={update}
                />
              </label>
            </div>}

            <div className="two-fields">
              <label>
                Allergies
                <input name="allergies" value={form.allergies || ""} onChange={update} />
              </label>
              <label>
                Medical conditions
                <input
                  name="conditions"
                  value={form.conditions || ""}
                  onChange={update}
                />
              </label>
            </div>

            </div></details><div className="form-actions">
              <button type="button" className="secondary-btn" disabled={recordSaving} onClick={() => setForm(null)}>
                Cancel
              </button>
              <button type="submit" className="primary-btn" disabled={recordSaving}>
                <Check size={16} /> {recordSaving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
            </fieldset>
          </form>
        </ModalDialog>
      )}
    </div>
  );
}

/**
 * Detail component - Displays a single detail row in the profile
 * Used in the Personal Details section to show label-value pairs
 * @param {string} label - The field label (e.g., "Date of birth")
 * @param {string} value - The field value to display
 */
function Detail({ label, value }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value || "Not recorded"}</strong>
    </div>
  );
}
