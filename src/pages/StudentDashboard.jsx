import { CalendarDays, Clock3 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatManilaDateTime } from '../utils/dateTime';

export default function StudentDashboard({ data, user }) {
  const appointments = [...(data?.appointments || [])]
    .filter((appointment) => appointment.startsAt)
    .sort((first, second) => Date.parse(first.startsAt) - Date.parse(second.startsAt));
  const upcoming = appointments.filter((appointment) => (
    Date.parse(appointment.startsAt) >= Date.now()
    && ['Requested', 'Pending', 'Scheduled'].includes(appointment.status)
  ));

  return (
    <main className="student-dashboard">
      <header className="page-intro">
        <div><p className="section-kicker">Student schedule</p><p>View your appointment dates and request a clinic time.</p></div>
        <Link className="primary-btn" to="/appointments"><CalendarDays size={16} aria-hidden="true" /> Request appointment</Link>
      </header>
      <section className="panel portal-detail-panel" aria-labelledby="student-appointments-heading">
        <div className="panel-heading"><div><h3 id="student-appointments-heading">My appointments</h3><p>Dates and request status for your student account.</p></div><Clock3 size={19} aria-hidden="true" /></div>
        {appointments.length ? <div className="portal-record-list">
          {appointments.map((appointment) => <article className="portal-record-row" key={appointment.id}>
            <time>{formatManilaDateTime(appointment.startsAt)}</time>
            <div><strong>Clinic appointment</strong><span>Appointment schedule</span></div>
            <span className={`status-chip ${appointment.status === 'Scheduled' ? 'success' : 'neutral'}`}>{appointment.status}</span>
          </article>)}
        </div> : <div className="portal-empty-state"><CalendarDays size={22} aria-hidden="true" /><div><strong>No appointments yet</strong><p>Request an available clinic time when you need an appointment.</p></div></div>}
        {upcoming.length === 0 && appointments.length > 0 && <p className="field-hint">You have no upcoming appointment requests.</p>}
      </section>
    </main>
  );
}
