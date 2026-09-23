import { useState } from "react";
import { AlertTriangle, Check, MapPin } from "lucide-react";
import { addRecord } from "../db/database";
import StudentPicker from "../components/StudentPicker";

const getCurrentDateTime = () => {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
};

export default function IncidentReport({ data, commitData }) {
  const [saved, setSaved] = useState(false);
  const [errors, setErrors] = useState([]);
  const [studentId, setStudentId] = useState("");
  const [severity, setSeverity] = useState("Minor");
  const [date, setDate] = useState(getCurrentDateTime);
  const [location, setLocation] = useState("");
  const [type, setType] = useState("Other");
  const [otherTypeDescription, setOtherTypeDescription] = useState("");
  const [description, setDescription] = useState("");
  const [actionTaken, setActionTaken] = useState("");
  const [parentNotified, setParentNotified] = useState(false);
  const [saving, setSaving] = useState(false);
  const save = async (event) => {
    event.preventDefault();
    const validationErrors = [];
    if (!studentId) validationErrors.push("Select the student involved.");
    if (!date) validationErrors.push("Enter the incident date and time.");
    if (!location.trim()) validationErrors.push("Enter where the incident occurred.");
    if (!description.trim()) validationErrors.push("Describe what happened.");
    if (type === 'Other' && !otherTypeDescription.trim()) validationErrors.push("Describe the incident type when Other is selected.");
    if (!actionTaken.trim()) validationErrors.push("Record the action taken.");
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      setSaved(false);
      return;
    }

    setSaving(true);
    try {
      const incidentRecord = {
        studentId,
        date: date || new Date().toISOString(),
        location: location.trim(),
        type,
        ...(type === 'Other' ? { otherTypeDescription: otherTypeDescription.trim() } : {}),
        severity,
        description: description.trim(),
        actionTaken: actionTaken.trim(),
        parentNotified,
      };
      await commitData((current) => addRecord(current, "incidents", incidentRecord));
      setSaved(true);
      setErrors([]);
      setStudentId("");
      setDate(getCurrentDateTime());
      setLocation("");
      setType("Other");
      setOtherTypeDescription("");
      setSeverity("Minor");
      setDescription("");
      setActionTaken("");
      setParentNotified(false);
    } catch (requestError) {
      setErrors([requestError.message || 'Incident report could not be saved.']);
      setSaved(false);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="form-page">
      <div className="page-intro">
        <div>
          <p className="section-kicker">Safety & documentation</p>
          <h2>Incident report</h2>
          <p>Document incidents with the detail your school records need.</p>
        </div>
        <div className="incident-mark">
          <AlertTriangle size={18} /> New report
        </div>
      </div>
      {errors.length > 0 && (
        <div className="error-banner" role="alert">
          <AlertTriangle size={18} />
          <div>
            <strong>Complete the incident report</strong>
            <ul>
              {errors.map((error) => <li key={error}>{error}</li>)}
            </ul>
          </div>
        </div>
      )}
      <form className="panel form-panel incident-form" onSubmit={save}>
        <div className="form-step">
          <div className="step-heading">
            <span>01</span>
            <h3>Incident details</h3>
          </div>
          <div className="two-fields">
            <StudentPicker students={data.students} value={studentId} onChange={setStudentId} label="Involved student" required disabled={saving}/>
            <label>
              Date & time * <input type="datetime-local" value={date} onChange={(event) => setDate(event.target.value)} disabled={saving}/>
            </label>
          </div>
          <div className="two-fields">
            <label>
              Location *{" "}
              <div className="input-with-icon">
                <MapPin size={15} />
                <input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="e.g. Covered court" disabled={saving}/>
              </div>
            </label>
            <div className="incident-type-field">
              <label>
                Incident type *{" "}
                <select value={type} onChange={(event) => { setType(event.target.value); setOtherTypeDescription(''); }} disabled={saving}>
                  <option>Playground injury</option>
                  <option>Sports injury</option>
                  <option>Lab accident</option>
                  <option>Allergic reaction</option>
                  <option>Other</option>
                </select>
              </label>
              {type === 'Other' && <label>Custom incident type description *<input value={otherTypeDescription} onChange={(event) => setOtherTypeDescription(event.target.value)} maxLength={160} placeholder="Describe the type of incident" required disabled={saving}/></label>}
            </div>
          </div>
        </div>
        <div className="form-step">
          <div className="step-heading">
            <span>02</span>
            <h3>What happened?</h3>
          </div>
          <label>
            Description *{" "}
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Describe the incident objectively..." disabled={saving}/>
          </label>
          <label>
            Action taken *{" "}
            <textarea value={actionTaken} onChange={(event) => setActionTaken(event.target.value)} placeholder="First aid, notifications, referrals..." disabled={saving}/>
          </label>
          <div className="severity-row">
            <span className="field-label">Severity</span>
            {["Minor", "Moderate", "Severe", "Critical"].map((level) => (
              <button key={level} type="button" onClick={() => setSeverity(level)} className={`severity ${severity === level ? "chosen" : ""}`} disabled={saving}>
                {level}
              </button>
            ))}
          </div>
        </div>
        <div className="form-actions">
          <label className="check-label">
            <input type="checkbox" checked={parentNotified} onChange={(event) => setParentNotified(event.target.checked)} disabled={saving} /> Parent / guardian notified
          </label>
          <button className="primary-btn" type="submit" disabled={saving}>
            <Check size={16} /> {saving ? 'Saving…' : 'Save report'}
          </button>
        </div>
        {saved && <p className="success-message" role="status">Incident report saved to clinic records.</p>}
      </form>
    </div>
  );
}
