import { complaintLabels } from '../../utils/printDocuments.js';
import { formatManilaDateTime } from '../../utils/dateTime.js';

function Line({ label, value, handwriting = false }) {
  return <div className={`paper-field ${handwriting ? 'handwriting' : ''}`}><strong>{label}</strong><span>{value || '\u00a0'}</span></div>;
}
function Mark({ checked, children }) { return <span className="paper-choice"><span className="paper-check">{checked ? '✓' : ''}</span>{children}</span>; }
export function PassDocument({ draft: d, type }) {
  return <div className="pass-sheet">{['School Copy', 'Parent Copy'].map((copy) => <article className="pass-copy" key={copy}>
    <header><strong>{d.school}</strong><h2>{type === 'clinic' ? 'Clinic Pass' : 'Student Gate Pass'}</h2><p>{copy}</p></header>
    <div className="paper-pair"><Line label="School Year" value={d.schoolYear} /><Line label="Date" value={d.date} /></div>
    {type === 'clinic' && <Line label="Teacher" value={d.teacher} />}
    <Line label={type === 'clinic' ? 'Student' : 'Name'} value={d.name} /><Line label={type === 'clinic' ? 'Grade' : 'Grade / Level'} value={d.grade} />
    {type === 'clinic' ? <>
      <div className="paper-complaints">{complaintLabels.map((label) => <Mark key={label} checked={d.complaints.includes(label)}>{label}</Mark>)}</div>
      <Line label="Others" value={d.other} /><Line label="Nurse notes" value={d.notes} handwriting />
      <div className="paper-pair"><Line label="Time in" value={d.timeIn} /><Line label="Time out" value={d.timeOut} /></div>
      <footer className="nurse-attribution"><strong>{d.nurse || '\u00a0'}</strong><div>School Nurse</div></footer>
    </> : <>
      <Line label="Reason" value={d.reason} handwriting />
      <div className="paper-complaints"><Mark checked={d.departure === 'alone'}>Left Alone</Mark><Mark checked={d.departure === 'fetched'}>Fetched by</Mark></div>
      <Line label="Signature over Printed Name" value={d.departure === 'fetched' ? d.fetcher : ''} handwriting />
      <Line label="Relationship" value={d.departure === 'fetched' ? d.relationship : ''} />
      <div className="paper-pair"><Line label="Time Left" value={d.timeLeft} /><Line label="Time Arrived" value={d.timeArrived} /></div>
      <Line label="Authorized Person" handwriting /><div className="paper-pair"><Line label="Guard’s Signature" handwriting /><Line label="Teacher’s Signature" handwriting /></div>
    </>}
  </article>)}</div>;
}
export function SummaryDocument({ fields: d }) {
  return <table className="summary-sheet"><thead><tr><td><header><strong>{d.school}</strong><p>{d.clinic}</p><h2>Consultation summary</h2><p>Parent Copy · One selected consultation</p><p>{d.name} · Student ID: {d.rosterId || 'Not recorded'}</p><p>Consultation recorded: {d.date ? formatManilaDateTime(d.date, d.time) : 'Not recorded'}</p></header></td></tr></thead><tbody><tr><td>
    {[['Reason for visit', d.complaint], ['Care provided', d.treatment], ['Disposition', d.disposition]].map(([label, value]) => <Line key={label} label={label} value={value || 'Not recorded'} />)}
    {d.followUp && <Line label="Follow-up" value={d.followUp} />}{d.summary && <Line label="Approved clinic summary" value={d.summary} />}
    <Line label="Recorded nurse" value={d.nurse || 'Not recorded'} /><Line label="Handwritten signature" handwriting />
  </td></tr></tbody></table>;
}
