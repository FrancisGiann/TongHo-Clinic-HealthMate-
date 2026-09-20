import { useState } from "react";
import {
  ArrowUpDown,
  Download,
  Plus,
  Search,
  ShieldAlert,
  SlidersHorizontal,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";

export default function Students({ data, setData }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [sortAscending, setSortAscending] = useState(true);
  const students = data.students.filter((student) =>
    `${student.name} ${student.studentId} ${student.gradeLevel} ${student.section}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  ).sort((first, second) => sortAscending ? first.name.localeCompare(second.name) : second.name.localeCompare(first.name));
  const exportStudents = () => {
    const workbook = XLSX.utils.book_new();
    const studentRows = data.students.map((student) => ({
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
    const addSheet = (name, rows, headers) => {
      const sheet = XLSX.utils.json_to_sheet(rows, { header: headers });
      sheet["!cols"] = headers.map((header) => ({
        wch: Math.min(34, Math.max(14, Math.max(header.length, ...rows.map((row) => String(row[header] ?? "").length)) + 2)),
      }));
      sheet["!rows"] = [{ hpt: 24 }];
      sheet["!freeze"] = { xSplit: 0, ySplit: 1 };
      sheet["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: headers.length - 1 } }) };
      XLSX.utils.book_append_sheet(workbook, sheet, name);
    };
    addSheet("Students", studentRows, Object.keys(studentRows[0] || { "Student ID": "" }));
    addSheet("Visits", data.visits.map((visit) => ({
      "Student ID": data.students.find((student) => student.id === visit.studentId)?.studentId || visit.studentId,
      Time: visit.time,
      Type: visit.type,
      Complaint: visit.chiefComplaint,
      Treatment: visit.treatment,
      Disposition: visit.disposition,
      "Follow-up": visit.followUp ? "Yes" : "No",
      Nurse: visit.nurseName,
    })), ["Student ID", "Time", "Type", "Complaint", "Treatment", "Disposition", "Follow-up", "Nurse"]);
    addSheet("Screenings", (data.screenings || []).map((record) => ({
      "Student ID": data.students.find((student) => student.id === record.studentId)?.studentId || record.studentId,
      "School Year": record.schoolYear,
      Date: record.date,
      Vision: record.vision,
      Hearing: record.hearing,
      BMI: record.bmi,
      "Nutritional Status": record.nutritionalStatus,
    })), ["Student ID", "School Year", "Date", "Vision", "Hearing", "BMI", "Nutritional Status"]);
    addSheet("Immunizations", (data.immunizations || []).map((record) => ({
      "Student ID": data.students.find((student) => student.id === record.studentId)?.studentId || record.studentId,
      Vaccine: record.vaccineName,
      Dose: record.doseNumber,
      "Date Administered": record.dateAdministered,
      "Next Due Date": record.nextDueDate,
      Remarks: record.remarks,
    })), ["Student ID", "Vaccine", "Dose", "Date Administered", "Next Due Date", "Remarks"]);
    addSheet("Incidents", (data.incidents || []).map((record) => ({
      "Student ID": data.students.find((student) => student.id === record.studentId)?.studentId || record.studentId,
      Date: record.date,
      Location: record.location,
      Type: record.type,
      Severity: record.severity,
      Description: record.description,
      "Action Taken": record.actionTaken,
      "Parent Notified": record.parentNotified ? "Yes" : "No",
    })), ["Student ID", "Date", "Location", "Type", "Severity", "Description", "Action Taken", "Parent Notified"]);
    XLSX.writeFile(workbook, `healthmate-student-backup-${new Date().toISOString().slice(0, 10)}.xlsx`, { compression: true });
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
        <div className="intro-actions"><button className="secondary-btn" onClick={exportStudents}><Download size={16} /> Export students</button><button className="primary-btn" onClick={() => navigate('/students/new')}><Plus size={17} /> Register student</button></div>
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
        <button className="filter-btn" onClick={() => setQuery("")}>
          <SlidersHorizontal size={16} /> Filters <span>0</span>
        </button>
        <button className="filter-btn" onClick={() => setSortAscending((value) => !value)}>
          <ArrowUpDown size={16} /> Sort: Name
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
                Last visit <b>Today, {index === 0 ? "08:42" : "—"}</b>
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
