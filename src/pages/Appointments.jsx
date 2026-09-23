import { useEffect, useMemo, useState } from 'react';
import { CalendarPlus } from 'lucide-react';
import { api } from '../utils/api';
import { formatManilaDateTime } from '../utils/dateTime';
import StudentPicker from '../components/StudentPicker';

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
    if (!patientId) return setError('Choose the student this appointment is for.');
    setSaving(true);
    try {
      await api.post('/api/appointments', { patientId, startsAt, reason });
      setMessage(isStaff ? 'Appointment scheduled for the selected student.' : 'Appointment request submitted for the selected student.');
      setPatientId('');
      setStartsAt('');
      setSlotDate('');
      setReason('');
      await reload();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  };
  const updateStatus = async (appointment, status) => {
    setError('');
    try {
      await api.patch(`/api/appointments/${encodeURIComponent(appointment.id)}`, { status });
      setMessage(`Appointment marked ${status.toLowerCase()}.`);
      await reload();
    } catch (requestError) {
      setError(requestError.message);
    }
  };
  const updateTime = async (appointment) => {
    const nextStartsAt = reschedule[appointment.id];
    if (!nextStartsAt) return setError('Choose a new date and time before rescheduling.');
    setError('');
    try {
      await api.patch(`/api/appointments/${encodeURIComponent(appointment.id)}`, { status: appointment.status, startsAt: nextStartsAt });
      setMessage('Appointment rescheduled.');
      await reload();
    } catch (requestError) {
      setError(requestError.message);
    }
  };
  const actionsFor = (status) => {
    if (status === 'Requested' || status === 'Pending') return ['Confirm', 'Cancel'];
    if (status === 'Scheduled') return ['Complete', 'Cancel'];
    return [];
  };

  return (
    <div className="form-page">
      <div className="page-intro"><div><h2>{isStaff ? 'Appointments' : 'Clinic scheduling'}</h2><p>{isStaff ? 'Schedule a student appointment and manage requests.' : 'Request an appointment for a student linked to your account.'}</p></div></div>
      <form className="panel form-panel" onSubmit={submit}>
        <div className="two-fields">
          <StudentPicker students={data.students || []} value={patientId} onChange={setPatientId} label={isStaff ? 'Schedule for student' : 'Student'} required disabled={saving}/>
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
        <button className="primary-btn" disabled={saving || !data.students?.length || !patientId || !slotDate || !startsAt}><CalendarPlus size={16} /> {saving ? 'Saving…' : isStaff ? 'Schedule appointment' : 'Request appointment'}</button>
        {message && <p className="success-message">{message}</p>}
        {error && <div className="error-banner" role="alert">{error}</div>}
      </form>
      <section className="panel table-panel">
        <div className="panel-heading"><div><p className="section-kicker">Schedule</p><h3>{isStaff ? 'Student appointments and requests' : 'Your appointment requests'}</h3></div></div>
        {appointments.map((appointment) => { const actions = actionsFor(appointment.status); const canReschedule = ['Requested', 'Pending', 'Scheduled'].includes(appointment.status); const student = data.students.find((person) => String(person.id) === String(appointment.studentId || appointment.patientId)); return <div className="queue-row" key={appointment.id}><strong>{formatManilaDateTime(appointment.startsAt || appointment.date, appointment.time)}</strong><span><b>{student?.name || 'Unknown student'}</b><small>{student?.studentId || 'Student ID unavailable'} · {appointment.reason}</small></span><span className="status-chip neutral">{appointment.status}</span>{isStaff && actions.length > 0 && <div className="appointment-actions">{canReschedule && <input aria-label={`Reschedule ${student?.name || 'student'} appointment`} type="datetime-local" min={manilaDateTimeNow()} value={reschedule[appointment.id] || ''} onChange={(event) => setReschedule((current) => ({ ...current, [appointment.id]: event.target.value }))} />}{canReschedule && <button type="button" className="table-action" onClick={() => updateTime(appointment)}>Reschedule</button>}{actions.map((action) => <button type="button" className="table-action" key={action} onClick={() => updateStatus(appointment, action === 'Confirm' ? 'Scheduled' : action === 'Complete' ? 'Completed' : 'Cancelled')}>{action}</button>)}</div>}</div>; })}
        {!appointments.length && <div className="empty-state">{isStaff ? 'No student appointments or requests yet.' : 'No appointments recorded for linked students.'}</div>}
      </section>
      <p className="field-hint">For urgent or emergency concerns, contact the clinic directly. Online scheduling is not an emergency service.</p>
    </div>
  );
}
