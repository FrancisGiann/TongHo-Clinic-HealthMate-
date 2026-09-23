import { useState } from "react";
import {
  ArrowUpDown,
  Download,
  Plus,
  Search,
  ShieldAlert,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { downloadCsv } from "../utils/csv";

export default function Students({ data, setData }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [sortAscending, setSortAscending] = useState(true);
  const students = data.students.filter((student) =>
    `${student.name} ${student.studentId} ${student.gradeLevel} ${student.section}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  ).sort((first, second) => sortAscending ? first.name.localeCompare(second.name) : second.name.localeCompare(first.name));
  const latestVisits = new Map();
  data.visits.forEach((visit) => {
    const studentId = String(visit.studentId || visit.patientId || '');
    const current = latestVisits.get(studentId);
    if (!current || String(visit.date || visit.createdAt || '') > String(current.date || current.createdAt || '')) latestVisits.set(studentId, visit);
  });
  const exportStudents = () => {
    const studentRows = data.students.map((student) => ({
      "Record Type": "Student",
      "Student ID": student.studentId,
      "Full Name": student.name,
      "Grade Level": student.gradeLevel,
      Section: student.section,
      Adviser: student.adviser,
      "Birth Date": student.birthDate,
      Gender: student.gender,
      "Guardian Name": student.guardianName,
      "Guardian Phone": student.guardianPhone,
      "Guardian Relation": student.guardianRelation || "Parent",
      Allergies: student.allergies || "None recorded",
      Conditions: student.conditions || "None recorded",
      Medications: student.medications || "None recorded",
      "Blood Type": student.bloodType || "Not recorded",
    }));
    const visitRows = data.visits.map((visit) => ({
      "Record Type": "Visit",
      "Student ID": data.students.find((student) => student.id === visit.studentId)?.studentId || visit.studentId,
      Time: visit.time,
      Type: visit.type,
      Complaint: visit.chiefComplaint,
      Treatment: visit.treatment,
      Disposition: visit.disposition,
      "Follow-up": visit.followUp ? "Yes" : "No",
      Nurse: visit.nurseName,
    }));
    const screeningRows = (data.screenings || []).map((record) => ({
      "Record Type": "Screening",
      "Student ID": data.students.find((student) => student.id === record.studentId)?.studentId || record.studentId,
      "School Year": record.schoolYear,
      Date: record.date,
      Vision: record.vision,
      Hearing: record.hearing,
      BMI: record.bmi,
      "Nutritional Status": record.nutritionalStatus,
    }));
    const immunizationRows = (data.immunizations || []).map((record) => ({
      "Record Type": "Immunization",
      "Student ID": data.students.find((student) => student.id === record.studentId)?.studentId || record.studentId,
      Vaccine: record.vaccineName,
      Dose: record.doseNumber,
      "Date Administered": record.dateAdministered,
      "Next Due Date": record.nextDueDate,
      Remarks: record.remarks,
    }));
    const incidentRows = (data.incidents || []).map((record) => ({
      "Record Type": "Incident",
      "Student ID": data.students.find((student) => student.id === record.studentId)?.studentId || record.studentId,
      Date: record.date,
      Location: record.location,
      Type: record.type,
      Severity: record.severity,
      Description: record.description,
      "Action Taken": record.actionTaken,
      "Parent Notified": record.parentNotified ? "Yes" : "No",
    }));
    downloadCsv(
      `healthmate-student-records-${new Date().toISOString().slice(0, 10)}.csv`,
      [...studentRows, ...visitRows, ...screeningRows, ...immunizationRows, ...incidentRows],
    );
  };
  return (
    <div className="students-page">
      <div className="page-intro">
        <div>
          <p className="section-kicker">Student directory</p>
          <h2>
            Students{" "}
            <span className="soft-count">{data.students.length} active</span>
          </h2>
          <p>Every student record, thoughtfully kept in one place.</p>
        </div>
        <div className="intro-actions"><button className="secondary-btn" onClick={exportStudents}><Download size={16} /> Export CSV</button><button className="primary-btn" onClick={() => navigate('/students/new')}><Plus size={17} /> Register student</button></div>
      </div>
      <div className="toolbar">
        <div className="search-box">
          <Search size={18} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, ID, grade or section..."
          />
        </div>
        <button type="button" className="filter-btn" onClick={() => setSortAscending((value) => !value)} aria-label={`Sort names ${sortAscending ? 'descending' : 'ascending'}`}>
          <ArrowUpDown size={16} /> Sort: Name {sortAscending ? 'A–Z' : 'Z–A'}
        </button>
      </div>
      <div className="student-grid">
        {students.map((student, index) => (
          <Link
            to={`/students/${student.id}`}
            className="student-card"
            key={student.id}
          >
            <div className="student-card-top">
              <div
                className={`avatar ${["coral", "teal", "amber", "violet", "blue"][index]}`}
              >
                {student.name
                  .split(" ")
                  .map((part) => part[0])
                  .join("")
                  .slice(0, 2)}
              </div>
              <span className="grade-badge">{student.gradeLevel}</span>
            </div>
            <h3>{student.name}</h3>
            <p className="student-id">
              {student.studentId} <span>·</span> {student.section}
            </p>
            <div className="student-meta">
              <span>
                Adviser <b>{student.adviser}</b>
              </span>
              {student.allergies && (
                <span className="allergy">
                  <ShieldAlert size={13} /> {student.allergies}
                </span>
              )}
            </div>
            <div className="card-footer">
              <span>
                Last visit <b>{latestVisits.has(String(student.id)) ? `${latestVisits.get(String(student.id)).date || 'Date unavailable'}${latestVisits.get(String(student.id)).time ? `, ${latestVisits.get(String(student.id)).time}` : ''}` : 'No visits recorded'}</b>
              </span>
              <span className="card-arrow">↗</span>
            </div>
          </Link>
        ))}
      </div>
      {!students.length && (
        <div className="no-results">No students match “{query}”.</div>
      )}
    </div>
  );
}
