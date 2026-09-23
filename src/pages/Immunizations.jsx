import { Syringe } from "lucide-react";
import { useState } from "react";
import { addRecord } from "../db/database";
import StudentPicker from "../components/StudentPicker";
import { compareImmunizationLatest, latestImmunizationsByStudentVaccine } from "../../shared/immunizationOrder.js";
function clinicDate(value = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export default function Immunizations({ data, commitData }) {
  const [studentId, setStudentId] = useState("");
  const [vaccineName, setVaccineName] = useState("MMR");
  const [doseNumber, setDoseNumber] = useState("");
  const [dateAdministered, setDateAdministered] = useState(clinicDate);
  const [source, setSource] = useState("clinic");
  const [clinicName, setClinicName] = useState("");
  const [nextDueDate, setNextDueDate] = useState("");
  const [saved, setSaved] = useState(false);
  const [statusFilter, setStatusFilter] = useState("All due statuses");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaved(false);
    if (!studentId) {
      setError("Please select a student.");
      return;
    }
    if (!doseNumber.trim()) {
      setError("Enter the dose number or label.");
      return;
    }
    if (!dateAdministered || (nextDueDate && nextDueDate < dateAdministered)) {
      setError("Enter a valid administration date and a next due date on or after it.");
      return;
    }
    if (source === 'external' && !clinicName.trim()) {
      setError("Enter the external clinic name.");
      return;
    }
    setError("");
    setSaving(true);
    try {
      const immunizationRecord = {
        studentId,
        vaccineName,
        doseNumber: doseNumber.trim(),
        dateAdministered,
        source,
        ...(source === 'external' ? { clinicName: clinicName.trim() } : {}),
        nextDueDate,
      };
      await commitData((current) => addRecord(current, "immunizations", immunizationRecord));
      setSaved(true);
      setStudentId("");
      setDoseNumber("");
      setDateAdministered(clinicDate());
      setClinicName("");
      setNextDueDate("");
    } catch (requestError) {
      setError(requestError.message || 'Immunization record could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const today = clinicDate();
  const trackedRecords = latestImmunizationsByStudentVaccine(data.immunizations || [])
    .sort((first, second) => compareImmunizationLatest(second, first));
  const dueStatus = (record) => !record.nextDueDate ? 'No due date recorded' : record.nextDueDate < today ? 'Overdue' : record.nextDueDate.slice(0, 7) === today.slice(0, 7) ? 'Due this month' : 'Scheduled';
  const dueThisMonth = trackedRecords.filter((record) => dueStatus(record) === 'Due this month').length;
  const overdue = trackedRecords.filter((record) => dueStatus(record) === 'Overdue').length;
  const roster = trackedRecords.filter((record) => {
    const status = dueStatus(record);
    return statusFilter === 'All due statuses'
      || (statusFilter === 'Overdue' && status === 'Overdue')
      || (statusFilter === 'Due this month' && status === 'Due this month')
      || (statusFilter === 'No due date recorded' && status === 'No due date recorded');
  });

  return (
    <div className="form-page">
      <div className="page-intro">
        <div>
          <p className="section-kicker">Preventive care</p>
          <h2>Immunizations</h2>
          <p>Stay ahead of every dose and due date.</p>
        </div>
      </div>
      <section id="immunization-form" className="panel inline-entry-form"><div className="panel-heading"><div><p className="section-kicker">Quick entry</p><h3>Record a vaccine dose</h3></div></div><StudentPicker students={data.students} value={studentId} onChange={setStudentId} required disabled={saving}/><div className="two-fields"><label>Vaccine<input list="vaccine-suggestions" value={vaccineName} onChange={(event) => setVaccineName(event.target.value)} maxLength={120} required disabled={saving}/><datalist id="vaccine-suggestions">{["BCG", "Hepatitis B", "DPT", "OPV", "Measles", "MMR", "Td", "HPV"].map((vaccine) => <option key={vaccine} value={vaccine}/>)}</datalist></label><label>Dose number or label<input value={doseNumber} onChange={(event) => setDoseNumber(event.target.value)} maxLength={80} placeholder="e.g. 1st, 2nd, booster" required disabled={saving}/></label></div><div className="two-fields"><label>Date administered<input type="date" value={dateAdministered} max={today} onChange={(event) => setDateAdministered(event.target.value)} required disabled={saving}/></label><label>Source<select value={source} onChange={(event) => setSource(event.target.value)} disabled={saving}><option value="clinic">School clinic</option><option value="external">External clinic</option></select></label></div>{source === 'external' && <label>External clinic name<input value={clinicName} onChange={(event) => setClinicName(event.target.value)} maxLength={160} required disabled={saving}/></label>}<label>Next due date, if known<input type="date" value={nextDueDate} min={dateAdministered} onChange={(event) => setNextDueDate(event.target.value)} disabled={saving}/></label><p className="field-hint">Enter a next due date only when it is provided by the care plan or source record.</p><button className="primary-btn" onClick={save} disabled={saving || !data.students.length}><Syringe size={16}/>{saving ? 'Saving…' : 'Save vaccine dose'}</button>{error && <div className="error-banner" role="alert">{error}</div>}{saved && <p className="success-message" role="status">Immunization record saved to clinic records.</p>}</section>
      <div className="immunization-cards">
        <div>
          <span>Vaccine series tracked</span>
          <strong>{trackedRecords.length}</strong>
          <small>Latest record per student and vaccine</small>
        </div>
        <div>
          <span>Due this month</span>
          <strong className="amber-text">{dueThisMonth}</strong>
          <small>Based on recorded next due dates</small>
        </div>
        <div>
          <span>Overdue doses</span>
          <strong className="rose-text">{overdue}</strong>
          <small>Based on recorded next due dates</small>
        </div>
      </div>
      <section className="panel table-panel">
        <div className="panel-heading">
          <div>
            <p className="section-kicker">Vaccine tracker</p>
            <h3>Latest recorded dose by student and vaccine</h3>
          </div>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option>All due statuses</option>
            <option>Overdue</option>
            <option>Due this month</option>
            <option>No due date recorded</option>
          </select>
        </div>
        <table>
          <thead>
            <tr>
              <th>Student</th>
              <th>Grade</th>
              <th>Vaccine and dose</th>
              <th>Date administered</th>
              <th>Source</th>
              <th>Next due</th>
              <th>Due status</th>
            </tr>
          </thead>
          <tbody>
            {roster.map((record) => {
              const student = data.students.find((item) => String(item.id) === String(record.studentId || record.patientId));
              const status = dueStatus(record);
              return (
              <tr key={record.id}>
                <td>
                  <strong>{student?.name || 'Unknown student'}</strong>
                  <small>{student?.studentId || 'Student ID unavailable'}</small>
                </td>
                <td>{student?.gradeLevel || '—'}</td>
                <td>{record.vaccineName} · {record.doseNumber}</td>
                <td>{record.dateAdministered || '—'}</td>
                <td>{record.source === 'external' ? `External${record.clinicName ? ` · ${record.clinicName}` : ''}` : record.source === 'clinic' ? 'School clinic' : 'Not recorded'}</td>
                <td>{record?.nextDueDate || "Review needed"}</td>
                <td>
                  <span className={`status-chip ${status === 'Overdue' ? "warn" : status === 'Due this month' ? "neutral" : "success"}`}>
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
