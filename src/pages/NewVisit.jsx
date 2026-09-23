import { useState } from "react";
import { useLocation } from "react-router-dom";
import { Check, ChevronDown, ClipboardPlus, Plus, Trash2 } from "lucide-react";
import { api } from "../utils/api";
import StudentPicker from "../components/StudentPicker";

  const complaints = [
  "Headache",
  "Stomachache",
  "Fever",
  "Cough",
  "Wound",
  "Dizziness",
  "Nausea",
];
const treatmentPrompts = ['Rest and hydration', 'Cold pack applied', 'Wound cleaned and dressed', 'Medication given'];

function clinicDate(value) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export default function NewVisit({ data, user, reload }) {
  const location = useLocation();
  const [selectedId, setSelectedId] = useState(() => String(location.state?.selectedStudent?.id || ""));
  const [complaint, setComplaint] = useState("");
  const [visitType, setVisitType] = useState("Illness");
  const [treatment, setTreatment] = useState("");
  const [disposition, setDisposition] = useState("Returned to class");
  const [dispensations, setDispensations] = useState([{ itemId: "", quantity: "1" }]);
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
  const [saving, setSaving] = useState(false);
  const clinicToday = clinicDate(new Date());
  const selected = data.students.find((student) => String(student.id) === selectedId);
  const inventoryItems = (data.inventory || []).filter((item) => !item.archived);
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
    if (saving) return;
    setSaved(false);
    if (!selected) return setSaveError('Select a student before saving the visit.');
    if (!complaint.trim()) return setSaveError('Enter a chief complaint before saving the visit.');
    if (!treatment.trim()) return setSaveError('Enter the treatment or care provided before saving the visit.');
    const chosenDispensations = dispensations.filter((entry) => entry.itemId || entry.quantity !== '1');
    const dispensedIds = new Set();
    for (const entry of chosenDispensations) {
      const quantity = Number(entry.quantity);
      if (!entry.itemId || !Number.isInteger(quantity) || quantity < 1 || quantity > 100) return setSaveError('Choose an inventory item and enter a whole-number quantity from 1 to 100.');
      if (dispensedIds.has(entry.itemId)) return setSaveError('Choose each inventory item only once.');
      dispensedIds.add(entry.itemId);
    }
    if (followUp && !followUpDate) return setSaveError('Choose a follow-up date before saving the visit.');
    if (followUp && followUpDate < clinicToday) return setSaveError('Follow-up date must be today or later.');
    setSaveError("");
    setSaving(true);
    try {
      const preview = await api.post('/api/risk/assess', {
        painScore: painScore === "" ? null : Number(painScore),
        clinicianRedFlag,
        recentVisitCount: data.visits.filter((visit) => String(visit.studentId || visit.patientId) === String(selected.id)).length,
        temperature: temperature === "" ? null : Number(temperature),
        pulse: pulse === "" ? null : Number(pulse),
      });
      setRiskResult(preview);
      if (preview.status === 'incomplete') {
        setSaveError(preview.rationale);
        setSaving(false);
        return;
      }
      if (preview.category === 'high' && !riskAcknowledgement.trim()) {
        setSaveError('Document the nurse acknowledgement before saving a high-risk assessment.');
        setSaving(false);
        return;
      }
    } catch (error) {
      setSaveError(error.message);
      setSaving(false);
      return;
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
        dispensations: chosenDispensations.map((entry) => ({ itemId: entry.itemId, quantity: Number(entry.quantity) })),
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
    } finally {
      setSaving(false);
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
            <StudentPicker students={data.students} value={selectedId} onChange={setSelectedId} required disabled={saving} />
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
                <Check size={18} aria-hidden="true" />
              </div>
            )}
            {selected && <div className="selected-allergies"><strong>Allergies</strong><span>{selected.allergies?.trim() || 'None recorded'}</span></div>}
          </FormStep>
          <FormStep number="02" title="Visit details">
            <label>
              Visit type{" "}
              <select value={visitType} onChange={(e) => setVisitType(e.target.value)}>
                {['Illness', 'Injury', 'Follow-up', 'Emergency', 'Routine Check'].map((type) => <option key={type}>{type}</option>)}
              </select>
              <ChevronDown size={15} />
            </label>
            <label>Chief complaint *<textarea value={complaint} onChange={(event) => setComplaint(event.target.value)} maxLength={300} placeholder="Describe the student’s concern in their own words or your observation." required disabled={saving} /></label>
            <span className="field-label">Optional complaint suggestions</span>
            <div className="chip-row">
              {complaints.map((item) => (
                <button
                  type="button"
                  className={complaint === item ? "selected" : ""}
                  key={item}
                  onClick={() => setComplaint(item)}
                  disabled={saving}
                >
                  {item}
                </button>
              ))}
            </div>
          </FormStep>
          <FormStep number="03" title="Assessment & action">
            <div className="two-fields">
              <label>Disposition <select value={disposition} onChange={(e) => setDisposition(e.target.value)} disabled={saving}>{['Returned to class', 'Sent home', 'Referred to physician', 'Sent to hospital'].map((item) => <option key={item}>{item}</option>)}</select></label>
            </div>
            <label>Treatment and care provided *<textarea value={treatment} onChange={(event) => setTreatment(event.target.value)} maxLength={300} placeholder="Record the care provided." required disabled={saving} /></label>
            <div className="dispensation-list">
              <div className="panel-heading"><div><p className="section-kicker">Inventory</p><h4>Items dispensed</h4></div><button type="button" className="secondary-btn" onClick={() => setDispensations((items) => [...items, { itemId: '', quantity: '1' }])} disabled={saving || dispensations.length >= 20}><Plus size={15}/> Add item</button></div>
              {dispensations.map((entry, index) => (
                <div className="two-fields dispensation-row" key={index}>
                  <label>Medication or supply<select value={entry.itemId} onChange={(event) => setDispensations((items) => items.map((item, row) => row === index ? { ...item, itemId: event.target.value } : item))} disabled={saving}>
                    <option value="">None</option>
                    {inventoryItems.map((item) => <option key={item.id} value={item.id} disabled={!['medication', 'supply'].includes(item.itemType) || item.quantity < 1 || Boolean(item.expiryDate && item.expiryDate < clinicToday)}>{item.name} · {item.itemType ? (item.itemType === 'medication' ? 'Medication' : 'Supply') : 'Unclassified'} · {item.quantity} {item.unit} left</option>)}
                  </select></label>
                  <label>Quantity<input type="number" min="1" max="100" step="1" value={entry.quantity} onChange={(event) => setDispensations((items) => items.map((item, row) => row === index ? { ...item, quantity: event.target.value } : item))} disabled={saving || !entry.itemId} /></label>
                  {dispensations.length > 1 && <button type="button" className="icon-btn-small danger" aria-label={`Remove item row ${index + 1}`} onClick={() => setDispensations((items) => items.filter((_, row) => row !== index))} disabled={saving}><Trash2 size={14}/></button>}
                </div>
              ))}
              <p className="field-hint">Unclassified, expired, archived, and out-of-stock items are unavailable until corrected.</p>
            </div>
            <span className="field-label">Optional treatment prompts</span>
            <div className="chip-row">
              {treatmentPrompts.map((item) => <button type="button" key={item} onClick={() => setTreatment((current) => current ? `${current}${current.endsWith('.') ? '' : '.'} ${item}` : item)} disabled={saving}>{item}</button>)}
            </div>
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
            <button type="button" className="secondary-btn" onClick={generateSummary} disabled={!complaint || saving}>Generate summary draft</button>
            {summaryDraft && <div className="risk-result"><strong>Review AI-assisted draft</strong><textarea value={summaryDraft} onChange={(event) => { setSummaryDraft(event.target.value); setSummaryApproved(false); }} />{user?.role === 'school_nurse' ? <label className="check-label"><input type="checkbox" checked={summaryApproved} onChange={(event) => setSummaryApproved(event.target.checked)} /> I reviewed and approve this summary for the record</label> : <small>A school nurse must approve this draft before it can be saved to the record.</small>}<small>Provider: {summaryMeta?.provider}. The risk score is calculated separately and is never controlled by AI.</small></div>}
          </FormStep>
          <div className="form-actions">
            <div className="follow-up-control">
              <label className="check-label"><input type="checkbox" checked={followUp} onChange={(e) => { setFollowUp(e.target.checked); if (!e.target.checked) setFollowUpDate(""); }} /> Schedule follow-up</label>
              {followUp && <label className="follow-up-date-field">Follow-up due date
                <input type="date" value={followUpDate} min={clinicToday} onChange={(e) => setFollowUpDate(e.target.value)} required />
              </label>}
            </div>
            <button className="primary-btn" onClick={save} disabled={saving}>
              <ClipboardPlus size={16} /> {saving ? 'Saving visit…' : 'Save visit'}
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
