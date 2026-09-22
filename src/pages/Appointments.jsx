import { useMemo, useState } from 'react';
import { CalendarPlus } from 'lucide-react';
import { api } from '../utils/api';

export default function Appointments({ data, user, reload }) {
  const [patientId, setPatientId] = useState(() => String(data.students?.[0]?.id || ''));
  const [startsAt, setStartsAt] = useState('');
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const patientIds = useMemo(() => new Set((data.students || []).map((patient) => String(patient.id))), [data.students]);
  const appointments = (data.appointments || []).filter((appointment) => patientIds.has(String(appointment.studentId || appointment.patientId)));
  const isStaff = ['school_nurse', 'system_administrator'].includes(user.role);

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    try {
      await api.post('/api/appointments', { patientId, startsAt, reason });
      setMessage('Appointment request submitted.');
      setStartsAt('');
      setReason('');
      await reload();
    } catch (requestError) {
      setError(requestError.message);
    }
  };
  const updateStatus = async (appointment, status) => {
    setError('');
    try {
      await api.patch(`/api/appointments/${encodeURIComponent(appointment.id)}`, { status, ...(appointment.startsAt ? { startsAt: appointment.startsAt } : {}) });
      setMessage(`Appointment marked ${status.toLowerCase()}.`);
      await reload();
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  return (
    <div className="form-page">
      <div className="page-intro"><div><p className="section-kicker">Appointments</p><h2>Clinic scheduling</h2><p>Request a clinic visit and review its status.</p></div></div>
      <form className="panel form-panel" onSubmit={submit}>
        <div className="two-fields">
          <label>Patient<select value={patientId} onChange={(event) => setPatientId(event.target.value)} required>{(data.students || []).map((patient) => <option key={patient.id} value={patient.id}>{patient.name}</option>)}</select></label>
          <label>Date and time<input type="datetime-local" min={new Date().toISOString().slice(0, 16)} value={startsAt} onChange={(event) => setStartsAt(event.target.value)} required /></label>
        </div>
        <label>Reason<textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} required /></label>
        <button className="primary-btn" disabled={!data.students?.length}><CalendarPlus size={16} /> Request appointment</button>
        {message && <p className="success-message">{message}</p>}
        {error && <div className="error-banner" role="alert">{error}</div>}
      </form>
      <section className="panel table-panel">
        <div className="panel-heading"><div><p className="section-kicker">Schedule</p><h3>Your requests</h3></div></div>
        {appointments.map((appointment) => <div className="queue-row" key={appointment.id}><strong>{appointment.startsAt || `${appointment.date} ${appointment.time || ''}`}</strong><span>{appointment.reason}</span><span className="status-chip neutral">{appointment.status}</span>{isStaff && <div className="intro-actions"><button type="button" className="table-action" onClick={() => updateStatus(appointment, 'Scheduled')}>Confirm</button><button type="button" className="table-action" onClick={() => updateStatus(appointment, 'Completed')}>Complete</button><button type="button" className="table-action" onClick={() => updateStatus(appointment, 'Cancelled')}>Cancel</button></div>}</div>)}
        {!appointments.length && <div className="empty-state">No appointments recorded.</div>}
      </section>
      <p className="field-hint">For urgent or emergency concerns, contact the clinic directly. Online scheduling is not an emergency service.</p>
    </div>
  );
}
