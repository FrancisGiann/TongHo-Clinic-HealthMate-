import { useState } from "react";
import { ArrowLeft, Check, UserPlus, AlertCircle } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { addRecord } from "../db/database";

/**
 * Initial form state for student registration
 * All fields are initialized as empty strings except for defaults
 */
const GOOGLE_SHEETS_WEB_APP_URL = "";

const initialForm = {
  // Student Information
  studentId: "",
  name: "",
  gradeLevel: "Grade 1",
  section: "",
  adviser: "",
  birthDate: "",
  gender: "",
  // Guardian Information
  guardianName: "",
  guardianPhone: "",
  guardianRelation: "Parent",
  motherName: "",
  fatherName: "",
  // Basic Health Information
  bloodType: "",
  allergies: "",
  conditions: "",
  medications: "",
  // Past Illness
  pastIllness: {
    chickenpox: false,
    pneumonia: false,
    dengue: false,
    measles: false,
    gastroenteritis: false,
    amoebasis: false,
    typhoidFever: false,
    heartDisease: false,
    asthma: false,
    headInjury: false,
    otherPastIllness: "",
  },
  // Present Illness
  presentIllness: {
    allergicRhinitis: false,
    hyperacidity: false,
    asthma: false,
    skinDisorder: false,
    eyeDisorder: false,
    otherPresentIllness: "",
  },
  // Hospitalization History
  hospitalizationHistory: false,
  hospitalizationDetails: "",
  // G6PD Deficiency
  g6pdDeficiency: "",
  // Medication at Home
  medicationAtHome: {
    pain: false,
    fever: false,
    allergies: false,
    stomachache: false,
    otherMedication: "",
  },
  // Regular Medication
  takingRegularMedication: "",
  regularMedicationName: "",
  // Therapy/Interventions
  onTherapy: "",
  lastTreatmentDate: "",
  therapistName: "",
  // Concerns
  hasConcerns: false,
  concernsDetails: "",
  // Required Documents
  documents: {
    psychiatricEvaluation: false,
    diagnosticAssessment: false,
    medicationRecords: false,
  },
  profileImage: null,
};

const submitToGoogleSheets = async (record) => {
  const url = GOOGLE_SHEETS_WEB_APP_URL.trim();
  if (!url) {
    return { ok: true, skipped: true };
  }

  // Convert past illness data to readable format
  const pastIllnessList = Object.keys(record.pastIllness)
    .filter(key => key !== "otherPastIllness" && record.pastIllness[key])
    .join(", ");

  // Convert present illness data to readable format
  const presentIllnessList = Object.keys(record.presentIllness)
    .filter(key => key !== "otherPresentIllness" && record.presentIllness[key])
    .join(", ");

  // Convert medications at home to readable format
  const homemedList = Object.keys(record.medicationAtHome)
    .filter(key => key !== "otherMedication" && record.medicationAtHome[key])
    .join(", ");

  // Convert documents to readable format
  const documentsList = Object.keys(record.documents)
    .filter(key => record.documents[key])
    .join(", ");

  const payload = new URLSearchParams({
    studentId: record.studentId || "",
    fullName: record.name || "",
    gradeLevel: record.gradeLevel || "",
    section: record.section || "",
    classAdviser: record.adviser || "",
    birthDate: record.birthDate || "",
    gender: record.gender || "",
    motherName: record.motherName || "",
    fatherName: record.fatherName || "",
    guardianName: record.guardianName || "",
    guardianPhone: record.guardianPhone || "",
    relationship: record.guardianRelation || "",
    bloodType: record.bloodType || "",
    allergies: record.allergies || "",
    medicalConditions: record.conditions || "",
    medications: record.medications || "",
    pastIllness: pastIllnessList + (record.pastIllness.otherPastIllness ? `, ${record.pastIllness.otherPastIllness}` : ""),
    presentIllness: presentIllnessList + (record.presentIllness.otherPresentIllness ? `, ${record.presentIllness.otherPresentIllness}` : ""),
    hospitalizationHistory: record.hospitalizationHistory ? "Yes" : "No",
    hospitalizationDetails: record.hospitalizationDetails || "",
    g6pdDeficiency: record.g6pdDeficiency || "",
    onTherapy: record.onTherapy ? "Yes" : "No",
    therapyDetails: record.therapistName ? `${record.lastTreatmentDate} - ${record.therapistName}` : "",
    medicationAtHome: homemedList + (record.medicationAtHome.otherMedication ? `, ${record.medicationAtHome.otherMedication}` : ""),
    regularMedication: record.takingRegularMedication || "",
    regularMedicationName: record.regularMedicationName || "",
    concerns: record.hasConcerns ? record.concernsDetails : "None reported",
    documents: documentsList || "None submitted",
  });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: payload.toString(),
  });

  if (!response.ok) {
    throw new Error(`Google Sheets sync failed (${response.status})`);
  }

  const result = await response.json();
  if (result?.result !== "success") {
    throw new Error("Google Sheets did not confirm a successful save.");
  }

  return { ok: true, skipped: false };
};

/**
 * Form validation rules and messages
 */
const validateForm = (form) => {
  const errors = [];

  if (!form.studentId?.trim()) {
    errors.push("Student ID is required");
  }

  if (!form.name?.trim()) {
    errors.push("Student name is required");
  }

  if (!form.gradeLevel) {
    errors.push("Grade level is required");
  }

  // Validate phone number format if provided
  if (form.guardianPhone && !/^[\d\s\-\+\(\)]{7,}$/.test(form.guardianPhone)) {
    errors.push("Guardian phone number format is invalid");
  }

  // Warn if critical health info is missing
  if (!form.bloodType) {
    errors.push("Blood type is strongly recommended for emergency care");
  }

  return errors;
};

/**
 * StudentRegistration component
 * Allows nurses to create new student health records with complete information
 */
export default function StudentRegistration({ data, setData }) {
  const navigate = useNavigate();
  const [form, setForm] = useState(initialForm);
  const [saved, setSaved] = useState(false);
  const [errors, setErrors] = useState([]);
  const [loading, setLoading] = useState(false);

  /**
   * Update form field on input change
   */
  const update = (event) => {
    const { name, value } = event.target;
    setForm({ ...form, [name]: value });
    // Clear errors when user starts editing
    if (errors.length > 0) {
      setErrors([]);
    }
  };

  /**
   * Update nested object fields (e.g., pastIllness.chickenpox)
   */
  const updateNested = (section, field, value) => {
    setForm({
      ...form,
      [section]: {
        ...form[section],
        [field]: value,
      },
    });
    if (errors.length > 0) {
      setErrors([]);
    }
  };

  /**
   * Handle form submission with validation
   */
  const save = async (event) => {
    event.preventDefault();
    setErrors([]);
    setLoading(true);

    // Validate form
    const validationErrors = validateForm(form);
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      setLoading(false);
      return;
    }

    try {
      const recordToSave = { ...form };
      setData(addRecord(data, "students", recordToSave));

      try {
        await submitToGoogleSheets(recordToSave);
      } catch (syncError) {
        console.warn("Student record saved locally but failed to sync to Google Sheets.", syncError);
        setErrors(["Student record saved locally, but Google Sheets sync failed."]);
      }

      setSaved(true);
      // Navigate after brief delay to show success feedback
      setTimeout(() => navigate("/students"), 700);
    } catch (error) {
      console.error("Failed to save student record:", error);
      setErrors(["Failed to save student record. Please try again."]);
      setLoading(false);
    }
  };

  /**
   * Reset form to initial state
   */
  const resetForm = () => {
    setForm(initialForm);
    setErrors([]);
  };

  return (
    <div className="form-page">
      <Link to="/students" className="back-link">
        <ArrowLeft size={16} /> Back to students
      </Link>

      <div className="page-intro">
        <div>
          <p className="section-kicker">Student directory</p>
          <h2>New Health Record</h2>
          <p>Complete student registration and health history</p>
        </div>
      </div>

      {/* Validation Errors Display */}
      {errors.length > 0 && (
        <div className="error-banner">
          <AlertCircle size={18} />
          <div>
            <strong>Please fix these fields:</strong>
            <ul>
              {errors.map((error, idx) => (
                <li key={idx}>{error}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Registration Form */}
      <form className="panel form-panel registration-form" onSubmit={save}>
        
        {/* Student & Family Information */}
        <div className="form-section">
          <h3 className="section-title">Student & Family Information</h3>
          
          <div className="two-fields">
            <label>
              Student ID <span className="required">*</span>
              <input
                name="studentId"
                value={form.studentId}
                onChange={update}
                placeholder="e.g., THA-1301"
                required
                autoFocus
                disabled={loading}
              />
            </label>
            <label>
              Full Name <span className="required">*</span>
              <input
                name="name"
                value={form.name}
                onChange={update}
                placeholder="Last name, First name, M.I."
                required
                disabled={loading}
              />
            </label>
          </div>

          <div className="three-fields">
            <label>
              Birth Date
              <input
                type="date"
                name="birthDate"
                value={form.birthDate}
                onChange={update}
                disabled={loading}
              />
            </label>
            <label>
              Age
              <input
                type="number"
                placeholder="Auto-calculated"
                disabled
              />
            </label>
            <label>
              Gender
              <select name="gender" value={form.gender} onChange={update} disabled={loading}>
                <option value="">Select</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
              </select>
            </label>
          </div>

          <div className="two-fields">
            <label>
              Mother's Name
              <input
                value={form.motherName}
                onChange={(e) => setForm({ ...form, motherName: e.target.value })}
                placeholder="Full name"
                disabled={loading}
              />
            </label>
            <label>
              Father's Name
              <input
                value={form.fatherName}
                onChange={(e) => setForm({ ...form, fatherName: e.target.value })}
                placeholder="Full name"
                disabled={loading}
              />
            </label>
          </div>

          <div className="two-fields">
            <label>
              Guardian/Emergency Contact
              <input
                name="guardianName"
                value={form.guardianName}
                onChange={update}
                placeholder="Name"
                disabled={loading}
              />
            </label>
            <label>
              Relationship
              <select
                name="guardianRelation"
                value={form.guardianRelation}
                onChange={update}
                disabled={loading}
              >
                <option>Parent</option>
                <option>Grandparent</option>
                <option>Aunt/Uncle</option>
                <option>Other</option>
              </select>
            </label>
          </div>

          <label>
            Contact Number
            <input
              name="guardianPhone"
              value={form.guardianPhone}
              onChange={update}
              placeholder="+63 2 8123 4567"
              type="tel"
              disabled={loading}
            />
          </label>
        </div>

        {/* School Information */}
        <div className="form-section">
          <h3 className="section-title">School Information</h3>
          
          <div className="three-fields">
            <label>
              Grade Level <span className="required">*</span>
              <select
                name="gradeLevel"
                value={form.gradeLevel}
                onChange={update}
                required
                disabled={loading}
              >
                {Array.from({ length: 12 }, (_, index) => (
                  <option key={index}>Grade {index + 1}</option>
                ))}
              </select>
            </label>
            <label>
              Section
              <input
                name="section"
                value={form.section}
                onChange={update}
                placeholder="e.g., Sampaguita"
                disabled={loading}
              />
            </label>
            <label>
              Class Adviser
              <input
                name="adviser"
                value={form.adviser}
                onChange={update}
                placeholder="Name"
                disabled={loading}
              />
            </label>
          </div>
        </div>

        {/* Health & Medical Information */}
        <div className="form-section">
          <h3 className="section-title">Medical & Health Information</h3>
          
          <div className="two-fields">
            <label>
              Blood Type <span className="required">*</span>
              <select name="bloodType" value={form.bloodType} onChange={update} disabled={loading}>
                <option value="">Select blood type</option>
                <option value="O+">O+</option>
                <option value="O-">O-</option>
                <option value="A+">A+</option>
                <option value="A-">A-</option>
                <option value="B+">B+</option>
                <option value="B-">B-</option>
                <option value="AB+">AB+</option>
                <option value="AB-">AB-</option>
              </select>
            </label>
            <label>
              G6PD Deficiency
              <select
                value={form.g6pdDeficiency}
                onChange={(e) => setForm({ ...form, g6pdDeficiency: e.target.value })}
                disabled={loading}
              >
                <option value="">Unknown</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </label>
          </div>

          <label>
            Known Allergies
            <input
              name="allergies"
              value={form.allergies}
              onChange={update}
              placeholder="e.g., Penicillin, Peanuts, Shellfish"
              disabled={loading}
            />
          </label>

          <label>
            Current Medications
            <textarea
              name="medications"
              value={form.medications}
              onChange={update}
              placeholder="List any medications with dosage"
              disabled={loading}
              rows={2}
            />
          </label>

          <label>
            Existing Medical Conditions
            <textarea
              name="conditions"
              value={form.conditions}
              onChange={update}
              placeholder="e.g., Asthma, Diabetes, Hypertension"
              disabled={loading}
              rows={2}
            />
          </label>
        </div>

        {/* Medical History */}
        <details className="form-section collapsible-section">
          <summary>
            <h3 className="section-title">Medical & Illness History</h3>
            <span className="toggle-icon">+</span>
          </summary>
          
          <div className="section-content">
            <div className="health-subsection">
              <h4>Past Illnesses</h4>
              <div className="checkbox-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={form.pastIllness.chickenpox}
                    onChange={(e) => updateNested("pastIllness", "chickenpox", e.target.checked)}
                    disabled={loading}
                  />
                  Chickenpox
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={form.pastIllness.pneumonia}
                    onChange={(e) => updateNested("pastIllness", "pneumonia", e.target.checked)}
                    disabled={loading}
                  />
                  Pneumonia
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={form.pastIllness.dengue}
                    onChange={(e) => updateNested("pastIllness", "dengue", e.target.checked)}
                    disabled={loading}
                  />
                  Dengue
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={form.pastIllness.measles}
                    onChange={(e) => updateNested("pastIllness", "measles", e.target.checked)}
                    disabled={loading}
                  />
                  Measles
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={form.pastIllness.gastroenteritis}
                    onChange={(e) => updateNested("pastIllness", "gastroenteritis", e.target.checked)}
                    disabled={loading}
                  />
                  Gastroenteritis
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={form.pastIllness.amoebasis}
                    onChange={(e) => updateNested("pastIllness", "amoebasis", e.target.checked)}
                    disabled={loading}
                  />
                  Amoebasis
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={form.pastIllness.typhoidFever}
                    onChange={(e) => updateNested("pastIllness", "typhoidFever", e.target.checked)}
                    disabled={loading}
                  />
                  Typhoid Fever
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={form.pastIllness.heartDisease}
                    onChange={(e) => updateNested("pastIllness", "heartDisease", e.target.checked)}
                    disabled={loading}
                  />
                  Heart Disease
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={form.pastIllness.asthma}
                    onChange={(e) => updateNested("pastIllness", "asthma", e.target.checked)}
                    disabled={loading}
                  />
                  Asthma
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={form.pastIllness.headInjury}
                    onChange={(e) => updateNested("pastIllness", "headInjury", e.target.checked)}
                    disabled={loading}
                  />
                  Head Injury
                </label>
              </div>
              <label>
                <textarea
                  value={form.pastIllness.otherPastIllness}
                  onChange={(e) => updateNested("pastIllness", "otherPastIllness", e.target.value)}
                  placeholder="Other illnesses..."
                  disabled={loading}
                  rows={2}
                />
              </label>
            </div>

            <div className="health-subsection">
              <h4>Current/Present Conditions</h4>
              <div className="checkbox-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={form.presentIllness.allergicRhinitis}
                    onChange={(e) => updateNested("presentIllness", "allergicRhinitis", e.target.checked)}
                    disabled={loading}
                  />
                  Allergic Rhinitis
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={form.presentIllness.hyperacidity}
                    onChange={(e) => updateNested("presentIllness", "hyperacidity", e.target.checked)}
                    disabled={loading}
                  />
                  Hyperacidity
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={form.presentIllness.asthma}
                    onChange={(e) => updateNested("presentIllness", "asthma", e.target.checked)}
                    disabled={loading}
                  />
                  Asthma
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={form.presentIllness.skinDisorder}
                    onChange={(e) => updateNested("presentIllness", "skinDisorder", e.target.checked)}
                    disabled={loading}
                  />
                  Skin Disorder
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={form.presentIllness.eyeDisorder}
                    onChange={(e) => updateNested("presentIllness", "eyeDisorder", e.target.checked)}
                    disabled={loading}
                  />
                  Eye Disorder
                </label>
              </div>
              <label>
                <textarea
                  value={form.presentIllness.otherPresentIllness}
                  onChange={(e) => updateNested("presentIllness", "otherPresentIllness", e.target.value)}
                  placeholder="Other current conditions..."
                  disabled={loading}
                  rows={2}
                />
              </label>
            </div>

            <div className="health-subsection">
              <h4>Hospitalization History</h4>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={form.hospitalizationHistory}
                  onChange={(e) => setForm({ ...form, hospitalizationHistory: e.target.checked })}
                  disabled={loading}
                />
                Hospitalized in the past year?
              </label>
              {form.hospitalizationHistory && (
                <label>
                  <textarea
                    value={form.hospitalizationDetails}
                    onChange={(e) => setForm({ ...form, hospitalizationDetails: e.target.value })}
                    placeholder="Reason and dates"
                    disabled={loading}
                    rows={2}
                  />
                </label>
              )}
            </div>

            <div className="health-subsection">
              <h4>Current Treatments & Therapy</h4>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={form.onTherapy !== ""}
                  onChange={(e) => setForm({ ...form, onTherapy: e.target.checked ? "yes" : "" })}
                  disabled={loading}
                />
                Currently in therapy or receiving intervention
              </label>
              {form.onTherapy && (
                <div className="two-fields">
                  <label>
                    Last Treatment Date
                    <input
                      type="date"
                      value={form.lastTreatmentDate}
                      onChange={(e) => setForm({ ...form, lastTreatmentDate: e.target.value })}
                      disabled={loading}
                    />
                  </label>
                  <label>
                    Therapist/Professional Name
                    <input
                      value={form.therapistName}
                      onChange={(e) => setForm({ ...form, therapistName: e.target.value })}
                      placeholder="Name"
                      disabled={loading}
                    />
                  </label>
                </div>
              )}
            </div>

            <div className="health-subsection">
              <h4>Home Medications</h4>
              <div className="checkbox-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={form.medicationAtHome.pain}
                    onChange={(e) => updateNested("medicationAtHome", "pain", e.target.checked)}
                    disabled={loading}
                  />
                  Pain reliever
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={form.medicationAtHome.fever}
                    onChange={(e) => updateNested("medicationAtHome", "fever", e.target.checked)}
                    disabled={loading}
                  />
                  Fever/Antipyretic
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={form.medicationAtHome.allergies}
                    onChange={(e) => updateNested("medicationAtHome", "allergies", e.target.checked)}
                    disabled={loading}
                  />
                  Allergy medication
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={form.medicationAtHome.stomachache}
                    onChange={(e) => updateNested("medicationAtHome", "stomachache", e.target.checked)}
                    disabled={loading}
                  />
                  Stomach medication
                </label>
              </div>
              <label>
                <input
                  value={form.medicationAtHome.otherMedication}
                  onChange={(e) => updateNested("medicationAtHome", "otherMedication", e.target.value)}
                  placeholder="Other medications available at home"
                  disabled={loading}
                />
              </label>
            </div>

            <div className="health-subsection">
              <h4>Regular Medication</h4>
              <label>
                Taking regular medication?
                <div className="radio-group">
                  <label className="radio-label">
                    <input
                      type="radio"
                      name="regularMed"
                      value="yes"
                      checked={form.takingRegularMedication === "yes"}
                      onChange={() => setForm({ ...form, takingRegularMedication: "yes" })}
                      disabled={loading}
                    />
                    Yes
                  </label>
                  <label className="radio-label">
                    <input
                      type="radio"
                      name="regularMed"
                      value="no"
                      checked={form.takingRegularMedication === "no"}
                      onChange={() => setForm({ ...form, takingRegularMedication: "no" })}
                      disabled={loading}
                    />
                    No
                  </label>
                </div>
              </label>
              {form.takingRegularMedication === "yes" && (
                <label>
                  Medication Details
                  <textarea
                    value={form.regularMedicationName}
                    onChange={(e) => setForm({ ...form, regularMedicationName: e.target.value })}
                    placeholder="Name, dosage, frequency"
                    disabled={loading}
                    rows={2}
                  />
                </label>
              )}
            </div>
          </div>
        </details>

        {/* Behavioral & Concerns */}
        <details className="form-section collapsible-section">
          <summary>
            <h3 className="section-title">Behavioral & Concerns</h3>
            <span className="toggle-icon">+</span>
          </summary>
          
          <div className="section-content">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={form.hasConcerns}
                onChange={(e) => setForm({ ...form, hasConcerns: e.target.checked })}
                disabled={loading}
              />
              Student has behavioral, emotional, or psychological concerns
            </label>

            {form.hasConcerns && (
              <label>
                <textarea
                  value={form.concernsDetails}
                  onChange={(e) => setForm({ ...form, concernsDetails: e.target.value })}
                  placeholder="Describe concerns: mental health, behavioral, emotional, psychological conditions..."
                  disabled={loading}
                  rows={4}
                />
              </label>
            )}

            <div className="checkbox-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={form.documents.psychiatricEvaluation}
                  onChange={(e) => updateNested("documents", "psychiatricEvaluation", e.target.checked)}
                  disabled={loading}
                />
                Psychiatric Evaluation Report
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={form.documents.diagnosticAssessment}
                  onChange={(e) => updateNested("documents", "diagnosticAssessment", e.target.checked)}
                  disabled={loading}
                />
                Diagnostic Assessment Report
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={form.documents.medicationRecords}
                  onChange={(e) => updateNested("documents", "medicationRecords", e.target.checked)}
                  disabled={loading}
                />
                Medication Records
              </label>
            </div>
          </div>
        </details>

        {/* Form Actions */}
        <div className="form-actions">
          <button
            type="button"
            className="secondary-btn"
            onClick={resetForm}
            disabled={loading}
          >
            Clear
          </button>
          <Link to="/students" className="secondary-btn">
            Cancel
          </Link>
          <button type="submit" className="primary-btn" disabled={loading}>
            {loading ? (
              <>
                <span className="spinner" />
                Saving...
              </>
            ) : (
              <>
                <Check size={16} /> Save Record
              </>
            )}
          </button>
        </div>
      </form>

      {/* Success Message */}
      {saved && (
        <div className="success-banner">
          <Check size={18} />
          <p>Record saved successfully. Redirecting...</p>
        </div>
      )}
    </div>
  );
}
