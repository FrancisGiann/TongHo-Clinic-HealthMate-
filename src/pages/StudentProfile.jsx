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
import { Link, useNavigate, useParams } from "react-router-dom";
import { useState, useRef, useEffect } from "react";
import { saveData } from "../db/database";
import { api } from "../utils/api";

export default function StudentProfile({ data, commitData, reload }) {
  const { studentId } = useParams();
  const navigate = useNavigate();
  const student = data.students.find((item) => String(item.id) === String(studentId));
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(null);
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
        <h2>Student not found</h2>
        <Link to="/students">Back to students</Link>
      </div>
    );

  const visits = data.visits.filter((visit) => String(visit.studentId || visit.patientId) === String(student.id));

  const openEditor = () => {
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
      setRecordSaveError('Student name is required.');
      return false;
    }
    if (!studentForm.studentId?.trim()) {
      setRecordSaveError('Student ID is required.');
      return false;
    }

    // Check for duplicate student ID among OTHER students
    const duplicateId = data.students?.some(
      (s) => String(s.id) !== String(student.id) && s.studentId === studentForm.studentId.trim()
    );

    if (duplicateId) {
      setRecordSaveError('A student with this ID is already registered.');
      return false;
    }

    return true;
  };

  const save = async (event) => {
    event.preventDefault();

    // Validate form
    if (!validateStudentForm(form)) {
      return;
    }

    setRecordSaving(true);
    setRecordSaveError('');
    try {
      await commitData((current) => saveData({
        ...current,
        students: current.students.map((item) => String(item.id) === String(student.id) ? form : item),
      }));
      setRecordSaveMessage('Student record saved to clinic records.');
      setForm(null);
      setImagePreview(null);
      setEditing(false);
    } catch (error) {
      console.error("Failed to save student record:", error);
      setRecordSaveError(error.message || "Failed to save changes. Please try again.");
    } finally {
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
        <ArrowLeft size={16} /> Back to students
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
            onClick={openEditor}
            title="Upload profile image"
            aria-label="Upload student profile image"
          >
            <Camera size={16} />
          </button>
        </div>
        <div>
          <p className="section-kicker">Student profile</p>
          <h2>{student.name}</h2>
          {recordSaveMessage && <p className="success-message" role="status">{recordSaveMessage}</p>}
          <p>
            {student.studentId} <span>·</span> {student.gradeLevel},{" "}
            {student.section}
          </p>
        </div>
        <div className="profile-actions">
          <button className="secondary-btn" onClick={openEditor}><Pencil size={16} /> Edit student</button>
          <button className="secondary-btn" onClick={() => window.location.href = `tel:${student.guardianPhone}`}>
            <Phone size={16} /> Guardian
          </button>
          <Link to="/new-visit" className="primary-btn">
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
            <Detail label="Guardian" value={student.guardianName} />
            <Detail label="Contact" value={student.guardianPhone} />
          </div>
        </section>
        <section className="panel history-panel">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">Care record</p>
              <h3>Visit history</h3>
            </div>
            <button className="text-btn" onClick={() => navigate('/new-visit')}>Log visit</button>
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
              </div>
            ))
          ) : (
            <div className="empty-state">
              <p>No clinic visits yet</p>
              <small>Visit history will appear here once you log a visit for this student.</small>
            </div>
          )}
        </section>
        <section className="panel consent-tracking-panel">
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
        </section>
      </div>
      {form && (
        <div className="modal-backdrop" role="presentation" onClick={() => !recordSaving && setForm(null)}>
          <form
            className="modal-card student-edit-modal"
            onSubmit={save}
            onClick={(event) => event.stopPropagation()}
            aria-busy={recordSaving}
          >
            <div className="modal-heading">
              <div>
                <p className="section-kicker">Student record</p>
                <h3>Edit student</h3>
              </div>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setForm(null)}
                aria-label="Close editor"
                disabled={recordSaving}
              >
                ×
              </button>
            </div>

            {/* Profile Image Section */}
            {recordSaveError && <div className="error-banner" role="alert">{recordSaveError}</div>}
            <fieldset className="form-fieldset" disabled={recordSaving}>
            <div className="image-upload-section">
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
                style={{ width: '100%', marginBottom: '16px' }}
              >
                <Camera size={16} /> Choose Image
              </button>
              <small className="file-info">
                JPG, PNG or WebP. Max 2MB.
              </small>
            </div>

            <div className="two-fields">
              <label>
                Student ID *
                <input
                  name="studentId"
                  value={form.studentId}
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

            <div className="two-fields">
              <label>
                Grade level
                <select name="gradeLevel" value={form.gradeLevel} onChange={update}>
                  {Array.from({ length: 12 }, (_, index) => (
                    <option key={index}>Grade {index + 1}</option>
                  ))}
                </select>
              </label>
              <label>
                Section
                <input name="section" value={form.section || ""} onChange={update} />
              </label>
            </div>

            <div className="two-fields">
              <label>
                Adviser
                <input name="adviser" value={form.adviser || ""} onChange={update} />
              </label>
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

            <div className="two-fields">
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
            </div>

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

            <div className="form-actions">
              <button type="button" className="secondary-btn" onClick={() => setForm(null)}>
                Cancel
              </button>
              <button type="submit" className="primary-btn" disabled={recordSaving}>
                <Check size={16} /> {recordSaving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
            </fieldset>
          </form>
        </div>
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
