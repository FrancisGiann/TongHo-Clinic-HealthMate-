import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarPlus } from 'lucide-react';
import { api } from '../utils/api';
import { formatManilaDateTime } from '../utils/dateTime';
import StudentPicker from '../components/StudentPicker';
import ModalDialog from '../components/ModalDialog';

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
  const updateLock = useRef(false);
  const patientIds = useMemo(() => new Set((data.students || []).map((patient) => String(patient.id))), [data.students]);
  const appointments = (data.appointments || []).filter((appointment) => patientIds.has(String(appointment.studentId || appointment.patientId)));
  const isStaff = user.role === 'school_nurse';
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
      if (isStaff) setShowScheduleDialog(false);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  };
  const updateStatus = async (appointment, status) => {
    if (updateLock.current) return;
    updateLock.current = true;
    setUpdatingAppointment({ id: String(appointment.id), action: status === 'Scheduled' ? 'Confirming…' : status === 'Completed' ? 'Completing…' : 'Cancelling…' });
    setError('');
    setMessage('');
    setScheduleError('');
    setScheduleMessage('');
    try {
      await api.patch(`/api/appointments/${encodeURIComponent(appointment.id)}`, { status });
      setScheduleMessage(`Appointment marked ${status.toLowerCase()}.`);
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
    if (status === 'Requested' || status === 'Pending') return ['Confirm', 'Cancel'];
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
        {scheduleMessage && <p className="success-message" role="status">{scheduleMessage}</p>}
        {scheduleError && <div className="error-banner" role="alert">{scheduleError}</div>}
        {appointments.map((appointment) => {
          const actions = actionsFor(appointment.status);
          const canReschedule = ['Requested', 'Pending', 'Scheduled'].includes(appointment.status);
          const student = data.students.find((person) => String(person.id) === String(appointment.studentId || appointment.patientId));
          const isUpdating = updatingAppointment?.id === String(appointment.id);
          return (
            <article className="appointment-row" key={appointment.id}>
              <div className="appointment-date"><span>Date & time</span><strong>{formatManilaDateTime(appointment.startsAt || appointment.date, appointment.time)}</strong></div>
              <div className="appointment-patient"><strong>{student?.name || 'Unknown student'}</strong><span>{student?.studentId || 'Student ID unavailable'}</span><p>{appointment.reason}</p></div>
              <span className="status-chip neutral appointment-status">{appointment.status}</span>
              {isStaff && actions.length > 0 && <div className="appointment-actions"><button type="button" className="table-action" onClick={() => { setRescheduleError(''); setRescheduleAppointment(appointment); }} disabled={updatingAppointment !== null}>{isUpdating && updatingAppointment.action === 'Rescheduling…' ? 'Rescheduling…' : 'Reschedule'}</button>{actions.map((action) => <button type="button" className="table-action" key={action} onClick={() => updateStatus(appointment, action === 'Confirm' ? 'Scheduled' : action === 'Complete' ? 'Completed' : 'Cancelled')} disabled={updatingAppointment !== null}>{isUpdating && updatingAppointment.action === (action === 'Confirm' ? 'Confirming…' : action === 'Complete' ? 'Completing…' : 'Cancelling…') ? updatingAppointment.action : action}</button>)}</div>}
            </article>
          );
        })}
        {!appointments.length && <div className="empty-state">{isStaff ? 'No student appointments or requests yet.' : 'No appointments recorded for linked students.'}</div>}
      </section>
      <p className="field-hint">For urgent or emergency concerns, contact the clinic directly. Online scheduling is not an emergency service.</p>
    </div>
  );
}
