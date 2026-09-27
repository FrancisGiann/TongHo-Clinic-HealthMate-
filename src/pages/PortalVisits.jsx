import { CalendarDays, ChevronLeft, ChevronRight, ClipboardList } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { formatManilaDateTime } from '../utils/dateTime';

function visitTimestamp(visit) {
  const parsed = Date.parse(visit.date || visit.createdAt || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export default function PortalVisits({ data, user }) {
  const { visitId } = useParams();
  const profiles = data.students || [];
  const profileIds = new Set(profiles.map((patient) => String(patient.id)));
  const visits = (data.visits || [])
    .filter((visit) => profileIds.has(String(visit.studentId || visit.patientId)))
    .sort((first, second) => visitTimestamp(second) - visitTimestamp(first));
  const visit = visitId ? visits.find((record) => String(record.id) === String(visitId)) : null;
  const patientFor = (record) => profiles.find((patient) => String(patient.id) === String(record.studentId || record.patientId));

  if (visitId) {
    if (!visit) {
      return (
        <div className="portal-record-page">
          <div className="page-intro"><div><p className="section-kicker">Care record</p><h2>Visit unavailable</h2><p>This visit is not linked to your account.</p></div></div>
          <Link className="portal-back-link" to="/visits"><ChevronLeft size={15} aria-hidden="true" /> Back to visit history</Link>
        </div>
      );
    }

    const patient = patientFor(visit);

    return (
      <div className="portal-record-page">
        <div className="page-intro">
          <div><p className="section-kicker">Care record</p><h2>Clinic visit details</h2><p>{patient?.name || 'Linked patient'} · {formatManilaDateTime(visit.date || visit.createdAt, visit.time)}</p></div>
        </div>
        <div className="portal-page-actions">
          <Link className="portal-back-link" to="/visits"><ChevronLeft size={15} aria-hidden="true" /> Back to visit history</Link>
          {patient && <Link className="portal-back-link" to={`/profiles/${encodeURIComponent(patient.id)}`}>View health profile <ChevronRight size={14} aria-hidden="true" /></Link>}
        </div>
        <section className="panel portal-detail-panel" aria-labelledby="portal-visit-details-heading">
          <div className="panel-heading"><div><p className="section-kicker">Visit history</p><h3 id="portal-visit-details-heading">Visit record</h3></div><CalendarDays size={19} aria-hidden="true" /></div>
          <dl className="portal-detail-grid">
            <Detail label="Date and time" value={formatManilaDateTime(visit.date || visit.createdAt, visit.time)} />
            <Detail label="Visit type" value={visit.type} />
            <Detail label="Reason for visit" value={visit.chiefComplaint} />
            <Detail label="Treatment or care" value={visit.treatment} />
            <Detail label="Disposition" value={visit.disposition} />
            {visit.followUp && <Detail label="Follow-up" value={visit.followUpDate ? `Recommended by ${visit.followUpDate}` : 'Recommended'} />}
            {visit.consultationSummary && <Detail label="Clinic summary" value={visit.consultationSummary} />}
          </dl>
        </section>
      </div>
    );
  }

  return (
    <div className="portal-record-page">
      <div className="page-intro">
        <div><p className="section-kicker">Care record</p><h2>Visit history</h2><p>{user?.role === 'guardian' ? 'Clinic visits for patients linked to your account.' : 'Clinic visits shared with your account.'}</p></div>
        <Link className="portal-back-link" to="/"><ChevronLeft size={15} aria-hidden="true" /> Portal dashboard</Link>
      </div>
      <section className="panel portal-detail-panel" aria-labelledby="portal-visits-heading">
        <div className="panel-heading"><div><h3 id="portal-visits-heading">Recent clinic visits</h3><p>Read-only records shared by the school clinic.</p></div></div>
        {visits.length ? (
          <div className="portal-record-list">
            {visits.map((record) => {
              const patient = patientFor(record);
              return (
                <article className="portal-record-row" key={record.id}>
                  <time>{formatManilaDateTime(record.date || record.createdAt, record.time)}</time>
                  <div><strong>{patient?.name || 'Linked patient'}</strong><span>{record.chiefComplaint || record.type || 'Clinic visit'}</span></div>
                  <span className={`status-chip ${record.disposition === 'Sent home' ? 'warn' : 'neutral'}`}>{record.disposition || 'Visit recorded'}</span>
                  <Link className="portal-row-action" to={`/visits/${encodeURIComponent(record.id)}`} aria-label={`View clinic visit details for ${patient?.name || 'linked patient'}`}>Details <ChevronRight size={14} aria-hidden="true" /></Link>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="portal-empty-state"><ClipboardList size={22} aria-hidden="true" /><div><strong>No clinic visits to show</strong><p>New visit records shared by the clinic will appear here.</p></div></div>
        )}
      </section>
    </div>
  );
}

function Detail({ label, value }) {
  return <div className="portal-detail-field"><dt>{label}</dt><dd>{value === undefined || value === null || value === '' ? 'Not recorded' : value}</dd></div>;
}
