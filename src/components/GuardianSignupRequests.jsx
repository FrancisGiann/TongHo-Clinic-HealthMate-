import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../utils/api';
import StudentPicker from './StudentPicker';

const PAGE_SIZES = [10, 25, 50];

const normalizedStudentId = (value) => String(value || '').trim().toLocaleLowerCase();

export default function GuardianSignupRequests({ students = [] }) {
  const location = useLocation();
  const [filters, setFilters] = useState({ q: '', status: 'pending_review', order: 'newest', page: 1, limit: 25 });
  const [result, setResult] = useState({ requests: [], page: 1, pageCount: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [attestations, setAttestations] = useState({});
  const [studentSelections, setStudentSelections] = useState({});
  const [rejectingId, setRejectingId] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [message, setMessage] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({ status: filters.status, order: filters.order, page: String(filters.page), limit: String(filters.limit) });
    if (filters.q.trim()) params.set('q', filters.q.trim());
    setLoading(true);
    setError('');
    api.get(`/api/admin/guardian-signup-requests?${params}`).then((data) => {
      if (active) setResult({ requests: data.requests || [], page: data.page || 1, pageCount: data.pageCount || 1, total: data.total || 0 });
    }).catch((requestError) => {
      if (active) setError(requestError.message || 'Guardian requests could not be loaded.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [filters.status, filters.order, filters.page, filters.limit, filters.q, retry]);

  const updateFilter = (updates) => setFilters((current) => ({ ...current, ...updates, page: 1 }));
  const finish = async (requestId, action, body = {}) => {
    setBusyId(requestId);
    setError('');
    setMessage('');
    try {
      const response = action === 'retry-notification'
        ? await api.post(`/api/admin/guardian-signup-requests/${encodeURIComponent(requestId)}/retry-notification`, {})
        : await api.patch(`/api/admin/guardian-signup-requests/${encodeURIComponent(requestId)}/${action}`, body);
      const emailStatus = response.request?.decisionEmailStatus || response.decisionEmailStatus;
      setMessage(action === 'approve'
        ? `Request approved. Decision email ${emailStatus || 'queued'}.`
        : action === 'reject' ? `Request rejected. Decision email ${emailStatus || 'queued'}.` : `Notification ${emailStatus || 'queued'}.`);
      setAttestations((current) => ({ ...current, [requestId]: false }));
      setRejectingId('');
      setRejectionReason('');
      setFilters((current) => ({ ...current, page: 1 }));
      setRetry((count) => count + 1);
    } catch (requestError) {
      setError(requestError.message || 'The request could not be updated. Try again.');
    } finally {
      setBusyId('');
    }
  };

  const suggestedStudentFor = (request) => {
    const submittedId = normalizedStudentId(request.studentId);
    if (!submittedId) return null;
    const matches = students.filter((student) => student.patientType === 'student' && normalizedStudentId(student.studentId) === submittedId);
    return matches.length === 1 ? matches[0] : null;
  };
  const renderStudentSelection = (request) => {
    const selectedId = studentSelections[request.id] || '';
    const selectedStudent = students.find((student) => String(student.id) === String(selectedId) && student.patientType === 'student');
    const suggestion = suggestedStudentFor(request);
    return <>
      {suggestion && <p className="field-hint">Possible ID match: <strong>{suggestion.name}</strong> · {suggestion.studentId} · {suggestion.gradeLevel || 'Grade not recorded'}{suggestion.section ? ` · ${suggestion.section}` : ''} <button type="button" className="table-action" onClick={() => { setStudentSelections((current) => ({ ...current, [request.id]: String(suggestion.id) })); setAttestations((current) => ({ ...current, [request.id]: false })); }} disabled={Boolean(busyId)}>Select this record</button></p>}
      {!suggestion && <p className="field-hint">{request.studentId ? 'No unique ID match. Search the school roster by the child’s name and grade.' : 'No student ID was supplied. Search the school roster by the child’s name and grade.'}</p>}
      <StudentPicker
        students={students.filter((student) => student.patientType === 'student')}
        value={selectedId}
        onChange={(patientId) => { setStudentSelections((current) => ({ ...current, [request.id]: patientId })); setAttestations((current) => ({ ...current, [request.id]: false })); }}
        label="Choose school student record"
        itemLabel="student"
        searchPlaceholder="Search by student name or ID"
        description="The ID suggestion is not selected automatically. Choose a roster record after checking school records."
        required
        disabled={Boolean(busyId)}
      />
      {selectedStudent ? <div className="registration-selected-student"><strong>Chosen school record</strong><span>{selectedStudent.name} · {selectedStudent.studentId || 'Student ID unavailable'}</span><small>{selectedStudent.gradeLevel || 'Grade not recorded'}{selectedStudent.section ? ` · ${selectedStudent.section}` : ''}</small></div> : <p className="field-hint">Select a student record to enable approval.</p>}
      <Link className="secondary-btn registration-add-student-link" to="/students/new" state={{ returnTo: `${location.pathname}${location.search}` }}>Add verified student record</Link>
      <p className="field-hint">Staff must verify the official student ID, name, and grade before saving a roster record. Guardian claims never create student records.</p>
    </>;
  };

  const renderReviewActions = (request) => request.status === 'pending_review' ? <div className="registration-review-actions">
    {renderStudentSelection(request)}
    <label className="check-label"><input type="checkbox" checked={Boolean(attestations[request.id])} onChange={(event) => setAttestations((current) => ({ ...current, [request.id]: event.target.checked }))} disabled={Boolean(busyId)} /> I verified this relationship against school records.</label>
    <button type="button" className="primary-btn" onClick={() => finish(request.id, 'approve', { verifiedRelationship: true, patientId: studentSelections[request.id] })} disabled={Boolean(busyId) || !attestations[request.id] || !students.some((student) => student.patientType === 'student' && String(student.id) === String(studentSelections[request.id]))}>{busyId === request.id ? 'Saving…' : 'Approve'}</button>
    {rejectingId === request.id ? <form onSubmit={(event) => { event.preventDefault(); finish(request.id, 'reject', { reason: rejectionReason }); }}>
      <label>Reason for rejection<textarea value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)} minLength={1} maxLength={500} required disabled={Boolean(busyId)} /></label>
      <button type="submit" className="secondary-btn" disabled={Boolean(busyId) || !rejectionReason.trim()}>{busyId === request.id ? 'Saving…' : 'Confirm rejection'}</button>
      <button type="button" className="table-action" onClick={() => { setRejectingId(''); setRejectionReason(''); }} disabled={Boolean(busyId)}>Keep pending</button>
    </form> : <button type="button" className="table-action" onClick={() => setRejectingId(request.id)} disabled={Boolean(busyId)}>Reject</button>}
  </div> : request.decisionEmailStatus === 'failed' ? <button type="button" className="table-action" onClick={() => finish(request.id, 'retry-notification')} disabled={Boolean(busyId)}>{busyId === request.id ? 'Retrying…' : 'Retry decision email'}</button> : <span>—</span>;

  return (
    <section className="settings-subsection registration-review" aria-labelledby="guardian-signup-review-title">
      <div className="settings-panel-heading">
        <div><h4 id="guardian-signup-review-title">Guardian registration requests</h4><p>Review the submitted relationship against school records before approving an account.</p></div>
        <button type="button" className="secondary-btn" onClick={() => setRetry((count) => count + 1)} disabled={loading}><RotateCcw size={15} /> {loading ? 'Refreshing…' : 'Refresh'}</button>
      </div>
      <div className="registration-review-filters">
        <label>Search guardian requests<input type="search" maxLength={100} value={filters.q} placeholder="Name, email, username or student ID" onChange={(event) => updateFilter({ q: event.target.value })} /></label>
        <label>Status<select value={filters.status} onChange={(event) => updateFilter({ status: event.target.value })}><option value="pending_review">Awaiting review</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="all">All requests</option></select></label>
        <label>Order<select value={filters.order} onChange={(event) => updateFilter({ order: event.target.value })}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label>
        <label>Page size<select value={filters.limit} onChange={(event) => updateFilter({ limit: Number(event.target.value) })}>{PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}</select></label>
      </div>
      {message && <p className="success-message" role="status">{message}</p>}
      {error && <div className="error-banner" role="alert">{error} <button type="button" className="secondary-btn" onClick={() => setRetry((count) => count + 1)}>Retry</button></div>}
      {loading && <p className="field-hint" role="status">Loading guardian requests…</p>}
      {!loading && !error && !result.requests.length && <p className="empty-state">No guardian registration requests match these filters.</p>}
      {!error && result.requests.length > 0 && <>
        <div className="admin-table-wrap registration-request-table"><table className="admin-table" aria-label="Guardian registration requests">
          <thead><tr><th>Submitted</th><th>Applicant</th><th>Submitted child details</th><th>Status</th><th>Review</th></tr></thead>
        <tbody>{result.requests.map((request) => <tr key={request.id}>
          <td>{request.createdAt ? new Date(request.createdAt).toLocaleString() : 'Date unavailable'}</td>
          <td><strong>{request.name}</strong><small>{request.email} · @{request.username}</small></td>
          <td><strong>{request.childName || 'Child name not recorded'}</strong><small>{request.gradeLevel || 'Grade not recorded'}{request.section ? ` · ${request.section}` : ''}</small><small>Student ID claim: {request.studentId || 'Not supplied'}</small><small>Relationship: {request.relationship}</small>{request.linkedStudent ? <div className="registration-selected-student"><strong>Linked school record</strong><span>{request.linkedStudent.name} · {request.linkedStudent.studentId || 'Student ID unavailable'}</span><small>{request.linkedStudent.gradeLevel || 'Grade not recorded'}{request.linkedStudent.section ? ` · ${request.linkedStudent.section}` : ''}</small></div> : request.linkedStudentStatus === 'not_recorded' && <small>Linked school record not recorded for this earlier approval.</small>}</td>
          <td><span className={`status-chip ${request.status === 'approved' ? 'success' : request.status === 'rejected' ? 'critical' : 'warn'}`}>{request.status === 'pending_review' ? 'Awaiting review' : request.status}</span><small>Decision email: {request.decisionEmailStatus}</small>{request.status === 'rejected' && request.decisionReason && <small>Reason: {request.decisionReason}</small>}</td>
          <td>{renderReviewActions(request)}</td>
        </tr>)}</tbody>
        </table></div>
        <div className="registration-request-cards" role="list" aria-label="Guardian registration requests">
          {result.requests.map((request) => <article className="registration-request-card" role="listitem" aria-label={`${request.name} registration request`} key={request.id}>
            <div className="registration-request-field"><span>Submitted</span><strong>{request.createdAt ? new Date(request.createdAt).toLocaleString() : 'Date unavailable'}</strong></div>
            <div className="registration-request-field"><span>Applicant</span><div><strong>{request.name}</strong><small>{request.email} · @{request.username}</small></div></div>
            <div className="registration-request-field"><span>Submitted child</span><div><strong>{request.childName || 'Child name not recorded'}</strong><small>{request.gradeLevel || 'Grade not recorded'}{request.section ? ` · ${request.section}` : ''}</small><small>Student ID claim: {request.studentId || 'Not supplied'}</small><small>Relationship: {request.relationship}</small></div></div>
            {request.linkedStudent ? <div className="registration-request-field"><span>Linked record</span><div><strong>{request.linkedStudent.name}</strong><small>{request.linkedStudent.studentId || 'Student ID unavailable'} · {request.linkedStudent.gradeLevel || 'Grade not recorded'}{request.linkedStudent.section ? ` · ${request.linkedStudent.section}` : ''}</small></div></div> : request.linkedStudentStatus === 'not_recorded' && <div className="registration-request-field"><span>Linked record</span><small>Not recorded for this earlier approval.</small></div>}
            <div className="registration-request-field"><span>Status</span><div><span className={`status-chip ${request.status === 'approved' ? 'success' : request.status === 'rejected' ? 'critical' : 'warn'}`}>{request.status === 'pending_review' ? 'Awaiting review' : request.status}</span><small>Decision email: {request.decisionEmailStatus}</small>{request.status === 'rejected' && request.decisionReason && <small>Reason: {request.decisionReason}</small>}</div></div>
            <div className="registration-request-review"><strong>Review</strong>{renderReviewActions(request)}</div>
          </article>)}
        </div>
      </>}
      {result.total > 0 && <div className="list-pagination"><p>Page {result.page} of {result.pageCount} · {result.total} requests</p><div className="list-pagination-actions"><button type="button" className="secondary-btn" disabled={loading || result.page <= 1} onClick={() => setFilters((current) => ({ ...current, page: current.page - 1 }))}>Previous</button><button type="button" className="secondary-btn" disabled={loading || result.page >= result.pageCount} onClick={() => setFilters((current) => ({ ...current, page: current.page + 1 }))}>Next</button></div></div>}
    </section>
  );
}
