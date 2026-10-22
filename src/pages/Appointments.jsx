import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarPlus } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../utils/api';
import { formatManilaDateTime, manilaCalendarDate } from '../utils/dateTime';
import { compareValues, manilaDateTimeKey, readListState, sortAndPaginate, updateListParams } from '../utils/listState.js';
import ListPagination from '../components/ListPagination.jsx';
import StudentPicker from '../components/StudentPicker';
import ModalDialog from '../components/ModalDialog';
import AppointmentAvailability from '../components/AppointmentAvailability.jsx';

function manilaDateTimeNow() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date()).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export default function Appointments({ data, user, reload }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const list = readListState(searchParams, { sort: 'createdAt', order: 'desc', pageSize: 25 });
  const statusFilter = searchParams.get('status') || '';
  const startDate = searchParams.get('startDate') || '';
  const endDate = searchParams.get('endDate') || '';
  const [patientId, setPatientId] = useState('');
  const [slotDate, setSlotDate] = useState('');
  const [showScheduleDialog, setShowScheduleDialog] = useState(false);
  const [startsAt, setStartsAt] = useState('');
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [slots, setSlots] = useState([]);
  const [traffic, setTraffic] = useState(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotError, setSlotError] = useState('');
  const [reschedule, setReschedule] = useState({});
  const [rescheduleAppointment, setRescheduleAppointment] = useState(null);
  const [rescheduleError, setRescheduleError] = useState('');
  const [updatingAppointment, setUpdatingAppointment] = useState(null);
  const [scheduleMessage, setScheduleMessage] = useState('');
  const [scheduleError, setScheduleError] = useState('');
  const [decisionTarget, setDecisionTarget] = useState(null);
  const [decisionReason, setDecisionReason] = useState('');
  const updateLock = useRef(false);
  const patientIds = useMemo(() => new Set((data.students || []).map((patient) => String(patient.id))), [data.students]);
  const isStaff = user.role === 'school_nurse';
  const allAppointments = (data.appointments || []).filter((appointment) => patientIds.has(String(appointment.studentId || appointment.patientId)));
  const appointmentPatient = (appointment) => (data.students || []).find((person) => String(person.id) === String(appointment.studentId || appointment.patientId));
  const appointmentDay = (appointment) => {
    if (appointment.startsAt) return manilaCalendarDate(appointment.startsAt);
    return /^\d{4}-\d{2}-\d{2}$/.test(String(appointment.date || '')) ? String(appointment.date) : manilaCalendarDate(appointment.date);
  };
  const matchingAppointments = isStaff ? allAppointments.filter((appointment) => {
    const patient = appointmentPatient(appointment);
    const status = appointment.status === 'Pending' ? 'Requested' : appointment.status;
    const term = list.q.trim().toLowerCase();
    const matchesSearch = !term || `${patient?.name || ''} ${patient?.studentId || patient?.facultyId || ''}`.toLowerCase().includes(term);
    const day = appointmentDay(appointment);
    return matchesSearch
      && (!statusFilter || status === statusFilter)
      && (!startDate || (day && day >= startDate))
      && (!endDate || (day && day <= endDate));
  }) : allAppointments;
  const pageResult = sortAndPaginate(matchingAppointments, (first, second, order) => {
    if (list.sort === 'appointmentTime') {
      return compareValues(manilaDateTimeKey(first.startsAt || first.date || '', first.time || ''), manilaDateTimeKey(second.startsAt || second.date || '', second.time || ''), order);
    }
    return compareValues(first.createdAt ? Date.parse(first.createdAt) : null, second.createdAt ? Date.parse(second.createdAt) : null, order);
  }, isStaff ? list : { ...list, page: 1, pageSize: Math.max(25, matchingAppointments.length || 25) });
  const appointments = isStaff ? pageResult.items : matchingAppointments;
  const setListValue = (key, value, resetPage = true) => updateListParams(searchParams, setSearchParams, { [key]: value }, { resetPage });
  useEffect(() => {
    if (isStaff && list.page !== pageResult.page) setListValue('page', pageResult.page === 1 ? null : pageResult.page, false);
  }, [isStaff, list.page, pageResult.page]);
  const clinicToday = manilaDateTimeNow().slice(0, 10);

  useEffect(() => {
    if (!slotDate) {
      setSlots([]);
      setTraffic(null);
      setSlotsLoading(false);
      return undefined;
    }
    let active = true;
    setSlotsLoading(true);
    setSlotError('');
    api.get(`/api/appointments/slots?date=${encodeURIComponent(slotDate)}`).then((result) => {
      if (!active) return;
      setSlots(result.slots || []);
      setTraffic(result.traffic || null);
      setSlotError('');
    }).catch((requestError) => {
      if (!active) return;
      setSlots([]);
      setTraffic(null);
      setSlotError(requestError.message);
    }).finally(() => {
      if (active) setSlotsLoading(false);
    });
    return () => { active = false; };
  }, [slotDate]);

  const submit = async (event) => {
    event.preventDefault();
    if (saving) return;
    setError('');
    setMessage('');
    setScheduleError('');
    setScheduleMessage('');
    if (!patientId) return setError('Choose the patient this appointment is for.');
    setSaving(true);
    try {
      await api.post('/api/appointments', { patientId, startsAt, reason });
      setMessage(isStaff ? 'Appointment scheduled for the selected patient.' : 'Appointment request submitted for the selected patient.');
      setPatientId('');
      setStartsAt('');
      setSlotDate('');
      setReason('');
      await reload();
      if (isStaff) updateListParams(searchParams, setSearchParams, {
        q: null, status: null, startDate: null, endDate: null,
        sort: 'createdAt', order: 'desc', page: null,
      });
      if (isStaff) setShowScheduleDialog(false);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  };
  const updateStatus = async (appointment, status, reasonText = '') => {
    if (updateLock.current) return;
    updateLock.current = true;
    setUpdatingAppointment({ id: String(appointment.id), action: status === 'Scheduled' ? 'Confirming…' : status === 'Completed' ? 'Completing…' : status === 'Rejected' ? 'Rejecting…' : 'Cancelling…' });
    setError('');
    setMessage('');
    setScheduleError('');
    setScheduleMessage('');
    try {
      await api.patch(`/api/appointments/${encodeURIComponent(appointment.id)}`, { status, ...(reasonText ? { decisionReason: reasonText } : {}) });
      setScheduleMessage(`Appointment marked ${status.toLowerCase()}.`);
      setDecisionTarget(null);
      setDecisionReason('');
      await reload();
    } catch (requestError) {
      setScheduleError(requestError.message);
    } finally {
      updateLock.current = false;
      setUpdatingAppointment(null);
    }
  };
  const updateTime = async (appointment) => {
    const nextStartsAt = reschedule[appointment.id];
    if (!nextStartsAt) return setRescheduleError('Choose a new date and time before rescheduling.');
    if (updateLock.current) return;
    updateLock.current = true;
    setUpdatingAppointment({ id: String(appointment.id), action: 'Rescheduling…' });
    setScheduleError('');
    setScheduleMessage('');
    setRescheduleError('');
    try {
      await api.patch(`/api/appointments/${encodeURIComponent(appointment.id)}`, { status: appointment.status, startsAt: nextStartsAt });
      setScheduleMessage('Appointment rescheduled.');
      await reload();
      setRescheduleAppointment(null);
    } catch (requestError) {
      setRescheduleError(requestError.message);
    } finally {
      updateLock.current = false;
      setUpdatingAppointment(null);
    }
  };
  const actionsFor = (status) => {
    if (status === 'Requested' || status === 'Pending') return ['Confirm', 'Reject', 'Cancel'];
    if (status === 'Scheduled') return ['Complete', 'Cancel'];
    return [];
  };

  const scheduleForm = (
    <form className={`panel form-panel appointment-form${isStaff ? ' appointment-dialog-form' : ''}`} onSubmit={submit}>
      <div className="two-fields">
        <StudentPicker students={data.students || []} value={patientId} onChange={setPatientId} label={isStaff ? 'Schedule for patient' : 'Student'} required disabled={saving}/>
        <label>Appointment date<input type="date" min={clinicToday} value={slotDate} onChange={(event) => { setSlotDate(event.target.value); setStartsAt(''); setSlots([]); setTraffic(null); setSlotError(''); }} required disabled={saving}/></label>
      </div>
      {slotDate && <>
        <label>Available time{traffic?.historyAvailable ? ' (suggestions first)' : ''}
          <select value={startsAt} onChange={(event) => setStartsAt(event.target.value)} disabled={saving || slotsLoading || !slots.length} required>
            <option value="">Choose a clinic time</option>
            {slots.map((slot) => <option key={slot.local} value={slot.local}>{slot.suggestionRank && slot.suggestionRank <= 3 ? `Suggested ${slot.suggestionRank} · ` : ''}{slot.local.slice(11)}</option>)}
          </select>
        </label>
        <div className="slot-guidance" aria-live="polite">
          {slotsLoading && <span className="field-hint">Checking availability…</span>}
          {!slotsLoading && slotError && <span className="error-banner" role="alert">{slotError}</span>}
          {!slotsLoading && !slotError && !slots.length && <span className="field-hint">No available clinic times on this date.</span>}
          {!slotsLoading && !slotError && slots.length > 0 && (traffic?.historyAvailable
            ? <span className="field-hint">Lower-traffic suggestions use same-weekday visit history from the past {traffic.lookbackDays} days. Availability can change before you submit.</span>
            : <span className="field-hint">There is not enough recent same-weekday history to rank times, so available slots are listed in clinic order.</span>)}
        </div>
      </>}
      <label>Reason<textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} required disabled={saving}/></label>
      {error && <div className="error-banner" role="alert">{error}</div>}
      <div className="appointment-form-actions">
        {isStaff && <button type="button" className="secondary-btn" onClick={() => setShowScheduleDialog(false)} disabled={saving}>Cancel</button>}
        <button className="primary-btn" disabled={saving || !data.students?.length || !patientId || !slotDate || !startsAt}><CalendarPlus size={16} /> {saving ? 'Saving…' : isStaff ? 'Schedule appointment' : 'Request appointment'}</button>
      </div>
      {!isStaff && message && <p className="success-message" role="status">{message}</p>}
    </form>
  );

  return (
    <div className="form-page">
      <div className="page-intro"><div><h2>{isStaff ? 'Appointments' : 'Clinic scheduling'}</h2><p>{isStaff ? 'Schedule student and faculty appointments, then manage their status.' : 'Request an appointment for a student linked to your account.'}</p></div>{isStaff && <button type="button" className="primary-btn" onClick={() => { setError(''); setMessage(''); setShowScheduleDialog(true); }}><CalendarPlus size={16} /> Schedule appointment</button>}</div>
      {isStaff ? <ModalDialog open={showScheduleDialog} title="Schedule appointment" eyebrow="Clinic scheduling" onClose={() => setShowScheduleDialog(false)} busy={saving}>{scheduleForm}</ModalDialog> : scheduleForm}
      <ModalDialog open={Boolean(decisionTarget)} title={`${decisionTarget?.status === 'Rejected' ? 'Reject' : 'Cancel'} appointment`} onClose={() => setDecisionTarget(null)} busy={updatingAppointment !== null}>
        {decisionTarget && <form onSubmit={(event) => { event.preventDefault(); updateStatus(decisionTarget.appointment, decisionTarget.status, decisionReason); }}>
          <p className="field-hint">This reason will be included in the update shared with the linked guardian.</p>
          <label>Decision reason<textarea value={decisionReason} onChange={(event) => setDecisionReason(event.target.value)} minLength={1} maxLength={500} required disabled={updatingAppointment !== null} /></label>
          {scheduleError && <div className="error-banner" role="alert">{scheduleError}</div>}
          <div className="appointment-form-actions"><button type="button" className="secondary-btn" onClick={() => setDecisionTarget(null)} disabled={updatingAppointment !== null}>Keep appointment</button><button type="submit" className="primary-btn" disabled={updatingAppointment !== null || !decisionReason.trim()}>{updatingAppointment?.action || (decisionTarget.status === 'Rejected' ? 'Reject appointment' : 'Cancel appointment')}</button></div>
        </form>}
      </ModalDialog>
      <ModalDialog open={Boolean(rescheduleAppointment)} title="Reschedule appointment" eyebrow="Clinic scheduling" onClose={() => setRescheduleAppointment(null)} busy={updatingAppointment !== null} className="appointment-reschedule-dialog">
        {rescheduleAppointment && <form onSubmit={(event) => { event.preventDefault(); updateTime(rescheduleAppointment); }}>
          <p className="field-hint">{rescheduleAppointment.patient?.name || data.students.find((person) => String(person.id) === String(rescheduleAppointment.studentId || rescheduleAppointment.patientId))?.name || 'Patient'} · Current time: {formatManilaDateTime(rescheduleAppointment.startsAt || rescheduleAppointment.date, rescheduleAppointment.time)}</p>
          <label>New date and time<input autoFocus type="datetime-local" min={manilaDateTimeNow()} value={reschedule[rescheduleAppointment.id] || ''} onChange={(event) => setReschedule((current) => ({ ...current, [rescheduleAppointment.id]: event.target.value }))} required disabled={updatingAppointment !== null} /></label>
          {rescheduleError && <div className="error-banner" role="alert">{rescheduleError}</div>}
          <div className="appointment-form-actions">
            <button type="button" className="secondary-btn" onClick={() => setRescheduleAppointment(null)} disabled={updatingAppointment !== null}>Cancel</button>
            <button type="submit" className="primary-btn" disabled={updatingAppointment !== null}>{updatingAppointment?.action === 'Rescheduling…' ? 'Rescheduling…' : 'Save new time'}</button>
          </div>
        </form>}
      </ModalDialog>
      {isStaff && message && <p className="success-message" role="status">{message}</p>}
      <section className="panel table-panel appointments-list">
        <div className="panel-heading"><div><p className="section-kicker">Schedule</p><h3>{isStaff ? 'Patient appointments and requests' : 'Your appointment requests'}</h3></div></div>
        {isStaff && <div className="patient-toolbar appointment-toolbar">
          <label className="directory-filter appointment-search-filter">Search<span className="search-box appointment-search-control"><input value={list.q} onChange={(event) => setListValue('q', event.target.value)} placeholder="Patient name or ID" aria-label="Search patient name or ID" /></span></label>
          <label className="directory-filter">Status<select value={statusFilter} onChange={(event) => setListValue('status', event.target.value)}><option value="">All statuses</option>{['Requested', 'Scheduled', 'Completed', 'Cancelled', 'Rejected'].map((status) => <option key={status}>{status}</option>)}</select></label>
          <label className="directory-filter">From<input type="date" value={startDate} max={endDate || undefined} onChange={(event) => setListValue('startDate', event.target.value)} /></label>
          <label className="directory-filter">To<input type="date" value={endDate} min={startDate || undefined} onChange={(event) => setListValue('endDate', event.target.value)} /></label>
          <label className="directory-filter">Sort<select value={`${list.sort}:${list.order}`} onChange={(event) => { const [sort, order] = event.target.value.split(':'); updateListParams(searchParams, setSearchParams, { sort, order }, { resetPage: true }); }}><option value="createdAt:desc">Created · newest</option><option value="createdAt:asc">Created · oldest</option><option value="appointmentTime:asc">Appointment · earliest</option><option value="appointmentTime:desc">Appointment · latest</option></select></label>
        </div>}
        {scheduleMessage && <p className="success-message" role="status">{scheduleMessage}</p>}
        {scheduleError && <div className="error-banner" role="alert">{scheduleError}</div>}
        {appointments.map((appointment) => {
          const actions = actionsFor(appointment.status);
          const canReschedule = ['Requested', 'Pending', 'Scheduled'].includes(appointment.status);
          const student = appointmentPatient(appointment);
          const isUpdating = updatingAppointment?.id === String(appointment.id);
          return (
            <article className="appointment-row" key={appointment.id}>
              <div className="appointment-date"><span>Date & time</span><strong>{formatManilaDateTime(appointment.startsAt || appointment.date, appointment.time)}</strong></div>
              <div className="appointment-patient"><strong>{student?.name || 'Unknown student'}</strong><span>{student?.studentId || 'Student ID unavailable'}</span><p>{appointment.reason}</p></div>
              <span className="status-chip neutral appointment-status">{appointment.status}</span>
              {appointment.decisionReason && ['Rejected', 'Cancelled'].includes(appointment.status) && <p className="appointment-decision-reason"><strong>Decision reason:</strong> {appointment.decisionReason}</p>}
              {isStaff && actions.length > 0 && <div className="appointment-actions"><button type="button" className="table-action" onClick={() => { setRescheduleError(''); setRescheduleAppointment(appointment); }} disabled={updatingAppointment !== null}>{isUpdating && updatingAppointment.action === 'Rescheduling…' ? 'Rescheduling…' : 'Reschedule'}</button>{actions.map((action) => <button type="button" className="table-action" key={action} onClick={() => {
                if (action === 'Confirm') updateStatus(appointment, 'Scheduled');
                else if (action === 'Complete') updateStatus(appointment, 'Completed');
                else { setScheduleError(''); setDecisionReason(''); setDecisionTarget({ appointment, status: action === 'Reject' ? 'Rejected' : 'Cancelled' }); }
              }} disabled={updatingAppointment !== null}>{isUpdating && updatingAppointment.action === (action === 'Confirm' ? 'Confirming…' : action === 'Complete' ? 'Completing…' : action === 'Reject' ? 'Rejecting…' : 'Cancelling…') ? updatingAppointment.action : action}</button>)}</div>}
            </article>
          );
        })}
        {!appointments.length && <div className="empty-state">{allAppointments.length ? 'No appointments match these filters.' : isStaff ? 'No student appointments or requests yet.' : 'No appointments recorded for linked students.'}</div>}
        {isStaff && <ListPagination page={pageResult.page} pageCount={pageResult.pageCount} pageSize={pageResult.pageSize} total={pageResult.total}
          onPageChange={(page) => setListValue('page', page === 1 ? null : page, false)} onPageSizeChange={(pageSize) => updateListParams(searchParams, setSearchParams, { pageSize, page: null }, { resetPage: true })} />}
      </section>
      {isStaff && <AppointmentAvailability />}
      <p className="field-hint">For urgent or emergency concerns, contact the clinic directly. Online scheduling is not an emergency service.</p>
    </div>
  );
}
