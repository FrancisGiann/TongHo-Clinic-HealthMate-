import { useState } from "react";
import { Check, ChevronDown, ClipboardPlus, Search } from "lucide-react";
import { addRecord, saveData } from "../db/database";
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

const visitDraftKey = 'healthmate-new-visit-draft';

function loadVisitDraft() {
  try {
    return JSON.parse(localStorage.getItem(visitDraftKey) || 'null');
  } catch {
    localStorage.removeItem(visitDraftKey);
    return null;
  }
}

export default function NewVisit({ data, setData }) {
  const [initialDraft] = useState(loadVisitDraft);
  const [selected, setSelected] = useState(() => data.students.find((student) => student.id === initialDraft?.studentId) || null);
  const [complaint, setComplaint] = useState(initialDraft?.complaint || "");
  const [visitType, setVisitType] = useState(initialDraft?.visitType || "Illness");
  const [treatment, setTreatment] = useState(initialDraft?.treatment || "Rest and hydration");
  const [disposition, setDisposition] = useState(initialDraft?.disposition || "Returned to class");
  const [medicineId, setMedicineId] = useState(initialDraft?.medicineId || "");
  const [followUp, setFollowUp] = useState(Boolean(initialDraft?.followUp));
  const [temperature, setTemperature] = useState(initialDraft?.temperature || "");
  const [pulse, setPulse] = useState(initialDraft?.pulse || "");
  const [notes, setNotes] = useState(initialDraft?.notes || "");
  const [painScore, setPainScore] = useState(initialDraft?.painScore || "");
  const [clinicianRedFlag, setClinicianRedFlag] = useState(Boolean(initialDraft?.clinicianRedFlag));
  const [riskAcknowledgement, setRiskAcknowledgement] = useState(initialDraft?.riskAcknowledgement || "");
  const [riskResult, setRiskResult] = useState(null);
  const [saveError, setSaveError] = useState("");
  const [summaryDraft, setSummaryDraft] = useState("");
  const [summaryMeta, setSummaryMeta] = useState(null);
  const [summaryApproved, setSummaryApproved] = useState(false);
  const [saved, setSaved] = useState(false);
  const [draftSaved, setDraftSaved] = useState(Boolean(initialDraft));

  const saveDraft = () => {
    localStorage.setItem(visitDraftKey, JSON.stringify({
      studentId: selected?.id || null,
      complaint,
      visitType,
      treatment,
      disposition,
      medicineId,
      followUp,
      temperature,
      pulse,
      notes,
      painScore,
      clinicianRedFlag,
      riskAcknowledgement,
    }));
    setDraftSaved(true);
  };
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
    if (!selected || !complaint) return;
    setSaveError("");
    const medicine = medicineId
      ? data.inventory.find((item) => item.id === Number(medicineId))
      : null;
    if (medicine && medicine.quantity < 1) return setSaveError("The selected medicine is out of stock.");
    let assessment;
    try {
      assessment = await api.post('/api/risk/assess', {
        painScore: painScore === "" ? null : Number(painScore),
        clinicianRedFlag,
        recentVisitCount: data.visits.filter((visit) => visit.studentId === selected.id).length,
        temperature: temperature === "" ? null : Number(temperature),
        pulse: pulse === "" ? null : Number(pulse),
      });
    } catch (error) {
      return setSaveError(error.message);
    }
    setRiskResult(assessment);
    if (assessment.status === 'incomplete') return setSaveError(assessment.rationale);
    if (assessment.category === 'high' && !riskAcknowledgement.trim()) {
      return setSaveError('Document the nurse acknowledgement before saving a high-risk assessment.');
    }
    if (summaryDraft && !summaryApproved) return setSaveError('Review and approve the generated summary, or clear it before saving.');
    const visitData = addRecord(data, "visits", {
        studentId: selected.id,
        date: new Date().toISOString().slice(0, 10),
        time: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
        type: visitType,
        chiefComplaint: complaint,
        treatment,
        disposition,
        followUp,
        medicineId: medicineId || null,
        temperature,
        pulse,
        painScore: Number(painScore),
        riskAssessment: assessment,
        riskAcknowledgement: riskAcknowledgement.trim(),
        consultationSummary: summaryApproved ? summaryDraft.trim() : '',
        summaryProvider: summaryApproved ? summaryMeta?.provider : null,
        summaryApprovedBy: summaryApproved ? data.settings.nurseName : null,
        notes,
        nurseName: data.settings.nurseName,
      });
    const nextData = medicineId
      ? {
          ...visitData,
          inventory: visitData.inventory.map((item) => item.id === Number(medicineId) ? { ...item, quantity: item.quantity - 1 } : item),
          dispenseLogs: [...(visitData.dispenseLogs || []), {
            id: Date.now(),
            visitId: visitData.visits[visitData.visits.length - 1].id,
            medicineId: medicine.id,
            medicineName: medicine.name,
            quantity: 1,
            date: new Date().toISOString(),
          }],
        }
      : visitData;
    setData(saveData(nextData));
    localStorage.removeItem(visitDraftKey);
    setDraftSaved(false);
    setSaved(true);
  };
  return (
    <div className="form-page">
      <div className="page-intro">
        <div>
          <p className="section-kicker">Care documentation</p>
          <h2>New visit</h2>
          <p>Capture what happened, clearly and quickly.</p>
        </div>
        <span className="draft-status">{draftSaved ? 'Draft saved on this computer' : 'Unsaved visit'}</span>
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
            <label>Medicine dispensed <select value={medicineId} onChange={(e) => setMedicineId(e.target.value)}><option value="">None</option>{data.inventory.filter((item) => item.quantity > 0).map((item) => <option key={item.id} value={item.id}>{item.name} · {item.quantity} {item.unit} left</option>)}</select></label>
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
            {summaryDraft && <div className="risk-result"><strong>Review AI-assisted draft</strong><textarea value={summaryDraft} onChange={(event) => { setSummaryDraft(event.target.value); setSummaryApproved(false); }} /><label className="check-label"><input type="checkbox" checked={summaryApproved} onChange={(event) => setSummaryApproved(event.target.checked)} /> I reviewed and approve this summary for the record</label><small>Provider: {summaryMeta?.provider}. The risk score is calculated separately and is never controlled by AI.</small></div>}
          </FormStep>
          <div className="form-actions">
            <label className="check-label"><input type="checkbox" checked={followUp} onChange={(e) => setFollowUp(e.target.checked)} /> Schedule follow-up</label>
            <button type="button" className="secondary-btn" onClick={saveDraft}>Save as draft</button>
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
