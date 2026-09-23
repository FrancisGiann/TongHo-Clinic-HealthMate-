import { useMemo, useState } from "react";
import { Check, Plus, RotateCcw, Search } from "lucide-react";
import { api } from "../utils/api";
import { useNavigate } from "react-router-dom";

const statuses = ["Waiting", "Being Seen", "Treated", "Released"];
const priorityLabels = { 3: "Urgent", 2: "Priority", 1: "Routine", 0: "Unclassified" };
const priorityLabel = (priority) => {
  const value = Number(priority);
  return value >= 3 ? "Urgent" : priorityLabels[value] || "Unclassified";
};

export default function Queue({ data, reload }) {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [patientId, setPatientId] = useState("");
  const [triagePriority, setTriagePriority] = useState("unclassified");
  const [triageReason, setTriageReason] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const patients = useMemo(() => data.students || [], [data.students]);
  const queue = useMemo(() => {
    const normalized = (data.queue || []).map((entry) => ({
      ...entry,
      status: entry.status || "Waiting",
      patient: patients.find((student) => String(student.id) === String(entry.patientId || entry.studentId)) || entry.patient || {},
    }));
    return normalized
      .filter((entry) => !search || `${entry.patient.name || ""} ${entry.patient.studentId || ""} ${entry.patientId || ""}`.toLowerCase().includes(search.toLowerCase()))
      .sort((left, right) => Number(right.priority || 0) - Number(left.priority || 0) || new Date(left.arrivalAt || left.createdAt || 0) - new Date(right.arrivalAt || right.createdAt || 0));
  }, [data.queue, patients, search]);
  const activeCount = (data.queue || []).filter((entry) => entry.status !== "Released").length;

  const addToQueue = async (event) => {
    event.preventDefault();
    if (!patientId) return setError("Select a patient before adding them to the queue.");
    if (triagePriority !== "unclassified" && !triageReason.trim()) return setError("Add a concise triage reason for the selected priority.");
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await api.post("/api/queue", { patientId, triagePriority, triageReason });
      setMessage("Patient added to the queue.");
      setPatientId("");
      setTriagePriority("unclassified");
      setTriageReason("");
      await reload?.();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (entry) => {
    const index = statuses.indexOf(entry.status);
    const status = entry.status === "Released" ? "Waiting" : statuses[Math.min(index + 1, statuses.length - 1)];
    setError("");
    try {
      await api.patch(`/api/queue/${encodeURIComponent(entry.id)}`, { status });
      await reload?.();
    } catch (requestError) {
      setError(requestError.message);
    }
  };

  return (
    <div className="form-page">
      <div className="page-intro">
        <div><h2>Walk-in queue <span className="soft-count">{activeCount} active</span></h2><p>Prioritized by nurse triage context, then arrival time. Add a patient only when they are physically at the clinic.</p></div>
        <button className="secondary-btn" onClick={() => navigate('/new-visit')}><Plus size={16} /> New visit</button>
      </div>
      <form className="panel inline-entry-form" onSubmit={addToQueue}>
        <div className="two-fields">
          <label>Add patient<select value={patientId} onChange={(event) => setPatientId(event.target.value)} required><option value="">Choose a registered patient</option>{patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.name} · {patient.studentId}</option>)}</select></label>
          <label>Triage priority<select value={triagePriority} onChange={(event) => setTriagePriority(event.target.value)}><option value="unclassified">Unclassified</option><option value="low">Routine</option><option value="moderate">Priority</option><option value="high">Urgent</option></select></label>
        </div>
        {triagePriority !== "unclassified" && <label>Triage reason<textarea value={triageReason} onChange={(event) => setTriageReason(event.target.value)} maxLength={240} placeholder="Briefly document the observed reason for this priority." required /></label>}
        <div className="form-actions"><button className="primary-btn" disabled={saving || !patients.length}><Plus size={16} /> {saving ? "Adding…" : "Add to queue"}</button><span className="field-hint">Priority is a nurse triage context; the saved visit risk result is calculated separately.</span></div>
        {message && <p className="success-message" role="status">{message}</p>}
        {error && <div className="error-banner" role="alert">{error}</div>}
      </form>
      <section className="panel queue-panel">
        <div className="panel-heading"><div><h3>Patients in clinic</h3><p className="field-hint">Urgent and priority patients remain at the top.</p></div><div className="search-box compact"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name or ID" aria-label="Search queue" /></div></div>
        {queue.map((entry) => <div className="queue-row" key={entry.id}>
          <div className={`queue-status-dot status-${String(entry.status || "Waiting").toLowerCase().replaceAll(" ", "-")}`} aria-hidden="true" />
          <div className="queue-student"><strong>{entry.patient.name || entry.patientId}</strong><span>{entry.patient.gradeLevel || "Registered patient"} · Arrived {entry.arrivalAt ? new Date(entry.arrivalAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}</span></div>
          <span className={`status-chip ${Number(entry.priority) >= 3 ? "danger" : Number(entry.priority) === 2 ? "warn" : "neutral"}`}>{priorityLabel(entry.priority)}</span>
          <span className="status-chip neutral">{entry.status}</span>
          <button className="secondary-btn queue-action" onClick={() => updateStatus(entry)}>{entry.status === "Released" ? <RotateCcw size={14} /> : <Check size={14} />} {entry.status === "Released" ? "Reopen" : "Advance"}</button>
        </div>)}
        {!queue.length && <div className="empty-state">{search ? "No queue entries match that search." : "The queue is empty. Add a patient when they arrive."}</div>}
      </section>
    </div>
  );
}
