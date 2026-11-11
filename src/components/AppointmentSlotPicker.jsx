import { useEffect, useState } from 'react';
import { api } from '../utils/api';
import { manilaCalendarDate } from '../utils/dateTime';

export default function AppointmentSlotPicker({ date, onDateChange, startsAt, onStartsAtChange, disabled = false, refreshKey = 0 }) {
  const [slots, setSlots] = useState([]);
  const [traffic, setTraffic] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const today = manilaCalendarDate(new Date());

  useEffect(() => {
    if (!date) {
      setSlots([]);
      setTraffic(null);
      setLoading(false);
      setError('');
      return undefined;
    }
    let active = true;
    setLoading(true);
    setError('');
    api.get(`/api/appointments/slots?date=${encodeURIComponent(date)}`).then((result) => {
      if (!active) return;
      setSlots(result.slots || []);
      setTraffic(result.traffic || null);
    }).catch((requestError) => {
      if (!active) return;
      setSlots([]);
      setTraffic(null);
      setError(requestError.message || 'Available times could not be loaded.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [date, refreshKey]);

  return <div className="appointment-slot-picker">
    <label>Appointment date<input type="date" min={today} value={date} onChange={(event) => { onDateChange(event.target.value); onStartsAtChange(''); }} required disabled={disabled} /></label>
    {date && <>
      <label>Available time{traffic?.historyAvailable ? ' (suggestions first)' : ''}
        <select value={startsAt} onChange={(event) => onStartsAtChange(event.target.value)} disabled={disabled || loading || !slots.length} required>
          <option value="">Choose a clinic time</option>
          {slots.map((slot) => <option key={slot.local} value={slot.local}>{slot.suggestionRank && slot.suggestionRank <= 3 ? `Suggested ${slot.suggestionRank} · ` : ''}{slot.local.slice(11)}</option>)}
        </select>
      </label>
      <div className="slot-guidance" aria-live="polite">
        {loading && <span className="field-hint">Checking availability…</span>}
        {!loading && error && <span className="error-banner" role="alert">{error}</span>}
        {!loading && !error && !slots.length && <span className="field-hint">No available clinic times on this date.</span>}
        {!loading && !error && slots.length > 0 && (traffic?.historyAvailable
          ? <span className="field-hint">Lower-traffic suggestions use same-weekday visit history from the past {traffic.lookbackDays} days. Availability can change before you submit.</span>
          : <span className="field-hint">There is not enough recent same-weekday history to rank times, so available slots are listed in clinic order.</span>)}
      </div>
    </>}
  </div>;
}
