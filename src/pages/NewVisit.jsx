import { useState } from "react";
import { Check, ChevronDown, ClipboardPlus, Search } from "lucide-react";
import { api } from "../utils/api";

const complaints = [
  "Headache",
  "Stomachache",
  "Fever",
  "Cough",
  "Wound",
  "Dizziness",
  "Nausea",
];

function clinicDate(value) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export default function NewVisit({ data, user, reload }) {
  const [selected, setSelected] = useState(null);
  const [complaint, setComplaint] = useState("");
  const [visitType, setVisitType] = useState("Illness");
  const [treatment, setTreatment] = useState("Rest and hydration");
  const [disposition, setDisposition] = useState("Returned to class");
  const [medicineId, setMedicineId] = useState("");
  const [followUp, setFollowUp] = useState(false);
  const [followUpDate, setFollowUpDate] = useState("");
  const [temperature, setTemperature] = useState("");
  const [pulse, setPulse] = useState("");
  const [notes, setNotes] = useState("");
  const [painScore, setPainScore] = useState("");
  const [clinicianRedFlag, setClinicianRedFlag] = useState(false);
  const [riskAcknowledgement, setRiskAcknowledgement] = useState("");
  const [riskResult, setRiskResult] = useState(null);
  const [saveError, setSaveError] = useState("");
  const [summaryDraft, setSummaryDraft] = useState("");
  const [summaryMeta, setSummaryMeta] = useState(null);
  const [summaryApproved, setSummaryApproved] = useState(false);
  const [saved, setSaved] = useState(false);
  const clinicToday = clinicDate(new Date());
  const generateSummary = async () => {
    setSaveError("");
    try {
      const result = await api.post('/api/summaries/draft', { type: visitType, chiefComplaint: complaint, treatment, disposition, notes, painScore: painScore ? Number(painScore) : null, temperature, pulse, risk: riskResult });
      setSummaryDraft(result.draft);
      setSummaryMeta(result);
      setSummaryApproved(false);
    } catch (error) {
      setSaveError(error.message);
    }
  };
  const save = async () => {
    if (!selected) return setSaveError('Select a student before saving the visit.');
    if (!complaint.trim()) return setSaveError('Enter a chief complaint before saving the visit.');
    if (followUp && !followUpDate) return setSaveError('Choose a follow-up date before saving the visit.');
    if (followUp && followUpDate < clinicToday) return setSaveError('Follow-up date must be today or later.');
    setSaveError("");
    try {
      const preview = await api.post('/api/risk/assess', {
        painScore: painScore === "" ? null : Number(painScore),
        clinicianRedFlag,
        recentVisitCount: data.visits.filter((visit) => String(visit.studentId || visit.patientId) === String(selected.id)).length,
        temperature: temperature === "" ? null : Number(temperature),
        pulse: pulse === "" ? null : Number(pulse),
      });
      setRiskResult(preview);
      if (preview.status === 'incomplete') return setSaveError(preview.rationale);
      if (preview.category === 'high' && !riskAcknowledgement.trim()) return setSaveError('Document the nurse acknowledgement before saving a high-risk assessment.');
    } catch (error) {
      return setSaveError(error.message);
    }
    let result;
    try {
      result = await api.post('/api/visits', {
        patientId: selected.id,
        visitType,
        chiefComplaint: complaint,
        treatment,
        disposition,
        followUp,
        ...(followUp ? { followUpDate } : {}),
        medicineId: medicineId || null,
        medicineQuantity: medicineId ? 1 : 0,
        temperature: temperature === "" ? null : Number(temperature),
        pulse: pulse === "" ? null : Number(pulse),
        painScore: painScore === "" ? null : Number(painScore),
        clinicianRedFlag,
        riskAcknowledgement: riskAcknowledgement.trim(),
        notes,
        summaryDraft: summaryDraft.trim(),
        summaryApproved,
      });
    } catch (error) {
      return setSaveError(error.message);
    }
    setRiskResult(result.assessment);
    await reload?.();
    setSaved(true);
  };
  return (
    <div className="form-page">
      <div className="page-intro">
        <div>
          <h2>New visit</h2>
          <p>Capture what happened, clearly and quickly.</p>
        </div>
      </div>
      <div className="form-layout">
        <section className="panel form-panel">
          <FormStep number="01" title="Select student">
            <div className="search-box">
              <Search size={17} />
              <input
                placeholder="Search student name or ID..."
                onChange={(e) =>
                  setSelected(
                    data.students.find((s) =>
                      `${s.name} ${s.studentId}`
                        .toLowerCase()
                        .includes(e.target.value.toLowerCase()),
                    ) || null,
                  )
                }
              />
            </div>
            {selected && (
              <div className="selected-student">
                <div className="avatar small teal">
                  {selected.name
                    .split(" ")
                    .map((x) => x[0])
                    .join("")
                    .slice(0, 2)}
                </div>
                <div>
                  <strong>{selected.name}</strong>
                  <span>
                    {selected.studentId} · {selected.gradeLevel}
                  </span>
                </div>
                <Check size={18} />
              </div>
            )}
          </FormStep>
          <FormStep number="02" title="Visit details">
            <label>
              Visit type{" "}
              <select value={visitType} onChange={(e) => setVisitType(e.target.value)}>
                {['Illness', 'Injury', 'Follow-up', 'Emergency', 'Routine Check'].map((type) => <option key={type}>{type}</option>)}
              </select>
              <ChevronDown size={15} />
            </label>
            <span className="field-label">Chief complaint</span>
            <div className="chip-row">
              {complaints.map((item) => (
                <button
                  className={complaint === item ? "selected" : ""}
                  key={item}
                  onClick={() => setComplaint(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          </FormStep>
          <FormStep number="03" title="Assessment & action">
            <div className="two-fields">
              <label>Treatment <select value={treatment} onChange={(e) => setTreatment(e.target.value)}>{['Rest and hydration', 'Ice pack', 'Bandage', 'Medication given', 'Sent home', 'Referred to hospital'].map((item) => <option key={item}>{item}</option>)}</select></label>
              <label>Disposition <select value={disposition} onChange={(e) => setDisposition(e.target.value)}>{['Returned to class', 'Sent home', 'Referred to physician', 'Sent to hospital'].map((item) => <option key={item}>{item}</option>)}</select></label>
            </div>
            <label>Medicine dispensed <select value={medicineId} onChange={(e) => setMedicineId(e.target.value)}><option value="">None</option>{data.inventory.filter((item) => !item.archived && item.quantity > 0).map((item) => <option key={item.id} value={item.id}>{item.name} · {item.quantity} {item.unit} left</option>)}</select></label>
            <div className="two-fields">
              <label>
                Temperature{" "}
                <div className="input-unit">
                  <input value={temperature} onChange={(event) => setTemperature(event.target.value)} placeholder="—" />
                  <span>°C</span>
                </div>
              </label>
              <label>
                Pulse rate{" "}
                <div className="input-unit">
                  <input value={pulse} onChange={(event) => setPulse(event.target.value)} placeholder="—" />
                  <span>bpm</span>
                </div>
              </label>
            </div>
            <div className="two-fields">
              <label>Pain score (1–10)<input type="number" min="1" max="10" step="1" value={painScore} onChange={(event) => setPainScore(event.target.value)} required /></label>
              <label className="check-label"><input type="checkbox" checked={clinicianRedFlag} onChange={(event) => setClinicianRedFlag(event.target.checked)} /> Clinician-observed urgent warning sign</label>
            </div>
            {(clinicianRedFlag || riskResult?.category === 'high') && <label>Nurse acknowledgement / override reason<textarea value={riskAcknowledgement} onChange={(event) => setRiskAcknowledgement(event.target.value)} placeholder="Document the assessment and action taken…" /></label>}
            <label>
              Notes{" "}
              <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Describe symptoms, observations, and action taken..." />
            </label>
            <button type="button" className="secondary-btn" onClick={generateSummary} disabled={!complaint}>Generate summary draft</button>
            {summaryDraft && <div className="risk-result"><strong>Review AI-assisted draft</strong><textarea value={summaryDraft} onChange={(event) => { setSummaryDraft(event.target.value); setSummaryApproved(false); }} />{user?.role === 'school_nurse' ? <label className="check-label"><input type="checkbox" checked={summaryApproved} onChange={(event) => setSummaryApproved(event.target.checked)} /> I reviewed and approve this summary for the record</label> : <small>A school nurse must approve this draft before it can be saved to the record.</small>}<small>Provider: {summaryMeta?.provider}. The risk score is calculated separately and is never controlled by AI.</small></div>}
          </FormStep>
          <div className="form-actions">
            <div className="follow-up-control">
              <label className="check-label"><input type="checkbox" checked={followUp} onChange={(e) => { setFollowUp(e.target.checked); if (!e.target.checked) setFollowUpDate(""); }} /> Schedule follow-up</label>
              {followUp && <label className="follow-up-date-field">Follow-up due date
                <input type="date" value={followUpDate} min={clinicToday} onChange={(e) => setFollowUpDate(e.target.value)} required />
              </label>}
            </div>
            <button className="primary-btn" onClick={save}>
              <ClipboardPlus size={16} /> Save visit
            </button>
          </div>
          {saved && (
            <p className="success-message">Visit saved to today’s activity.</p>
          )}
          {saveError && <div className="error-banner" role="alert">{saveError}</div>}
          {riskResult && <div className={`risk-result risk-${riskResult.category}`}><strong>Decision-support result: {riskResult.category}</strong><p>{riskResult.rationale}</p><small>{riskResult.disclaimer} Rule version: {riskResult.ruleVersion} ({riskResult.ruleStatus}).</small></div>}
        </section>
        <aside className="visit-aside">
          <div className="aside-card">
            <p className="section-kicker">Helpful prompts</p>
            <h3>Before you close the visit</h3>
            <ul>
              <li>Check the student’s allergy information</li>
              <li>Record any medicine dispensed</li>
              <li>Confirm the disposition</li>
              <li>Schedule a follow-up if needed</li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
function FormStep({ number, title, children }) {
  return (
    <div className="form-step">
      <div className="step-heading">
        <span>{number}</span>
        <h3>{title}</h3>
      </div>
      {children}
    </div>
  );
}
