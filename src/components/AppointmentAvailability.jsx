import { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { formatManilaDateTime } from '../utils/dateTime';

const todayInManila = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

export default function AppointmentAvailability() {
  const [periods, setPeriods] = useState([]);
  const [date, setDate] = useState(todayInManila());
  const [fullDay, setFullDay] = useState(false);
  const [startTime, setStartTime] = useState('08:00');
  const [endTime, setEndTime] = useState('16:00');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [conflicts, setConflicts] = useState([]);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    api.get('/api/nurse/appointment-unavailable-periods').then((result) => {
      if (active) setPeriods(result.periods || []);
    }).catch((requestError) => {
      if (active) setError(requestError.message || 'Unavailable periods could not be loaded.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [attempt]);

  const save = async (event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    setConflicts([]);
    try {
      await api.post('/api/nurse/appointment-unavailable-periods', { date, fullDay, ...(!fullDay ? { startTime, endTime } : {}), reason });
      setReason('');
      setMessage('Appointment time marked unavailable.');
      setAttempt((value) => value + 1);
    } catch (requestError) {
      setError(requestError.message || 'The time could not be blocked.');
      setConflicts(requestError.conflicts || []);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (period) => {
    if (busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await api.delete(`/api/nurse/appointment-unavailable-periods/${encodeURIComponent(period.id)}`);
      setMessage('Unavailable period removed.');
      setAttempt((value) => value + 1);
    } catch (requestError) {
      setError(requestError.message || 'The unavailable period could not be removed.');
    } finally {
      setBusy(false);
    }
  };

  return <section className="panel appointment-availability">
    <div className="panel-heading"><div><h3>Unavailable periods</h3><p className="field-hint">Booking and rescheduling skip overlapping periods. Existing requests must be resolved before a period can be blocked.</p></div></div>
    <form className="availability-form" onSubmit={save}>
      <label>Date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} required disabled={busy} /></label>
      <label className="availability-full-day"><input type="checkbox" checked={fullDay} onChange={(event) => setFullDay(event.target.checked)} disabled={busy} /> Full day</label>
      {!fullDay && <><label>From<input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} required disabled={busy} /></label><label>To<input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} required disabled={busy} /></label></>}
      <label className="availability-reason">Reason<input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} required disabled={busy} placeholder="e.g. Nurse training" /></label>
      <button type="submit" className="primary-btn" disabled={busy}>{busy ? 'Saving…' : 'Block time'}</button>
    </form>
    {error && <div className="error-banner" role="alert">{error}</div>}
    {message && <p className="success-message" role="status">{message}</p>}
    {conflicts.length > 0 && <div className="availability-conflicts"><strong>Resolve these appointments first.</strong>{conflicts.map((item) => <p key={item.id}>{item.patientName || 'Patient'} · {item.studentId || item.patientId} · {formatManilaDateTime(item.startsAt)} · {item.status}</p>)}</div>}
    {loading ? <p className="field-hint">Loading unavailable periods…</p> : error && !periods.length ? <button type="button" className="secondary-btn" onClick={() => setAttempt((value) => value + 1)} disabled={busy}>Retry</button> : !periods.length ? <div className="empty-state">No unavailable periods are scheduled.</div> : <div className="availability-list">{periods.map((period) => <article className="availability-row" key={period.id}>
      <div><strong>{period.date}</strong><span>{formatManilaDateTime(period.starts_at)} – {formatManilaDateTime(period.ends_at)}</span><p>{period.reason}</p></div>
      <button type="button" className="table-action" onClick={() => remove(period)} disabled={busy}>Remove</button>
    </article>)}</div>}
  </section>;
}
