import { CalendarDays, ChevronRight, ClipboardList, HeartPulse } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatManilaDateTime } from '../utils/dateTime';

const appointmentTime = (appointment) => {
  const value = appointment.startsAt || (appointment.date
    ? `${appointment.date}T${appointment.time || '00:00'}+08:00`
    : '');
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
};

export default function PortalDashboard({ data, user }) {
  const patients = data.students || [];
  const patientIds = new Set(patients.map((patient) => String(patient.id)));
  const visits = (data.visits || [])
    .filter((visit) => patientIds.has(String(visit.studentId || visit.patientId)))
    .sort((first, second) => Date.parse(second.date || second.createdAt || 0) - Date.parse(first.date || first.createdAt || 0));
  const appointments = (data.appointments || [])
    .filter((appointment) => patientIds.has(String(appointment.studentId || appointment.patientId)));
  const now = Date.now();
  const upcomingAppointments = appointments
    .map((appointment) => ({ appointment, timestamp: appointmentTime(appointment) }))
    .filter(({ appointment, timestamp }) => timestamp !== null
      && timestamp >= now
      && ['Requested', 'Pending', 'Scheduled'].includes(appointment.status))
    .sort((first, second) => first.timestamp - second.timestamp);
  const greetingName = user?.name || 'Guardian';

  return (
    <div className="portal-dashboard">
      <header className="portal-dashboard-header">
        <div>
          <p className="portal-dashboard-context">Linked student records</p>
          <h2>Welcome, {greetingName}</h2>
          <p>See the clinic information shared with your guardian account and manage linked-student appointment requests.</p>
        </div>
        <Link className="primary-btn" to="/appointments">
          <CalendarDays size={16} aria-hidden="true" />
          {patients.length ? 'Request appointment' : 'View appointments'}
        </Link>
      </header>

      <nav className="portal-summary" aria-label="Portal sections">
        <PortalSummary icon={HeartPulse} label="Linked student profiles" value={patients.length} to="/health-records" />
        <PortalSummary icon={CalendarDays} label="Upcoming appointments" value={upcomingAppointments.length} to="/appointments" />
        <PortalSummary icon={ClipboardList} label="Recent visits" value={visits.length} to="/visits" />
      </nav>

      <section className="panel portal-panel" id="portal-profiles" aria-labelledby="portal-profiles-heading">
        <div className="panel-heading">
          <div><h3 id="portal-profiles-heading">Linked health profiles</h3><p>Information available for students linked to this guardian account</p></div>
        </div>
        {patients.length ? (
          <div className="portal-profile-list">
            {patients.map((patient) => (
              <article className="portal-profile-row" key={patient.id}>
                <div className="portal-profile-name">
                  <strong>{patient.name || 'Patient'}</strong>
                  <span>{patient.studentId || patient.patientId || 'Student ID unavailable'} · {patient.gradeLevel || patient.patientType || 'Patient'}</span>
                </div>
                <div><small>Allergies</small><strong>{patient.allergies || 'None recorded'}</strong></div>
                <div><small>Medical conditions</small><strong>{patient.conditions || 'None recorded'}</strong></div>
                <Link className="portal-row-action" to={`/profiles/${encodeURIComponent(patient.id)}`} aria-label={`View ${patient.name || 'patient'} health profile`}>
                  View details <ChevronRight size={14} aria-hidden="true" />
                </Link>
              </article>
            ))}
          </div>
        ) : (
          <div className="portal-empty-state">
            <HeartPulse size={22} aria-hidden="true" />
            <div><strong>No health profile is linked yet</strong><p>Contact the school clinic to connect the student record to this account. Linked records will appear here.</p></div>
          </div>
        )}
      </section>

      <section className="panel portal-panel" id="portal-appointments" aria-labelledby="portal-appointments-heading">
        <div className="panel-heading">
          <div><h3 id="portal-appointments-heading">Upcoming appointments</h3><p>Requests and scheduled visits for linked profiles</p></div>
          <Link className="portal-section-link" to="/appointments">{patients.length ? 'Request or manage' : 'Open appointments'} <ChevronRight size={15} aria-hidden="true" /></Link>
        </div>
        {upcomingAppointments.length ? (
          <div className="portal-record-list">
            {upcomingAppointments.slice(0, 4).map(({ appointment, timestamp }) => {
              const patient = patients.find((record) => String(record.id) === String(appointment.studentId || appointment.patientId));
              return (
                <article className="portal-record-row" key={appointment.id}>
                  <time>{formatManilaDateTime(new Date(timestamp))}</time>
                  <div><strong>{patient?.name || 'Linked patient'}</strong><span>{appointment.reason || 'Clinic appointment'}</span></div>
                  <span className={`status-chip ${appointment.status === 'Scheduled' ? 'success' : 'neutral'}`}>{appointment.status}</span>
                  <Link className="portal-row-action" to="/appointments" aria-label={`Manage appointment for ${patient?.name || 'linked patient'}`}>
                    Manage <ChevronRight size={14} aria-hidden="true" />
                  </Link>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="portal-empty-state">
            <CalendarDays size={22} aria-hidden="true" />
            <div><strong>No upcoming appointments</strong><p>{patients.length
              ? 'Request a clinic appointment when a follow-up is needed.'
              : 'Appointment requests become available after a student record is linked to your guardian account.'}</p></div>
          </div>
        )}
      </section>

      <section className="panel portal-panel" id="portal-visits" aria-labelledby="portal-visits-heading">
        <div className="panel-heading">
          <div><h3 id="portal-visits-heading">Recent clinic visits</h3><p>Visit history shared with this account</p></div>
        </div>
        {visits.length ? (
          <div className="portal-record-list">
            {visits.slice(0, 6).map((visit) => {
              const patient = patients.find((record) => String(record.id) === String(visit.studentId || visit.patientId));
              return (
                <article className="portal-record-row" key={visit.id}>
                  <time>{formatManilaDateTime(visit.date || visit.createdAt, visit.time)}</time>
                  <div><strong>{patient?.name || 'Linked patient'}</strong><span>{visit.chiefComplaint || visit.type || 'Clinic visit'}</span></div>
                  <span className={`status-chip ${visit.disposition === 'Sent home' ? 'warn' : 'neutral'}`}>{visit.disposition || 'Visit recorded'}</span>
                  <Link className="portal-row-action" to={`/visits/${encodeURIComponent(visit.id)}`} aria-label={`View clinic visit details for ${patient?.name || 'linked patient'}`}>
                    Details <ChevronRight size={14} aria-hidden="true" />
                  </Link>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="portal-empty-state">
            <ClipboardList size={22} aria-hidden="true" />
            <div><strong>No clinic visits to show</strong><p>New visit records shared by the clinic will appear here.</p></div>
          </div>
        )}
      </section>
    </div>
  );
}

function PortalSummary({ icon: Icon, label, value, to }) {
  return (
    <Link className="portal-summary-link" to={to}>
      <span className="portal-summary-icon"><Icon size={18} aria-hidden="true" /></span>
      <span><small>{label}</small><strong>{value}</strong></span>
      <ChevronRight size={16} aria-hidden="true" />
    </Link>
  );
}
