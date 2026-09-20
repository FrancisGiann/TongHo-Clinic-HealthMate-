import { useState } from "react";
import { AlertTriangle, Check, MapPin } from "lucide-react";
import { addRecord } from "../db/database";

const getCurrentDateTime = () => {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
};

export default function IncidentReport({ data, setData }) {
  const [saved, setSaved] = useState(false);
  const [errors, setErrors] = useState([]);
  const [studentId, setStudentId] = useState("");
  const [severity, setSeverity] = useState("Minor");
  const [date, setDate] = useState(getCurrentDateTime);
  const [location, setLocation] = useState("");
  const [type, setType] = useState("Other");
  const [description, setDescription] = useState("");
  const [actionTaken, setActionTaken] = useState("");
  const [parentNotified, setParentNotified] = useState(false);
  const save = (event) => {
    event.preventDefault();
    const validationErrors = [];
    if (!studentId) validationErrors.push("Select the student involved.");
    if (!date) validationErrors.push("Enter the incident date and time.");
    if (!location.trim()) validationErrors.push("Enter where the incident occurred.");
    if (!description.trim()) validationErrors.push("Describe what happened.");
    if (!actionTaken.trim()) validationErrors.push("Record the action taken.");
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      setSaved(false);
      return;
    }

    setData(
      addRecord(data, "incidents", {
        studentId: Number(studentId),
        date: date || new Date().toISOString(),
        location: location.trim(),
        type,
        severity,
        description: description.trim(),
        actionTaken: actionTaken.trim(),
        parentNotified,
      }),
    );
    setSaved(true);
    setErrors([]);
    setStudentId("");
    setDate(getCurrentDateTime());
    setLocation("");
    setType("Other");
    setSeverity("Minor");
    setDescription("");
    setActionTaken("");
    setParentNotified(false);
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
            <label>
                Involved student *{" "}
              <select
                value={studentId}
                onChange={(e) => setStudentId(e.target.value)}
              >
                <option value="">Select student...</option>
                {data.students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {s.studentId}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Date & time * <input type="datetime-local" value={date} onChange={(event) => setDate(event.target.value)} />
            </label>
          </div>
          <div className="two-fields">
            <label>
              Location *{" "}
              <div className="input-with-icon">
                <MapPin size={15} />
                <input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="e.g. Covered court" />
              </div>
            </label>
            <label>
              Incident type *{" "}
              <select value={type} onChange={(event) => setType(event.target.value)}>
                <option>Playground injury</option>
                <option>Sports injury</option>
                <option>Lab accident</option>
                <option>Allergic reaction</option>
                <option>Other</option>
              </select>
            </label>
          </div>
        </div>
        <div className="form-step">
          <div className="step-heading">
            <span>02</span>
            <h3>What happened?</h3>
          </div>
          <label>
            Description *{" "}
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Describe the incident objectively..." />
          </label>
          <label>
            Action taken *{" "}
            <textarea value={actionTaken} onChange={(event) => setActionTaken(event.target.value)} placeholder="First aid, notifications, referrals..." />
          </label>
          <div className="severity-row">
            <span className="field-label">Severity</span>
            {["Minor", "Moderate", "Severe", "Critical"].map((level) => (
              <button key={level} type="button" onClick={() => setSeverity(level)} className={`severity ${severity === level ? "chosen" : ""}`}>
                {level}
              </button>
            ))}
          </div>
        </div>
        <div className="form-actions">
          <label className="check-label">
            <input type="checkbox" checked={parentNotified} onChange={(event) => setParentNotified(event.target.checked)} /> Parent / guardian notified
          </label>
          <button className="primary-btn" type="submit">
            <Check size={16} /> Save report
          </button>
        </div>
        {saved && <p className="success-message">Incident report saved.</p>}
      </form>
    </div>
  );
}
