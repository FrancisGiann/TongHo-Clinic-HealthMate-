import ModalDialog from '../components/ModalDialog';
import StudentRegistration from './StudentRegistration';
import FacultyRegistration from './FacultyRegistration';
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Download,
  Plus,
  Search,
  ShieldAlert,
} from "lucide-react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { downloadCsv } from "../utils/csv";
import { readListState, updateListParams } from "../utils/listState.js";
import ListPagination from "../components/ListPagination.jsx";
import { api } from "../utils/api";

export default function Students({ directory: directoryInput, directoryReady = true, reload, loading = false, registrationType: routeRegistrationType }) {
  const directory = directoryInput || {};
  const navigate = useNavigate();
  const location = useLocation();
  const [registrationBusy, setRegistrationBusy] = useState(false);
  const [registrationMessage, setRegistrationMessage] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const openRegistration = (kind) => {
    setRegistrationMessage('');
    const params = new URLSearchParams(location.search); params.set('register', kind);
    navigate({ pathname: '/students', search: `?${params}` }, { state: { registrationOrigin: `${location.pathname}${location.search}` } });
  };
  const closeRegistration = () => {
    if (location.state?.registrationOrigin && /^\/students(?:\?.*)?$/.test(location.state.registrationOrigin)) navigate(-1);
    else { const params = new URLSearchParams(location.search); params.delete('register'); navigate({ pathname: '/students', search: params.toString() ? `?${params}` : '' }, { replace: true }); }
  };
  const registrationSaved = () => { setRegistrationMessage(`${registrationType === 'faculty' ? 'Faculty' : 'Student'} record saved.`); closeRegistration(); };
  const [searchParams, setSearchParams] = useSearchParams();
  const registrationType = routeRegistrationType || (['student', 'faculty'].includes(searchParams.get('register')) ? searchParams.get('register') : null);
  const list = readListState(searchParams, { sort: 'name', order: 'asc', pageSize: 25 });
  const [searchDraft, setSearchDraft] = useState(list.q);
  const searchParamsRef = useRef(searchParams);
  const lastLocalSearchRef = useRef(null);
  searchParamsRef.current = searchParams;
  const patientType = ['student', 'faculty'].includes(searchParams.get('filter')) ? searchParams.get('filter') : 'all';
  const grade = searchParams.get('grade') || '';
  const section = searchParams.get('section') || '';
  const gradeFiltersEnabled = patientType !== 'faculty';
  const patients = directory.patients || [];
  const latestVisits = new Map(patients.filter((patient) => patient.latestVisit).map((patient) => [String(patient.id), patient.latestVisit]));
  const pageResult = {
    page: Number(directory.page) || list.page,
    pageSize: Number(directory.pageSize) || list.pageSize,
    pageCount: Number(directory.pageCount) || 1,
    total: Number(directory.total) || 0,
  };
  const commitSearch = useCallback((value) => {
    if ((searchParamsRef.current.get('q') || '') === value) return;
    lastLocalSearchRef.current = value;
    updateListParams(searchParamsRef.current, setSearchParams, { q: value }, { resetPage: true, replace: true });
  }, [setSearchParams]);
  const setListValue = useCallback((key, value, resetPage = true) => {
    const updates = { [key]: value };
    if (searchDraft !== list.q && key !== 'q') {
      updates.q = searchDraft;
      lastLocalSearchRef.current = searchDraft;
    }
    updateListParams(searchParamsRef.current, setSearchParams, updates, { resetPage, replace: key === 'q' });
  }, [list.q, searchDraft, setSearchParams]);
  useEffect(() => {
    if (list.q === lastLocalSearchRef.current) {
      lastLocalSearchRef.current = null;
      return;
    }
    setSearchDraft(list.q);
  }, [list.q]);
  useEffect(() => {
    if (searchDraft === list.q) return undefined;
    const timer = window.setTimeout(() => commitSearch(searchDraft), 180);
    return () => window.clearTimeout(timer);
  }, [commitSearch, list.q, searchDraft]);
  useEffect(() => {
    if (!directoryReady || loading) return;
    if (list.page !== pageResult.page) setListValue('page', pageResult.page === 1 ? null : pageResult.page, false);
  }, [directoryReady, loading, list.page, pageResult.page, setListValue]);
  const totalPatientRecords = Number(directory.rosterTotal) || 0;
  const grades = directory.grades || [];
  const sections = directory.sections || [];
  const exportStudents = async () => {
    if (exporting) return;
    setExporting(true);
    setExportError('');
    try {
      const exported = await api.get('/api/patients/export');
      const studentRows = (exported.students || []).map((student) => ({
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
      const visitRows = (exported.visits || []).map((visit) => ({
      "Record Type": "Visit",
      "Student ID": visit.studentId || visit.patientId,
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
    } catch (error) {
      setExportError(error.message || 'The patient CSV could not be exported.');
    } finally { setExporting(false); }
  };
  return (
    <div className="students-page">
      <div className="page-intro">
        <div>
          <p className="section-kicker">Clinic directory</p>
          <h2>
            Patients{" "}
            <span className="soft-count">{totalPatientRecords} records</span>
          </h2>
          <p>Student and faculty clinic records in one place.</p>
        </div>
        <div className="intro-actions"><button type="button" className="secondary-btn" onClick={exportStudents} disabled={exporting}><Download size={16} /> {exporting ? 'Preparing CSV…' : 'Export CSV'}</button><button type="button" className="secondary-btn" onClick={() => openRegistration('faculty')}><Plus size={17} /> Register faculty</button><button type="button" className="primary-btn" onClick={() => openRegistration('student')}><Plus size={17} /> Register student</button></div>
      </div>
      {registrationMessage && <p className="success-message" role="status">{registrationMessage}</p>}
      {exportError && <p className="error-banner" role="alert">{exportError}</p>}
      <div className="patient-search-toolbar">
        <div className="search-box">
          <Search size={18} aria-hidden="true" />
          <input
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') commitSearch(searchDraft); }}
            placeholder="Search by name, ID, grade, section or department..."
            aria-label="Search patient records"
          />
        </div>
        <label className="directory-filter">Record type<select value={patientType} onChange={(event) => updateListParams(searchParams, setSearchParams, { filter: event.target.value === 'all' ? null : event.target.value, ...(event.target.value === 'faculty' ? { grade: null, section: null } : {}) }, { resetPage: true })}><option value="all">All patients</option><option value="student">Students</option><option value="faculty">Faculty</option></select></label>
      </div>
      <details className="patient-extra-filters">
        <summary>Filters and sort <span>{[gradeFiltersEnabled && grade, gradeFiltersEnabled && section, list.sort !== 'name', list.order !== 'asc'].filter(Boolean).length || 'Default'}</span></summary>
        <div className="patient-filter-options">
        <label className="directory-filter">Sort by<select value={list.sort} onChange={(event) => setListValue('sort', event.target.value)}><option value="name">Name</option><option value="grade">Grade</option><option value="latestVisit">Latest visit</option></select></label>
        <label className="directory-filter">Order<select value={list.order} onChange={(event) => setListValue('order', event.target.value)}><option value="asc">Ascending</option><option value="desc">Descending</option></select></label>
        {gradeFiltersEnabled && <>
        <label className="directory-filter">Grade<select value={gradeFiltersEnabled ? grade : ''} disabled={!gradeFiltersEnabled} onChange={(event) => updateListParams(searchParams, setSearchParams, { grade: event.target.value, section: null }, { resetPage: true })}><option value="">All grades</option>{grades.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="directory-filter">Section<select value={gradeFiltersEnabled ? section : ''} disabled={!gradeFiltersEnabled} onChange={(event) => setListValue('section', event.target.value)}><option value="">All sections</option>{sections.map((value) => <option key={value}>{value}</option>)}</select></label>
        </>}
        </div>
        <button type="button" className="table-action" onClick={() => updateListParams(searchParams, setSearchParams, { grade: null, section: null, sort: null, order: null }, { resetPage: true })}>Reset filters and sort</button>
      </details>
      <p className="field-hint" aria-live="polite">Showing {pageResult.total} of {totalPatientRecords} patient records.</p>
      {loading && <p className="field-hint" role="status">Updating patient directory…</p>}
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
      <ListPagination page={pageResult.page} pageCount={pageResult.pageCount} pageSize={pageResult.pageSize} total={pageResult.total}
        onPageChange={(page) => setListValue('page', page === 1 ? null : page, false)} onPageSizeChange={(pageSize) => updateListParams(searchParams, setSearchParams, { pageSize, page: null }, { resetPage: true })} />
      {directoryReady && !loading && !patients.length && (
        <div className="no-results" role="status">
          {totalPatientRecords === 0 ? (
            <><strong>No patient records yet.</strong><p>Register a student or faculty member to begin the clinic directory.</p><button type="button" className="primary-btn" onClick={() => openRegistration('student')}><Plus size={16} /> Register student</button></>
          ) : (
            <><strong>No patient records match this view.</strong><p>Try another search term or record type.</p><button type="button" className="secondary-btn" onClick={() => updateListParams(searchParams, setSearchParams, { q: null, filter: null, grade: null, section: null }, { resetPage: true })}>Clear search and filters</button></>
          )}
        </div>
      )}
      {registrationType && <ModalDialog open title={registrationType === 'faculty' ? 'Register faculty' : 'Register student'} eyebrow="Clinic directory" onClose={closeRegistration} busy={registrationBusy} className="admin-context-dialog patient-registration-dialog">
        {registrationType === 'faculty' ? <FacultyRegistration schemaVersion={directory.schemaVersion} reload={reload} embedded onClose={closeRegistration} onSaved={registrationSaved} onBusyChange={setRegistrationBusy} /> : <StudentRegistration schemaVersion={directory.schemaVersion} reload={reload} embedded onClose={closeRegistration} onSaved={registrationSaved} onBusyChange={setRegistrationBusy} />}
      </ModalDialog>}
    </div>
  );
}
