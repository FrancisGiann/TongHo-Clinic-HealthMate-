import { ClipboardCheck, Search } from "lucide-react";
import { useState } from "react";
import { addRecord } from "../db/database";
import StudentPicker from "../components/StudentPicker";
function clinicDate(value = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export default function HealthScreening({ data, commitData }) {
  const [studentId, setStudentId] = useState("");
  const [vision, setVision] = useState("");
  const [hearing, setHearing] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [search, setSearch] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const schoolYear = data.settings.schoolYear || '';
  const save = async () => {
    setSaved(false);
    if (!studentId) {
      setError("Please select a student.");
      return;
    }
    setError("");
    if (![vision.trim(), hearing.trim(), heightCm, weightKg].some(Boolean)) {
      setError('Enter at least one measured finding.');
      return;
    }
    const height = heightCm === '' ? null : Number(heightCm);
    const weight = weightKg === '' ? null : Number(weightKg);
    if ((height !== null && (!Number.isFinite(height) || height < 40 || height > 250)) || (weight !== null && (!Number.isFinite(weight) || weight < 1 || weight > 300))) {
      setError('Height must be 40–250 cm and weight must be 1–300 kg.');
      return;
    }
    const bmi = height && weight ? Number((weight / ((height / 100) ** 2)).toFixed(1)) : null;
    setSaving(true);
    try {
      const screeningRecord = {
        studentId,
        schoolYear,
        date: clinicDate(),
        ...(vision.trim() ? { visionFinding: vision.trim() } : {}),
        ...(hearing.trim() ? { hearingFinding: hearing.trim() } : {}),
        ...(height !== null ? { heightCm: height } : {}),
        ...(weight !== null ? { weightKg: weight } : {}),
        ...(bmi !== null ? { bmi } : {}),
      };
      await commitData((current) => addRecord(current, "screenings", screeningRecord));
      setSaved(true);
      setStudentId("");
      setVision("");
      setHearing("");
      setHeightCm("");
      setWeightKg("");
    } catch (requestError) {
      setError(requestError.message || 'Screening could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const totalStudents = data.students.length;
  const yearRecords = (data.screenings || []).filter((record) => String(record.schoolYear || '') === String(schoolYear));
  const rosterIds = new Set(data.students.map((student) => String(student.id)));
  const screenedStudentIds = new Set(yearRecords.map((record) => String(record.studentId || record.patientId)).filter((id) => rosterIds.has(id)));
  const studentsWithRecords = screenedStudentIds.size;
  const screeningPercentage = totalStudents > 0
    ? Math.round((studentsWithRecords / totalStudents) * 100)
    : 0;
  const latestScreening = new Map();
  yearRecords.forEach((record) => {
    const key = String(record.studentId || record.patientId);
    const current = latestScreening.get(key);
    if (!current || String(record.date || record.createdAt || '') > String(current.date || current.createdAt || '')) latestScreening.set(key, record);
  });
  const roster = data.students.filter((student) =>
    `${student.name} ${student.studentId}`.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="form-page">
      <div className="page-intro">
        <div>
          <p className="section-kicker">Annual program</p>
          <h2>Health screening</h2>
          <p>Record annual checks and spot trends early.</p>
        </div>
      </div>
      <section className="screening-overview">
        <div className="overview-stat">
          <span>{schoolYear || 'Current school year'} progress</span>
          <strong>{studentsWithRecords} of {totalStudents}</strong>
          <div className="progress">
            <i style={{ width: `${screeningPercentage}%` }} />
          </div>
          <small>Students with a record for this school year</small>
        </div>
        <div className="overview-stat">
          <span>Screening records</span>
          <strong>{yearRecords.length}</strong>
          <small>Recorded for this school year</small>
        </div>
        <div className="overview-stat">
          <span>No record this year</span>
          <strong>{Math.max(0, totalStudents - studentsWithRecords)}</strong>
          <small>Based on this school year</small>
        </div>
      </section>
      <section id="screening-form" className="panel inline-entry-form"><div className="panel-heading"><div><p className="section-kicker">Quick entry</p><h3>Record measured findings</h3></div></div><StudentPicker students={data.students} value={studentId} onChange={setStudentId} required disabled={saving}/><div className="two-fields"><label>Vision finding<input value={vision} onChange={(event) => setVision(event.target.value)} maxLength={240} placeholder="Enter the measured result" disabled={saving}/></label><label>Hearing finding<input value={hearing} onChange={(event) => setHearing(event.target.value)} maxLength={240} placeholder="Enter the measured result" disabled={saving}/></label></div><div className="two-fields"><label>Height<input type="number" min="40" max="250" step="0.1" value={heightCm} onChange={(event) => setHeightCm(event.target.value)} placeholder="cm" disabled={saving}/></label><label>Weight<input type="number" min="1" max="300" step="0.1" value={weightKg} onChange={(event) => setWeightKg(event.target.value)} placeholder="kg" disabled={saving}/></label></div>{heightCm && weightKg && <p className="field-hint">BMI from these measurements: {(Number(weightKg) / ((Number(heightCm) / 100) ** 2)).toFixed(1)}. No category is inferred.</p>}<button className="primary-btn" onClick={save} disabled={saving || !data.students.length}><ClipboardCheck size={16}/>{saving ? 'Saving…' : 'Save screening'}</button>{error && <div className="error-banner" role="alert">{error}</div>}{saved && <p className="success-message" role="status">Screening saved to clinic records.</p>}</section>
      <section className="panel table-panel">
        <div className="panel-heading">
          <div>
            <p className="section-kicker">Student screening records</p>
            <h3>Screening roster</h3>
          </div>
          <div className="search-box compact">
            <Search size={16} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search roster..." />
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th>Student</th>
              <th>Grade</th>
              <th>Vision</th>
              <th>Hearing</th>
              <th>Height / weight</th>
              <th>BMI</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {roster.map((student) => {
              const record = latestScreening.get(String(student.id));
              return (
              <tr key={student.id}>
                <td>
                  <strong>{student.name}</strong>
                  <small>{student.studentId}</small>
                </td>
                <td>{student.gradeLevel}</td>
                <td>{record?.visionFinding || record?.vision || "—"}</td>
                <td>{record?.hearingFinding || record?.hearing || "—"}</td>
                <td>{record?.heightCm != null ? `${record.heightCm} cm` : '—'} / {record?.weightKg != null ? `${record.weightKg} kg` : '—'}</td>
                <td>{record?.bmi || "—"}</td>
                <td>
                  <span className={`status-chip ${record ? "success" : "neutral"}`}>
                    {record ? "Record on file" : "No record"}
                  </span>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
