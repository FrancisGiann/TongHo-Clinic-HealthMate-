import { CalendarDays, ClipboardList, HeartPulse, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function PortalDashboard({ data, user }) {
  const patients = data.students || [];
  const patientIds = new Set(patients.map((patient) => String(patient.id)));
  const visits = (data.visits || []).filter((visit) => patientIds.has(String(visit.studentId || visit.patientId)));
  const appointments = (data.appointments || []).filter((appointment) => patientIds.has(String(appointment.studentId || appointment.patientId)));

  return (
    <div className="dashboard-page">
      <section className="dashboard-hero">
        <div>
          <p className="section-kicker">Secure health portal</p>
          <h2>Welcome, {user.name}</h2>
          <p>{user.role === 'guardian' ? 'View records and appointments for students linked to your account.' : 'View your clinic records and appointment information.'}</p>
        </div>
        <ShieldCheck size={42} />
      </section>
      <section className="summary-grid">
        <Summary icon={HeartPulse} label="Profiles" value={patients.length} />
        <Summary icon={ClipboardList} label="Recorded visits" value={visits.length} />
        <Summary icon={CalendarDays} label="Appointments" value={appointments.length} />
      </section>
      <section className="panel table-panel">
        <div className="panel-heading"><div><p className="section-kicker">Authorized records</p><h3>Health profiles</h3></div><Link className="primary-btn" to="/appointments">Request appointment</Link></div>
        {patients.length ? patients.map((patient) => (
          <article className="student-row" key={patient.id}>
            <div><strong>{patient.name}</strong><span>{patient.studentId || patient.patientId} · {patient.gradeLevel || patient.patientType || 'Patient'}</span></div>
            <div><small>Allergies</small><strong>{patient.allergies || 'None recorded'}</strong></div>
            <div><small>Medical conditions</small><strong>{patient.conditions || 'None recorded'}</strong></div>
          </article>
        )) : <div className="empty-state">No patient record is linked to this account. Contact the clinic administrator.</div>}
      </section>
      <section className="panel table-panel">
        <div className="panel-heading"><div><p className="section-kicker">History</p><h3>Recent clinic visits</h3></div></div>
        {visits.slice(-10).reverse().map((visit) => <div className="queue-row" key={visit.id}><strong>{visit.date}</strong><span>{visit.chiefComplaint}</span><span className="status-chip neutral">{visit.disposition}</span></div>)}
        {!visits.length && <div className="empty-state">No clinic visits recorded.</div>}
      </section>
    </div>
  );
}

function Summary({ icon: Icon, label, value }) {
  return <div className="summary-card"><Icon size={20} /><span>{label}</span><strong>{value}</strong></div>;
}
