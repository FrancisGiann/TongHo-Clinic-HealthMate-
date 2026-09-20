import { useState } from "react";
import { Check, ChevronDown, ClipboardPlus, Search } from "lucide-react";
import { addRecord, saveData } from "../db/database";

const complaints = [
  "Headache",
  "Stomachache",
  "Fever",
  "Cough",
  "Wound",
  "Dizziness",
  "Nausea",
];
export default function NewVisit({ data, setData }) {
  const [selected, setSelected] = useState(null);
  const [complaint, setComplaint] = useState("");
  const [visitType, setVisitType] = useState("Illness");
  const [treatment, setTreatment] = useState("Rest and hydration");
  const [disposition, setDisposition] = useState("Returned to class");
  const [medicineId, setMedicineId] = useState("");
  const [followUp, setFollowUp] = useState(false);
  const [temperature, setTemperature] = useState("");
  const [pulse, setPulse] = useState("");
  const [notes, setNotes] = useState("");
  const [saved, setSaved] = useState(false);
  const save = () => {
    if (!selected || !complaint) return;
    const medicine = medicineId
      ? data.inventory.find((item) => item.id === Number(medicineId))
      : null;
    if (medicine && medicine.quantity < 1) return;
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
        <span className="draft-status">● Auto-saving draft</span>
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
            <label>
              Notes{" "}
              <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Describe symptoms, observations, and action taken..." />
            </label>
          </FormStep>
          <div className="form-actions">
            <label className="check-label"><input type="checkbox" checked={followUp} onChange={(e) => setFollowUp(e.target.checked)} /> Schedule follow-up</label>
            <button className="secondary-btn" onClick={() => window.alert("Draft saved locally for this visit.")}>Save as draft</button>
            <button className="primary-btn" onClick={save}>
              <ClipboardPlus size={16} /> Save visit
            </button>
          </div>
          {saved && (
            <p className="success-message">Visit saved to today’s activity.</p>
          )}
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
