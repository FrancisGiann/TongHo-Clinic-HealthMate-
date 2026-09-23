import { ClipboardCheck, Search } from "lucide-react";
import { useState } from "react";
import { addRecord } from "../db/database";
export default function HealthScreening({ data, setData }) {
  const [studentId, setStudentId] = useState("");
  const [vision, setVision] = useState("20/20");
  const [search, setSearch] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const save = () => {
    if (!studentId) {
      setError("Please select a student.");
      return;
    }
    setError("");
    setData(addRecord(data, "screenings", { studentId: Number(studentId), schoolYear: data.settings.schoolYear, date: new Date().toISOString().slice(0, 10), vision, hearing: "Pass", bmi: "Normal", nutritionalStatus: "Normal" }));
    setSaved(true);
    setStudentId("");
  };

  // Calculate screening statistics
  const totalStudents = data.students.length;
  const screenedStudents = (data.screenings || []).length;
  const screeningPercentage = totalStudents > 0
    ? Math.round((screenedStudents / totalStudents) * 100)
    : 0;

  // Calculate students needing follow-up (example: vision not 20/20)
  const needsFollowUp = (data.screenings || []).filter(
    s => s.vision !== '20/20' || s.hearing !== 'Pass' || s.bmi !== 'Normal'
  ).length;
  const latestScreening = new Map();
  (data.screenings || []).forEach((record) => latestScreening.set(record.studentId, record));
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
        <button className="primary-btn" onClick={() => document.getElementById("screening-form")?.scrollIntoView({ behavior: "smooth" })}>
          <ClipboardCheck size={16} /> Start batch screening
        </button>
      </div>
      <section className="screening-overview">
        <div className="overview-stat">
          <span>2025–2026 progress</span>
          <strong>{screeningPercentage}%</strong>
          <div className="progress">
            <i style={{ width: `${screeningPercentage}%` }} />
          </div>
          <small>{screenedStudents} of {totalStudents} students screened</small>
        </div>
        <div className="overview-stat">
          <span>Needs follow-up</span>
          <strong className="rose-text">{needsFollowUp}</strong>
          <small>{needsFollowUp > 0 ? 'Requires attention' : 'All clear'}</small>
        </div>
        <div className="overview-stat">
          <span>Next screening day</span>
          <strong className="date-text">{totalStudents > screenedStudents ? 'TBD' : 'Complete'}</strong>
          <small>{totalStudents > screenedStudents ? 'Schedule next batch' : 'All students screened'}</small>
        </div>
      </section>
      <section id="screening-form" className="panel inline-entry-form"><div className="panel-heading"><div><p className="section-kicker">Quick entry</p><h3>Record screening</h3></div></div><div className="two-fields"><label>Student<select value={studentId} onChange={(event) => setStudentId(event.target.value)}><option value="">Select student...</option>{data.students.map((student) => <option key={student.id} value={student.id}>{student.name}</option>)}</select></label><label>Vision result<select value={vision} onChange={(event) => setVision(event.target.value)}><option>20/20</option><option>20/30</option><option>20/40</option><option>Needs referral</option></select></label></div><button className="primary-btn" onClick={save}><ClipboardCheck size={16}/> Save screening</button>{error && <div className="error-banner" role="alert">{error}</div>}{saved && <p className="success-message">Screening saved successfully.</p>}</section>
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
              <th>BMI</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {roster.map((student) => {
              const record = latestScreening.get(student.id);
              return (
              <tr key={student.id}>
                <td>
                  <strong>{student.name}</strong>
                  <small>{student.studentId}</small>
                </td>
                <td>{student.gradeLevel}</td>
                <td>{record?.vision || "—"}</td>
                <td>{record?.hearing || "—"}</td>
                <td>{record?.bmi || "—"}</td>
                <td>
                  <span className={`status-chip ${record ? "success" : "neutral"}`}>
                    {record ? "Complete" : "Not started"}
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
