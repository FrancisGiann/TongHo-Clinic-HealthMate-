import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowUpRight, Check, ChevronDown, ClipboardPlus, Plus, RefreshCw, Trash2 } from "lucide-react";
import { api } from "../utils/api";
import StudentPicker from "../components/StudentPicker";
import { clearPendingVisitSubmission, getPendingVisitSubmission, rememberPendingVisitSubmission } from "../utils/visitSubmission";
import { riskRuleStatusLabel } from "../utils/riskRules";

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

function newEventId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  throw new Error('This browser cannot create a secure arrival request id. Use a supported browser and try again.');
}

function guardianEmailMessage(summary, subject) {
  if (summary?.deliveryUnavailable) return `${subject} was recorded, but email delivery status could not be confirmed.`;
  if (!summary?.recipientCount) return `${subject} was recorded; no active linked guardian email was available.`;
  if (summary.emailFailedCount === 0 && summary.emailSentCount === summary.recipientCount) {
    return `${subject} was recorded; email sent to ${summary.recipientCount} linked guardian${summary.recipientCount === 1 ? '' : 's'}.`;
  }
  if (summary.emailSentCount > 0) {
    const details = [
      summary.emailFailedCount ? `${summary.emailFailedCount} failed` : '',
      summary.emailPendingCount ? `${summary.emailPendingCount} pending or status unknown` : '',
    ].filter(Boolean).join('; ');
    return `${subject} was recorded; email sent to ${summary.emailSentCount} of ${summary.recipientCount} linked guardians${details ? `; ${details}` : ''}.`;
  }
  if (summary.emailPendingCount) {
    const failure = summary.emailFailedCount ? ` ${summary.emailFailedCount} failed;` : '';
    return `${subject} was recorded;${failure} email status is pending or unknown for ${summary.emailPendingCount} linked guardian${summary.emailPendingCount === 1 ? '' : 's'}.`;
  }
  return `${subject} was recorded, but email failed for ${summary.emailFailedCount} linked guardian${summary.emailFailedCount === 1 ? '' : 's'}.`;
}

function clinicDateTimeLabel(value) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short',
  }).format(date);
}

function validDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function inventoryAvailability(item, today) {
  const reasons = [];
  if (item.archived) reasons.push({ text: 'Archived.', action: 'Show archived items', to: '/inventory?archived=1' });
  if (!['medication', 'supply'].includes(item.itemType)) reasons.push({ text: 'Item type is unclassified.', action: 'Review item type', to: `/inventory?edit=${encodeURIComponent(item.id)}` });
  if (!Number.isInteger(Number(item.quantity)) || Number(item.quantity) < 1) reasons.push({ text: 'Out of stock.', action: 'Restock item', to: `/inventory?restock=${encodeURIComponent(item.id)}` });
  if (item.expiryDate && !validDateKey(String(item.expiryDate))) reasons.push({ text: 'Expiry date is invalid.', action: 'Edit expiry date', to: `/inventory?edit=${encodeURIComponent(item.id)}` });
  else if (item.expiryDate && item.expiryDate < today) reasons.push({ text: `Expired ${item.expiryDate}.`, action: 'Review expiry date', to: `/inventory?edit=${encodeURIComponent(item.id)}` });
  return reasons;
}

export default function NewVisit({ data, user, refreshInBackground }) {
  const location = useLocation();
  const initialPendingSubmission = getPendingVisitSubmission(user?.id);
  const initialDraft = initialPendingSubmission?.payload || {};
  const initialPatientId = String(initialPendingSubmission?.patientId || location.state?.selectedStudent?.id || "");
  const [selectedId, setSelectedId] = useState(initialPatientId);
  const [complaint, setComplaint] = useState(initialDraft.chiefComplaint || "");
  const [visitType, setVisitType] = useState(initialDraft.visitType || "Illness");
  const [treatment, setTreatment] = useState(initialDraft.treatment || "");
  const [disposition, setDisposition] = useState(initialDraft.disposition || "Returned to class");
  const [dispensations, setDispensations] = useState(initialDraft.dispensations?.length ? initialDraft.dispensations.map((entry) => ({ itemId: String(entry.itemId), quantity: String(entry.quantity) })) : [{ itemId: "", quantity: "1" }]);
  const [followUp, setFollowUp] = useState(Boolean(initialDraft.followUp));
  const [followUpDate, setFollowUpDate] = useState(initialDraft.followUpDate || "");
  const [temperature, setTemperature] = useState(initialDraft.temperature == null ? "" : String(initialDraft.temperature));
  const [pulse, setPulse] = useState(initialDraft.pulse == null ? "" : String(initialDraft.pulse));
  const [notes, setNotes] = useState(initialDraft.notes || "");
  const [painScore, setPainScore] = useState(initialDraft.painScore == null ? "" : String(initialDraft.painScore));
  const [clinicianRedFlag, setClinicianRedFlag] = useState(initialDraft.clinicianRedFlagAssessed ? String(Boolean(initialDraft.clinicianRedFlag)) : "");
  const [riskAcknowledgement, setRiskAcknowledgement] = useState(initialDraft.riskAcknowledgement || "");
  const [riskResult, setRiskResult] = useState(null);
  const [saveError, setSaveError] = useState("");
  const [summaryDraft, setSummaryDraft] = useState(initialDraft.summaryDraft || "");
  const [summaryMeta, setSummaryMeta] = useState(null);
  const [summaryApproved, setSummaryApproved] = useState(Boolean(initialDraft.summaryApproved));
  const [saved, setSaved] = useState(false);
  const [saveOutcomeUnknown, setSaveOutcomeUnknown] = useState(() => Boolean(initialPendingSubmission?.outcomeUnknown));
  const [visitRequestConflict, setVisitRequestConflict] = useState(false);
  const [guardianNotification, setGuardianNotification] = useState(null);
  const [saving, setSaving] = useState(false);
  const [arrivalSaving, setArrivalSaving] = useState(false);
  const [arrivalResult, setArrivalResult] = useState(null);
  const [arrivalError, setArrivalError] = useState('');
  const [inventoryRefreshing, setInventoryRefreshing] = useState(false);
  const [inventoryRefreshMessage, setInventoryRefreshMessage] = useState("");
  const [inventoryRefreshError, setInventoryRefreshError] = useState("");
  const inventoryRecoveryPending = useRef(false);
  const inventoryRefreshLock = useRef(false);
  const selectedPatientIdRef = useRef(initialPatientId);
  const arrivalRequestRef = useRef(null);
  const arrivalLock = useRef(false);
  const visitSubmissionRef = useRef(initialPendingSubmission);
  const saveRecoveryRef = useRef(null);
  const clinicToday = clinicDate(new Date());
  const selected = data.students.find((student) => String(student.id) === selectedId);
  const resetDraftFields = () => {
    setComplaint('');
    setVisitType('Illness');
    setTreatment('');
    setDisposition('Returned to class');
    setDispensations([{ itemId: '', quantity: '1' }]);
    setFollowUp(false);
    setFollowUpDate('');
    setTemperature('');
    setPulse('');
    setNotes('');
    setPainScore('');
    setClinicianRedFlag('');
    setRiskAcknowledgement('');
    setRiskResult(null);
    setSummaryDraft('');
    setSummaryMeta(null);
    setSummaryApproved(false);
  };
  const changeSelectedPatient = (value) => {
    const nextId = String(value || '');
    const priorRequest = visitSubmissionRef.current;
    selectedPatientIdRef.current = nextId;
    arrivalRequestRef.current = null;
    visitSubmissionRef.current = priorRequest?.requestId && !priorRequest.outcomeUnknown
      ? { ...priorRequest, patientId: nextId, payload: { patientId: nextId } }
      : null;
    if (visitSubmissionRef.current) rememberPendingVisitSubmission(user?.id, visitSubmissionRef.current);
    else clearPendingVisitSubmission(user?.id);
    setSaveOutcomeUnknown(false);
    setVisitRequestConflict(false);
    setSaved(false);
    setSaveError('');
    setGuardianNotification(null);
    setArrivalResult(null);
    setArrivalError('');
    setSelectedId(nextId);
    resetDraftFields();
  };
  const recordArrival = async () => {
    if (!selected || selected.patientType !== 'student' || user?.role !== 'school_nurse' || saving || arrivalLock.current) return;
    const patientId = String(selected.id);
    if (!arrivalRequestRef.current || arrivalRequestRef.current.patientId !== patientId) {
      try {
        arrivalRequestRef.current = { patientId, eventId: newEventId() };
      } catch (error) {
        setArrivalError(error.message);
        return;
      }
    }
    const { eventId } = arrivalRequestRef.current;
    arrivalLock.current = true;
    setArrivalSaving(true);
    setArrivalError('');
    try {
      const result = await api.post('/api/visits/arrivals', { patientId, eventId });
      if (selectedPatientIdRef.current === patientId) setArrivalResult(result);
    } catch (error) {
      if (selectedPatientIdRef.current === patientId) setArrivalError(error.message || 'Arrival status could not be confirmed. Check status to safely retry.');
    } finally {
      arrivalLock.current = false;
      if (selectedPatientIdRef.current === patientId) setArrivalSaving(false);
    }
  };
  const canAcknowledgeMissingTemperature = riskResult?.decisionSupportMode === 'conservative_triage_v1'
    && riskResult?.status === 'incomplete'
    && riskResult?.missingFields?.length === 1
    && riskResult.missingFields[0] === 'temperature';
  const inventoryItems = data.inventory || [];
  const eligibleInventoryItems = inventoryItems.filter((item) => inventoryAvailability(item, clinicToday).length === 0);
  const unavailableInventoryItems = inventoryItems
    .map((item) => ({ item, reasons: inventoryAvailability(item, clinicToday) }))
    .filter(({ reasons }) => reasons.length > 0);
  const refreshInventory = useCallback(async () => {
    if (inventoryRefreshLock.current) return false;
    inventoryRefreshLock.current = true;
    setInventoryRefreshing(true);
    setInventoryRefreshMessage("");
    setInventoryRefreshError("");
    try {
      if (typeof refreshInBackground !== "function") {
        throw new Error("Inventory refresh is unavailable. Try again after the clinic data has loaded.");
      }
      const refreshed = await refreshInBackground();
      if (!refreshed) throw new Error("Clinic data changed during refresh. Please try again.");
      setInventoryRefreshMessage("Inventory refreshed. Your visit draft is still here.");
      return true;
    } catch (error) {
      setInventoryRefreshError(error.message || "Inventory could not be refreshed. Please try again.");
      return false;
    } finally {
      inventoryRefreshLock.current = false;
      setInventoryRefreshing(false);
    }
  }, [refreshInBackground]);
  const noteInventoryRecovery = useCallback(() => {
    inventoryRecoveryPending.current = true;
    setInventoryRefreshMessage("");
    setInventoryRefreshError("");
  }, []);

  useEffect(() => {
    const refreshAfterInventoryReturn = () => {
      if (!inventoryRecoveryPending.current || document.visibilityState !== "visible") return;
      inventoryRecoveryPending.current = false;
      void refreshInventory();
    };
    window.addEventListener("focus", refreshAfterInventoryReturn);
    document.addEventListener("visibilitychange", refreshAfterInventoryReturn);
    return () => {
      window.removeEventListener("focus", refreshAfterInventoryReturn);
      document.removeEventListener("visibilitychange", refreshAfterInventoryReturn);
    };
  }, [refreshInventory]);
  useEffect(() => {
    if (saveOutcomeUnknown || saved || visitRequestConflict) saveRecoveryRef.current?.focus();
  }, [saveOutcomeUnknown, saved, visitRequestConflict]);
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
  const submitVisitRequest = async (submission) => {
    const pending = { ...submission, outcomeUnknown: true };
    visitSubmissionRef.current = pending;
    rememberPendingVisitSubmission(user?.id, pending);
    setSaving(true);
    setSaveError('');
    try {
      const result = await api.post('/api/visits', { ...submission.payload, requestId: submission.requestId });
      clearPendingVisitSubmission(user?.id);
      visitSubmissionRef.current = null;
      setSaveOutcomeUnknown(false);
      setVisitRequestConflict(false);
      setRiskResult(result.assessment);
      setGuardianNotification(result.guardianNotification || null);
      setSaved(true);
      try {
        const refreshed = await refreshInBackground?.();
        if (!refreshed) setSaveError('Visit saved, but the clinic list could not refresh. Reload the page to see the latest activity.');
      } catch {
        setSaveError('Visit saved, but the clinic list could not refresh. Reload the page to see the latest activity.');
      }
    } catch (error) {
      const outcomeUnknown = !error.status || error.status === 408 || error.status >= 500 || error.code === 'VISIT_REQUEST_CONFLICT';
      if (outcomeUnknown) {
        const unresolved = { ...submission, outcomeUnknown: true };
        visitSubmissionRef.current = unresolved;
        rememberPendingVisitSubmission(user?.id, unresolved);
        setSaveOutcomeUnknown(true);
        setVisitRequestConflict(error.code === 'VISIT_REQUEST_CONFLICT');
      } else {
        const editableDraft = { ...submission, outcomeUnknown: false };
        visitSubmissionRef.current = editableDraft;
        rememberPendingVisitSubmission(user?.id, editableDraft);
        setSaveOutcomeUnknown(false);
        setVisitRequestConflict(false);
      }
      setSaveError(error.message || 'The visit could not be saved. Review the form and try again.');
    } finally {
      setSaving(false);
    }
  };
  const startAnotherVisit = () => {
    clearPendingVisitSubmission(user?.id);
    visitSubmissionRef.current = null;
    setSaveOutcomeUnknown(false);
    setVisitRequestConflict(false);
    setSaved(false);
    setSaveError('');
    setGuardianNotification(null);
    arrivalRequestRef.current = null;
    arrivalLock.current = false;
    setArrivalResult(null);
    setArrivalError('');
    resetDraftFields();
  };
  const save = async (event) => {
    event?.preventDefault();
    if (saving || arrivalSaving) return;
    if (visitSubmissionRef.current?.outcomeUnknown) {
      if (visitRequestConflict) return;
      await submitVisitRequest(visitSubmissionRef.current);
      return;
    }
    setSaved(false);
    setGuardianNotification(null);
    if (!selected) return setSaveError('Select a patient before saving the visit.');
    if (!complaint.trim()) return setSaveError('Enter a chief complaint before saving the visit.');
    if (!treatment.trim()) return setSaveError('Enter the treatment or care provided before saving the visit.');
    const chosenDispensations = dispensations.filter((entry) => entry.itemId || entry.quantity !== '1');
    const dispensedIds = new Set();
    for (const entry of chosenDispensations) {
      const quantity = Number(entry.quantity);
      if (!entry.itemId || !Number.isInteger(quantity) || quantity < 1 || quantity > 100) return setSaveError('Choose an inventory item and enter a whole-number quantity from 1 to 100.');
      if (dispensedIds.has(entry.itemId)) return setSaveError('Choose each inventory item only once.');
      dispensedIds.add(entry.itemId);
      const item = eligibleInventoryItems.find((record) => String(record.id) === String(entry.itemId));
      if (!item) return setSaveError('An item in this visit is no longer available. Review the inventory selection before saving.');
      if (quantity > Number(item.quantity)) return setSaveError(`${item.name} has only ${item.quantity} ${item.unit} available.`);
    }
    if (followUp && !followUpDate) return setSaveError('Choose a follow-up date before saving the visit.');
    if (followUp && followUpDate < clinicToday) return setSaveError('Follow-up date must be today or later.');
    setSaveError("");
    setSaving(true);
    try {
      const preview = await api.post('/api/risk/assess', {
        painScore: painScore === "" ? null : Number(painScore),
        clinicianRedFlag: clinicianRedFlag === "" ? null : clinicianRedFlag === "true",
        recentVisitCount: data.visits.filter((visit) => String(visit.studentId || visit.patientId) === String(selected.id)).length,
        temperature: temperature === "" ? null : Number(temperature),
        pulse: pulse === "" ? null : Number(pulse),
      });
      setRiskResult(preview);
      const missingWarningScreen = preview.missingFields?.some((field) => ['clinicianRedFlag', 'validClinicianRedFlag'].includes(field));
      if (preview.status === 'incomplete' && missingWarningScreen) {
        setSaveError('Complete the clinician warning-sign screen before saving. Select “No warning sign observed” only after assessing the student.');
        setSaving(false);
        return;
      }
      const canAcknowledgeIncomplete = preview.decisionSupportMode === 'conservative_triage_v1'
        && preview.status === 'incomplete'
        && preview.missingFields?.length === 1
        && preview.missingFields[0] === 'temperature';
      if (preview.status === 'incomplete' && !canAcknowledgeIncomplete) {
        setSaveError(preview.rationale);
        setSaving(false);
        return;
      }
      const requiresNurseReview = preview.category === 'high' || preview.priority === 'requires-review' || preview.status === 'incomplete';
      if (requiresNurseReview && !riskAcknowledgement.trim()) {
        setSaveError('Document the nurse review and action before saving this assessment.');
        setSaving(false);
        return;
      }
    } catch (error) {
      setSaveError(error.message);
      setSaving(false);
      return;
    }
    const payload = {
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
        clinicianRedFlag: clinicianRedFlag === "" ? null : clinicianRedFlag === "true",
        clinicianRedFlagAssessed: clinicianRedFlag !== "",
        riskAcknowledgement: riskAcknowledgement.trim(),
        notes,
        summaryDraft: summaryDraft.trim(),
        summaryApproved,
    };
    let requestId = visitSubmissionRef.current?.requestId;
    try {
      requestId ||= newEventId();
    } catch (error) {
      setSaveError(error.message);
      setSaving(false);
      return;
    }
    await submitVisitRequest({ patientId: String(selected.id), requestId, payload });
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
        <form className="panel form-panel" onSubmit={save}>
          {(saveOutcomeUnknown || saved) && (
            <div ref={saveRecoveryRef} tabIndex={-1} className={`visit-save-recovery ${visitRequestConflict ? 'is-error' : saved ? 'is-success' : ''}`} role={visitRequestConflict || saveOutcomeUnknown ? 'alert' : 'status'}>
              {visitRequestConflict ? (
                <>
                  <strong>This visit request conflicts with a saved record.</strong>
                  <p>Review the patient history before starting a separate visit.</p>
                  {selected && <Link to={`/students/${encodeURIComponent(selected.id)}`}>Review patient history</Link>}
                  <button type="button" className="secondary-btn" onClick={startAnotherVisit}>Start another visit</button>
                </>
              ) : saved ? (
                <>
                  <strong>Visit saved to today’s activity.</strong>
                  {guardianNotification && !guardianNotification.skipped && <p>{guardianEmailMessage(guardianNotification, 'Care summary')}</p>}
                  <button type="button" className="secondary-btn" onClick={startAnotherVisit}>Start another visit</button>
                </>
              ) : (
                <>
                  <strong>We couldn’t confirm whether this visit saved.</strong>
                  <p>Retry the same visit to safely check its status. The saved draft is locked while the result is uncertain.</p>
                  {selected && <Link to={`/students/${encodeURIComponent(selected.id)}`}>Review patient history</Link>}
                </>
              )}
            </div>
          )}
          <fieldset className="visit-inputs" disabled={saving || saved || saveOutcomeUnknown}>
            <legend className="sr-only">Visit information</legend>
          <FormStep number="01" title="Select patient">
            <StudentPicker students={data.students} value={selectedId} onChange={changeSelectedPatient} label="Patient" required disabled={saving || arrivalSaving || saved || saveOutcomeUnknown} />
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
                    {selected.patientType === 'faculty' ? selected.facultyId || selected.studentId : `${selected.studentId} · ${selected.gradeLevel || 'Student'}`}
                  </span>
                </div>
                <Check size={18} aria-hidden="true" />
              </div>
            )}
            {selected && <div className="selected-allergies"><strong>Allergies</strong><p>{selected.allergies?.trim() || 'None recorded'}</p></div>}
            {selected?.patientType === 'student' && user?.role === 'school_nurse' && (
              <div className="arrival-action-panel">
                <button type="button" className="secondary-btn" onClick={recordArrival} disabled={arrivalSaving || saving || saved || saveOutcomeUnknown || Boolean(arrivalResult)}>
                  {arrivalSaving ? 'Recording arrival…' : arrivalError ? 'Check arrival status' : arrivalResult ? 'Arrival recorded' : 'Record arrival & notify guardian'}
                </button>
                {arrivalError && <p className="error-banner" role="alert">{arrivalError}</p>}
                {arrivalResult && (
                  <p className="success-message" role="status">
                    {arrivalResult.alreadyRecorded ? 'Arrival was already recorded. ' : ''}
                    {clinicDateTimeLabel(arrivalResult.arrival?.occurredAt) && `Recorded ${clinicDateTimeLabel(arrivalResult.arrival.occurredAt)}. `}
                    {guardianEmailMessage(arrivalResult.notification, 'Arrival')}
                  </p>
                )}
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
              <div className="panel-heading"><div><p className="section-kicker">Inventory</p><h4>Items dispensed</h4></div><button type="button" className="secondary-btn" onClick={() => setDispensations((items) => [...items, { itemId: '', quantity: '1' }])} disabled={saving || dispensations.length >= 20 || eligibleInventoryItems.length <= new Set(dispensations.map((item) => item.itemId).filter(Boolean)).size}><Plus size={15}/> Add item</button></div>
              {!eligibleInventoryItems.length ? (
                <div className="inventory-empty-state" id="inventory-eligibility-help" role="status">
                  <p>{inventoryItems.length ? 'No inventory items are currently eligible to dispense.' : 'No inventory items have been added yet.'}</p>
                  <span>{inventoryItems.length ? 'Review each item’s status below, or add a new classified item.' : 'Add a medication or supply in Inventory before recording it here.'}</span>
                  <Link className="secondary-btn inventory-new-tab-link" to="/inventory?add=1" target="_blank" rel="noopener noreferrer" onClick={noteInventoryRecovery}><Plus size={15} /> Add inventory item <ArrowUpRight size={14} aria-hidden="true" /><span className="sr-only">Opens in a new tab</span></Link>
                </div>
              ) : <p className="field-hint" id="inventory-eligibility-help">Only active, classified items with stock available and a valid, current expiry date can be dispensed.</p>}
              <div className="inventory-refresh-control">
                <button type="button" className="secondary-btn" onClick={refreshInventory} disabled={inventoryRefreshing || saving} aria-describedby="inventory-refresh-status">
                  <RefreshCw size={15} aria-hidden="true" className={inventoryRefreshing ? "spin-icon" : ""} /> {inventoryRefreshing ? "Refreshing inventory…" : "Refresh inventory"}
                </button>
                <span id="inventory-refresh-status" className="sr-only">
                  {inventoryRefreshing ? "Refresh in progress." : "Refreshes clinic inventory without leaving this visit."}
                </span>
                {inventoryRefreshMessage && <p className="success-message" role="status">{inventoryRefreshMessage}</p>}
                {inventoryRefreshError && <div className="error-banner" role="alert">{inventoryRefreshError}</div>}
              </div>
              {dispensations.map((entry, index) => (
                <div className="two-fields dispensation-row" key={index}>
                  <label>Medication or supply<select aria-describedby="inventory-eligibility-help" value={entry.itemId} onChange={(event) => setDispensations((items) => items.map((item, row) => row === index ? { ...item, itemId: event.target.value } : item))} disabled={saving || !eligibleInventoryItems.length}>
                    <option value="">None</option>
                    {eligibleInventoryItems.filter((item) => !dispensations.some((other, row) => row !== index && String(other.itemId) === String(item.id))).map((item) => <option key={item.id} value={item.id}>{item.name} · {item.itemType === 'medication' ? 'Medication' : 'Supply'} · {item.quantity} {item.unit} left</option>)}
                  </select></label>
                  <label>Quantity<input type="number" min="1" max={Math.min(100, Number(eligibleInventoryItems.find((item) => String(item.id) === String(entry.itemId))?.quantity || 100))} step="1" value={entry.quantity} onChange={(event) => setDispensations((items) => items.map((item, row) => row === index ? { ...item, quantity: event.target.value } : item))} disabled={saving || !entry.itemId} /></label>
                  {dispensations.length > 1 && <button type="button" className="icon-btn-small danger" aria-label={`Remove item row ${index + 1}`} onClick={() => setDispensations((items) => items.filter((_, row) => row !== index))} disabled={saving}><Trash2 size={14}/></button>}
                </div>
              ))}
              {unavailableInventoryItems.length > 0 && <details className="inventory-unavailable-list"><summary>Unavailable inventory items ({unavailableInventoryItems.length})</summary><ul>{unavailableInventoryItems.map(({ item, reasons }) => <li key={item.id}><span><strong>{item.name}</strong> — {reasons.map((reason) => reason.text).join(' ')}</span><Link to={reasons[0].to} target="_blank" rel="noopener noreferrer" onClick={noteInventoryRecovery}>{reasons[0].action}<ArrowUpRight size={13} aria-hidden="true" /><span className="sr-only">Opens in a new tab</span></Link></li>)}</ul></details>}
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
              <label>Clinician warning-sign screen *
                <select value={clinicianRedFlag} onChange={(event) => setClinicianRedFlag(event.target.value)} required disabled={saving}>
                  <option value="">Complete screen before saving…</option>
                  <option value="false">Assessed — no urgent warning sign observed</option>
                  <option value="true">Urgent warning sign observed</option>
                </select>
                <small>Choose after assessing the student. Leaving this unanswered does not mean no warning sign was found. Examples include severe breathing difficulty or blue lips, unresponsiveness or seizure, heavy bleeding or possible shock, high-risk trauma, and poisoning. Examples are not exhaustive; use full age-appropriate triage. See <a href="https://www.who.int/tools/triage" target="_blank" rel="noreferrer">WHO IITT guidance</a>.</small>
              </label>
            </div>
            {(clinicianRedFlag === "true" || riskResult?.category === 'high' || (riskResult?.priority === 'requires-review' && (riskResult?.status !== 'incomplete' || canAcknowledgeMissingTemperature)) || canAcknowledgeMissingTemperature) && <label>Nurse review / acknowledgement<textarea value={riskAcknowledgement} onChange={(event) => setRiskAcknowledgement(event.target.value)} placeholder="Document the review and action taken…" disabled={saving} /></label>}
            <label>
              Notes{" "}
              <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Describe symptoms, observations, and action taken..." />
            </label>
            <button type="button" className="secondary-btn" onClick={generateSummary} disabled={!complaint || saving}>Generate summary draft</button>
            {summaryDraft && <div className="risk-result"><strong>Review summary draft</strong>{summaryMeta?.reviewNotice && <small role="status">{summaryMeta.reviewNotice}</small>}<textarea className="summary-draft-input" aria-label="Visit summary draft" rows="6" value={summaryDraft} onChange={(event) => { setSummaryDraft(event.target.value); setSummaryApproved(false); setSummaryMeta((current) => current ? { ...current, manualEntryRequired: false } : current); }} disabled={saving} />{user?.role === 'school_nurse' ? <label className="check-label"><input type="checkbox" checked={summaryApproved} onChange={(event) => setSummaryApproved(event.target.checked)} disabled={saving || Boolean(summaryMeta?.manualEntryRequired)} /> I reviewed and approve this summary for the record</label> : <small>A school nurse must approve this draft before it can be saved to the record.</small>}<small>Provider: {summaryMeta?.provider}. The risk score is calculated separately and is never controlled by AI.</small></div>}
          </FormStep>
          </fieldset>
          <div className="form-actions visit-save-actions">
            <div className="follow-up-control">
              <label className="check-label"><input type="checkbox" checked={followUp} onChange={(e) => { setFollowUp(e.target.checked); if (!e.target.checked) setFollowUpDate(""); }} disabled={saving || saved || saveOutcomeUnknown} /> Schedule follow-up</label>
              {followUp && <label className="follow-up-date-field">Follow-up due date
                <input type="date" value={followUpDate} min={clinicToday} onChange={(e) => setFollowUpDate(e.target.value)} required disabled={saving || saved || saveOutcomeUnknown} />
              </label>}
            </div>
            <button type="submit" className="primary-btn" disabled={saving || arrivalSaving || saved || visitRequestConflict}>
              <ClipboardPlus size={16} /> {saving ? 'Saving visit…' : saveOutcomeUnknown ? 'Retry same visit' : 'Save visit'}
            </button>
          </div>
          {saveError && <div className="error-banner" role="alert">{saveError}</div>}
          {riskResult && <div className={`risk-result risk-${riskResult.category}`}><strong>{riskResult.priority === 'requires-review' ? 'Nurse review required' : riskResult.priority === 'urgent' ? 'Urgent nurse review required' : `Decision-support result: ${riskResult.category}`}</strong><p>{riskResult.rationale}</p>{riskResult.decisionSupportMode === 'conservative_triage_v1' && <small>No-match remains unclassified and never means low risk or routine disposition. This prompt cannot replace the nurse’s assessment.</small>}<small>{riskResult.disclaimer} {riskResult.ruleName || 'Risk rules'} · {riskRuleStatusLabel(riskResult)}.</small></div>}
        </form>
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
