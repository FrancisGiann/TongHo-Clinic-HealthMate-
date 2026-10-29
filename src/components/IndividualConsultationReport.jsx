import { Link, useLocation, useSearchParams } from 'react-router-dom';
import StudentPicker from './StudentPicker';
import { consultationSelection, changeConsultationStudent } from '../utils/consultationReport.js';

export default function IndividualConsultationReport({ data, user }) {
  const location = useLocation();
  const [search, setSearch] = useSearchParams();
  if (user?.role !== 'school_nurse') return null;
  const { students, student, visits, selected } = consultationSelection(data, user, search);
  const studentId = search.get('patientId') || '';
  const visitId = search.get('visitId') || '';
  const changeStudent = (id) => setSearch(changeConsultationStudent(search, id));
  const changeVisit = (id) => {
    const next = new URLSearchParams(search);
    if (id) next.set('visitId', id); else next.delete('visitId');
    setSearch(next);
  };
  return <section className="panel individual-consultation-report">
    <div className="panel-heading"><div><h2>Individual consultation</h2><p>Select a student and one clinic visit to view its printable summary.</p></div></div>
    <div className="individual-consultation-fields">
      <StudentPicker students={students} value={student?.id || ''} onChange={changeStudent} label="Student" searchPlaceholder="Search student by name or ID" description="Only student clinic records are available here." />
      <label>Consultation<select value={selected ? visitId : ''} onChange={(event) => changeVisit(event.target.value)} disabled={!student || !visits.length}><option value="">Choose a consultation</option>{visits.map((visit) => <option key={visit.id} value={visit.id}>{visit.date || 'Date unavailable'}{visit.time ? ` · ${visit.time}` : ''} — {visit.chiefComplaint || visit.type || 'Clinic visit'}</option>)}</select></label>
    </div>
    {!student ? <p className="empty-state">Choose a student to see their consultations.</p> : !visits.length ? <p className="empty-state">No consultations recorded for this student.</p> : !selected ? <p className="field-hint">Choose one consultation. Visits from other students cannot be opened here.</p> : <><p className="field-hint">Only this visit is included. Private notes and unrelated medical history are excluded.</p><Link className="primary-btn" to={`/students/${encodeURIComponent(studentId)}/visits/${encodeURIComponent(visitId)}/print?from=reports`} state={{ backgroundLocation: location }}>View / print consultation summary</Link></>}
  </section>;
}
