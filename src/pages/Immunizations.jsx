import { Syringe, ArrowUpRight } from "lucide-react";
import { useState } from "react";
import { addRecord } from "../db/database";
export default function Immunizations({ data, setData }) {
  const [studentId, setStudentId] = useState(""); 
  const [vaccineName, setVaccineName] = useState("MMR"); 
  const [saved, setSaved] = useState(false);
  const [statusFilter, setStatusFilter] = useState("All statuses");
  const save = () => { if (!studentId) return; setData(addRecord(data, "immunizations", { studentId: Number(studentId), vaccineName, doseNumber: "1st", dateAdministered: new Date().toISOString().slice(0, 10), nextDueDate: "", remarks: "Recorded in clinic" })); setSaved(true); setStudentId(""); };
  
  // Calculate immunization statistics
  const totalStudents = data.students.length;
  const fullyImmunized = new Set((data.immunizations || []).filter(
    imm => imm.remarks?.toLowerCase().includes('complete') || 
           imm.remarks?.toLowerCase().includes('up to date') ||
           imm.nextDueDate === ''
  ).map((record) => record.studentId)).size;
  const immunizationRate = totalStudents > 0 
    ? Math.round((fullyImmunized / totalStudents) * 100) 
    : 0;
  
  // Calculate due this month (students with nextDueDate in current month)
  const currentMonth = new Date().getMonth();
  const dueThisMonth = (data.immunizations || []).filter(imm => {
    if (!imm.nextDueDate) return false;
    const dueDate = new Date(imm.nextDueDate);
    return dueDate.getMonth() === currentMonth && dueDate.getFullYear() === new Date().getFullYear();
  }).length;
  
  // Calculate overdue (nextDueDate in the past)
  const today = new Date();
  const overdue = (data.immunizations || []).filter(imm => {
    if (!imm.nextDueDate) return false;
    return new Date(imm.nextDueDate) < today;
  }).length;
  const latestImmunization = new Map();
  (data.immunizations || []).forEach((record) => latestImmunization.set(record.studentId, record));
  const compliance = (student) => latestImmunization.has(student.id) ? "Fully immunized" : "Not started";
  const roster = data.students.filter((student) => statusFilter === "All statuses" || compliance(student) === statusFilter);
  
  return (
    <div className="form-page">
      <div className="page-intro">
        <div>
          <p className="section-kicker">Preventive care</p>
          <h2>Immunizations</h2>
          <p>Stay ahead of every dose and due date.</p>
        </div>
        <button className="primary-btn" onClick={() => document.getElementById("immunization-form")?.scrollIntoView({ behavior: "smooth" })}>
          <Syringe size={16} /> Record vaccination
        </button>
      </div>
      <section id="immunization-form" className="panel inline-entry-form"><div className="panel-heading"><div><p className="section-kicker">Quick entry</p><h3>Record vaccination</h3></div></div><div className="two-fields"><label>Student<select value={studentId} onChange={(event) => setStudentId(event.target.value)}><option value="">Select student...</option>{data.students.map((student) => <option key={student.id} value={student.id}>{student.name}</option>)}</select></label><label>Vaccine<select value={vaccineName} onChange={(event) => setVaccineName(event.target.value)}>{["BCG", "Hepatitis B", "DPT", "OPV", "Measles", "MMR", "Td", "HPV"].map((vaccine) => <option key={vaccine}>{vaccine}</option>)}</select></label></div><button className="primary-btn" onClick={save}><Syringe size={16}/> Save vaccination</button>{saved && <p className="success-message">Vaccination recorded successfully.</p>}</section>
      <div className="immunization-cards">
        <div>
          <span>Fully immunized</span>
          <strong>{immunizationRate}%</strong>
          <small>
            {fullyImmunized} of {totalStudents} students
          </small>
        </div>
        <div>
          <span>Due this month</span>
          <strong className="amber-text">{dueThisMonth}</strong>
          <small>{dueThisMonth > 0 ? 'Requires scheduling' : 'None due'}</small>
        </div>
        <div>
          <span>Overdue doses</span>
          <strong className="rose-text">{overdue}</strong>
          <small>{overdue > 0 ? 'Needs follow-up' : 'All current'}</small>
        </div>
      </div>
      <section className="panel table-panel">
        <div className="panel-heading">
          <div>
            <p className="section-kicker">Vaccine tracker</p>
            <h3>Student compliance</h3>
          </div>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option>All statuses</option>
            <option>Fully immunized</option>
            <option>Partially immunized</option>
          </select>
        </div>
        <table>
          <thead>
            <tr>
              <th>Student</th>
              <th>Grade</th>
              <th>Last vaccine</th>
              <th>Next due</th>
              <th>Compliance</th>
            </tr>
          </thead>
          <tbody>
            {roster.map((student) => {
              const record = latestImmunization.get(student.id);
              const status = compliance(student);
              return (
              <tr key={student.id}>
                <td>
                  <strong>{student.name}</strong>
                  <small>{student.studentId}</small>
                </td>
                <td>{student.gradeLevel}</td>
                <td>{record ? `${record.vaccineName} · ${record.doseNumber}` : "No records"}</td>
                <td>{record?.nextDueDate || "Review needed"}</td>
                <td>
                  <span className={`status-chip ${record ? "success" : "neutral"}`}>
                    {status}
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
