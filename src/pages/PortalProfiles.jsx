import { ChevronLeft, ChevronRight, HeartPulse } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';

const displayValue = (value) => value === undefined || value === null || value === '' ? 'Not recorded' : value;

export default function PortalProfiles({ data, user }) {
  const { patientId } = useParams();
  const profiles = data.students || [];
  const profile = patientId ? profiles.find((patient) => String(patient.id) === String(patientId)) : null;
  const isGuardian = user?.role === 'guardian';

  if (patientId) {
    if (!profile) {
      return (
        <div className="portal-record-page">
          <div className="page-intro">
            <div><p className="section-kicker">My health</p><h2>Profile unavailable</h2><p>This profile is not linked to your account.</p></div>
          </div>
          <Link className="portal-back-link" to="/profiles"><ChevronLeft size={15} aria-hidden="true" /> Back to linked profiles</Link>
        </div>
      );
    }

    const grade = profile.gradeLevel || profile.patientType || 'Patient';
    const section = profile.section;

    return (
      <div className="portal-record-page">
        <div className="page-intro">
          <div><p className="section-kicker">{isGuardian ? 'Linked patient profile' : 'Your health profile'}</p><h2>{profile.name || 'Patient'}</h2><p>Read-only health information shared with this signed-in account.</p></div>
        </div>
        <div className="portal-page-actions">
          <Link className="portal-back-link" to="/profiles"><ChevronLeft size={15} aria-hidden="true" /> Back to linked profiles</Link>
          <Link className="portal-back-link" to="/"><ChevronLeft size={15} aria-hidden="true" /> Portal dashboard</Link>
        </div>
        <section className="panel portal-detail-panel" aria-labelledby="portal-profile-details-heading">
          <div className="panel-heading"><div><p className="section-kicker">Health profile</p><h3 id="portal-profile-details-heading">Profile details</h3></div><HeartPulse size={19} aria-hidden="true" /></div>
          <dl className="portal-detail-grid">
            <Detail label="Student ID" value={profile.studentId || profile.patientId} />
            <Detail label="Patient type" value={profile.patientType} />
            <Detail label="Grade or level" value={grade} />
            <Detail label="Section" value={section} />
            <Detail label="Allergies" value={profile.allergies || 'None recorded'} />
            <Detail label="Medical conditions" value={profile.conditions || 'None recorded'} />
          </dl>
        </section>
      </div>
    );
  }

  return (
    <div className="portal-record-page">
      <div className="page-intro">
        <div><p className="section-kicker">My health</p><h2>{isGuardian ? 'Linked profiles' : 'Your health profile'}</h2><p>Read-only health information available to this signed-in account.</p></div>
        <Link className="portal-back-link" to="/"><ChevronLeft size={15} aria-hidden="true" /> Portal dashboard</Link>
      </div>
      {profiles.length ? (
        <section className="panel portal-detail-panel" aria-labelledby="portal-profiles-heading">
          <div className="panel-heading"><div><h3 id="portal-profiles-heading">{isGuardian ? 'Linked patient profiles' : 'Your linked profile'}</h3><p>Only records linked to your account are shown.</p></div></div>
          <div className="portal-profile-list">
            {profiles.map((patient) => (
              <article className="portal-profile-row" key={patient.id}>
                <div className="portal-profile-name"><strong>{patient.name || 'Patient'}</strong><span>{patient.studentId || patient.patientId || 'Student ID unavailable'} · {patient.gradeLevel || patient.patientType || 'Patient'}</span></div>
                <div><small>Allergies</small><strong>{patient.allergies || 'None recorded'}</strong></div>
                <div><small>Medical conditions</small><strong>{patient.conditions || 'None recorded'}</strong></div>
                <Link className="portal-row-action" to={`/profiles/${encodeURIComponent(patient.id)}`} aria-label={`View ${patient.name || 'patient'} health profile`}>View details <ChevronRight size={14} aria-hidden="true" /></Link>
              </article>
            ))}
          </div>
        </section>
      ) : (
        <section className="panel portal-detail-panel">
          <div className="portal-empty-state"><HeartPulse size={22} aria-hidden="true" /><div><strong>No health profile is linked yet</strong><p>Contact the school clinic to connect a patient record to this account.</p></div></div>
        </section>
      )}
    </div>
  );
}

function Detail({ label, value }) {
  return <div className="portal-detail-field"><dt>{label}</dt><dd>{displayValue(value)}</dd></div>;
}
