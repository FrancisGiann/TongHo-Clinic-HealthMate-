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
import { useState, useRef } from "react";
import { saveData } from "../db/database";

export default function StudentProfile({ data, setData }) {
  const { studentId } = useParams();
  const navigate = useNavigate();
  const student = data.students.find((item) => item.id === Number(studentId));
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const fileInputRef = useRef(null);

  if (!student)
    return (
      <div className="empty-page">
        <h2>Student not found</h2>
        <Link to="/students">Back to students</Link>
      </div>
    );

  const visits = data.visits.filter((visit) => visit.studentId === student.id);

  const openEditor = () => {
    setForm({ ...student });
    setImagePreview(student.profileImage || null);
  };

  const update = (event) => setForm({ ...form, [event.target.name]: event.target.value });

  /**
   * Handle image file selection and convert to base64
   */
  const handleImageUpload = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      alert('Please select a valid image file');
      return;
    }

    // Validate file size (limit to 2MB)
    const maxSize = 2 * 1024 * 1024;
    if (file.size > maxSize) {
      alert('Image size must be less than 2MB');
      return;
    }

    // Convert to base64
    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = e.target?.result;
      setImagePreview(base64);
      setForm({ ...form, profileImage: base64 });
    };
    reader.readAsDataURL(file);
  };

  /**
   * Clear the uploaded image
   */
  const clearImage = () => {
    setImagePreview(null);
    setForm({ ...form, profileImage: null });
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  /**
   * Validate form before saving
   */
  const validateStudentForm = (studentForm) => {
    if (!studentForm.name?.trim()) {
      alert("Student name is required");
      return false;
    }
    if (!studentForm.studentId?.trim()) {
      alert("Student ID is required");
      return false;
    }
    return true;
  };

  const save = (event) => {
    event.preventDefault();
    
    // Validate form
    if (!validateStudentForm(form)) {
      return;
    }

    try {
      setData(
        saveData({
          ...data,
          students: data.students.map((item) =>
            item.id === student.id ? form : item
          ),
        })
      );
      setForm(null);
      setImagePreview(null);
      setEditing(false);
    } catch (error) {
      console.error("Failed to save student record:", error);
      alert("Failed to save changes. Please try again.");
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
                    Today
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
      </div>
      {form && (
        <div className="modal-backdrop" role="presentation" onClick={() => setForm(null)}>
          <form
            className="modal-card student-edit-modal"
            onSubmit={save}
            onClick={(event) => event.stopPropagation()}
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
              >
                ×
              </button>
            </div>

            {/* Profile Image Section */}
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
              <button type="submit" className="primary-btn">
                <Check size={16} /> Save changes
              </button>
            </div>
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
