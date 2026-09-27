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
  const [patientType, setPatientType] = useState('all');
  const patients = (data.students || []).filter((record) => {
    const type = record.patientType === 'faculty' ? 'faculty' : 'student';
    return (patientType === 'all' || patientType === type)
      && `${record.name} ${record.studentId || record.facultyId} ${record.gradeLevel || ''} ${record.section || ''} ${record.department || ''} ${record.position || ''}`.toLowerCase().includes(query.toLowerCase());
  }).sort((first, second) => sortAscending ? first.name.localeCompare(second.name) : second.name.localeCompare(first.name));
  const totalPatientRecords = (data.students || []).length;
  const latestVisits = new Map();
  data.visits.forEach((visit) => {
    const studentId = String(visit.studentId || visit.patientId || '');
    const current = latestVisits.get(studentId);
    if (!current || String(visit.date || visit.createdAt || '') > String(current.date || current.createdAt || '')) latestVisits.set(studentId, visit);
  });
  const exportStudents = () => {
    const studentRows = data.students.map((student) => ({
      "Record Type": student.patientType === 'faculty' ? 'Faculty' : 'Student',
      "Student ID": student.patientType === 'faculty' ? student.facultyId || student.studentId : student.studentId,
      "Full Name": student.name,
      "Grade Level": student.gradeLevel,
      Section: student.section,
      Adviser: student.adviser,
      Department: student.department,
      Position: student.position,
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
    downloadCsv(
      `healthmate-student-records-${new Date().toISOString().slice(0, 10)}.csv`,
      [...studentRows, ...visitRows],
    );
  };
  return (
    <div className="students-page">
      <div className="page-intro">
        <div>
          <p className="section-kicker">Clinic directory</p>
          <h2>
            Patients{" "}
            <span className="soft-count">{data.students.length} records</span>
          </h2>
          <p>Student and faculty clinic records in one place.</p>
        </div>
        <div className="intro-actions"><button type="button" className="secondary-btn" onClick={exportStudents}><Download size={16} /> Export CSV</button><button type="button" className="secondary-btn" onClick={() => navigate('/faculty/new')}><Plus size={17} /> Register faculty</button><button type="button" className="primary-btn" onClick={() => navigate('/students/new')}><Plus size={17} /> Register student</button></div>
      </div>
      <div className="patient-toolbar">
        <div className="search-box">
          <Search size={18} aria-hidden="true" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, ID, grade, section or department..."
            aria-label="Search patient records"
          />
        </div>
        <button type="button" className="filter-btn patient-sort" onClick={() => setSortAscending((value) => !value)} aria-label={`Sort names ${sortAscending ? 'descending' : 'ascending'}`}>
          <ArrowUpDown size={16} aria-hidden="true" /> Name {sortAscending ? 'A–Z' : 'Z–A'}
        </button>
        <label className="directory-filter">Record type<select value={patientType} onChange={(event) => setPatientType(event.target.value)}><option value="all">All patients</option><option value="student">Students</option><option value="faculty">Faculty</option></select></label>
      </div>
      <p className="field-hint" aria-live="polite">Showing {patients.length} of {totalPatientRecords} patient records.</p>
      <div className="student-grid">
        {patients.map((student, index) => (
          <Link
            to={`/students/${encodeURIComponent(student.id)}`}
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
              <span className="grade-badge">{student.patientType === 'faculty' ? 'Faculty' : student.gradeLevel || 'Student'}</span>
            </div>
            <h3>{student.name}</h3>
            <p className="student-id">
              {student.patientType === 'faculty' ? student.facultyId || student.studentId : student.studentId} <span>·</span> {student.patientType === 'faculty' ? student.department || student.position || 'Faculty' : student.section || 'Student'}
            </p>
            <div className="student-meta">
              <span>{student.patientType === 'faculty' ? 'Position' : 'Adviser'} <b>{student.patientType === 'faculty' ? student.position || 'Not recorded' : student.adviser || 'Not recorded'}</b></span>
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
      {!patients.length && (
        <div className="no-results" role="status">
          {totalPatientRecords === 0 ? (
            <><strong>No patient records yet.</strong><p>Register a student or faculty member to begin the clinic directory.</p><button type="button" className="primary-btn" onClick={() => navigate('/students/new')}><Plus size={16} /> Register student</button></>
          ) : (
            <><strong>No patient records match this view.</strong><p>Try another search term or record type.</p><button type="button" className="secondary-btn" onClick={() => { setQuery(''); setPatientType('all'); }}>Clear search and filters</button></>
          )}
        </div>
      )}
    </div>
  );
}
