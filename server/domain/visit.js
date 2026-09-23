const visitTypes = new Set(['Illness', 'Injury', 'Follow-up', 'Emergency', 'Routine Check']);

function isCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function clinicToday(now) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function boundedText(value, maxLength, { required = false } = {}) {
  if (typeof value !== 'string') return required ? null : '';
  const normalized = value.trim();
  if (required && !normalized) return null;
  return normalized.length <= maxLength ? normalized : null;
}

function optionalNumber(value, { min, max, integer = false } = {}) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max || (integer && !Number.isInteger(number))) return undefined;
  return number;
}

export function validateVisitPayload(payload = {}, { now = new Date() } = {}) {
  const fields = {};
  const patientId = boundedText(String(payload.patientId ?? payload.studentId ?? ''), 120, { required: true });
  const visitType = boundedText(payload.visitType ?? payload.type ?? '', 40, { required: true });
  const chiefComplaint = boundedText(payload.chiefComplaint, 300, { required: true });
  const treatment = boundedText(payload.treatment, 300, { required: true });
  const disposition = boundedText(payload.disposition, 120, { required: true });
  const notes = boundedText(payload.notes, 2000);
  const acknowledgement = boundedText(payload.riskAcknowledgement, 500);
  const followUp = payload.followUp === true;
  const followUpDate = payload.followUpDate === undefined || payload.followUpDate === null || payload.followUpDate === ''
    ? null
    : boundedText(payload.followUpDate, 10);
  const painScore = optionalNumber(payload.painScore, { min: 1, max: 10, integer: true });
  const temperature = optionalNumber(payload.temperature, { min: 30, max: 45 });
  const pulse = optionalNumber(payload.pulse, { min: 20, max: 250, integer: true });
  const medicineId = payload.medicineId === undefined || payload.medicineId === null || payload.medicineId === ''
    ? null
    : boundedText(String(payload.medicineId), 120, { required: true });
  const medicineQuantity = medicineId
    ? optionalNumber(payload.medicineQuantity ?? 1, { min: 1, max: 100, integer: true })
    : 0;

  if (!patientId) fields.patientId = 'Select a valid patient.';
  if (!visitType || !visitTypes.has(visitType)) fields.visitType = 'Select a supported visit type.';
  if (!chiefComplaint) fields.chiefComplaint = 'Enter a chief complaint (up to 300 characters).';
  if (!treatment) fields.treatment = 'Enter the treatment provided (up to 300 characters).';
  if (!disposition) fields.disposition = 'Enter the visit disposition (up to 120 characters).';
  if (notes === null) fields.notes = 'Notes must be 2,000 characters or fewer.';
  if (acknowledgement === null) fields.riskAcknowledgement = 'Acknowledgement must be 500 characters or fewer.';
  if (painScore === undefined || painScore === null) fields.painScore = 'Pain score must be an integer from 1 to 10.';
  if (temperature === undefined) fields.temperature = 'Temperature must be between 30 and 45 °C.';
  if (pulse === undefined) fields.pulse = 'Pulse must be an integer from 20 to 250 bpm.';
  if (medicineId === null && payload.medicineId !== undefined && payload.medicineId !== null && payload.medicineId !== '') fields.medicineId = 'Medicine identifier is invalid.';
  if (medicineQuantity === undefined) fields.medicineQuantity = 'Dispensed quantity must be an integer from 1 to 100.';
  if (payload.followUp !== undefined && typeof payload.followUp !== 'boolean') fields.followUp = 'Follow-up must be true or false.';
  if (followUp && (!followUpDate || !isCalendarDate(followUpDate))) fields.followUpDate = 'Choose a valid follow-up date.';
  else if (followUp && followUpDate < clinicToday(now)) fields.followUpDate = 'Follow-up date must be today or later.';
  if (!followUp && payload.followUpDate !== undefined && payload.followUpDate !== null && payload.followUpDate !== '') {
    fields.followUpDate = 'A follow-up date can only be saved when follow-up is scheduled.';
  }
  if (payload.clinicianRedFlag !== undefined && typeof payload.clinicianRedFlag !== 'boolean') fields.clinicianRedFlag = 'Urgent warning sign must be true or false.';

  const summaryDraft = boundedText(payload.summaryDraft, 2000);
  if (summaryDraft === null) fields.summaryDraft = 'Summary must be 2,000 characters or fewer.';
  if (payload.summaryApproved !== undefined && typeof payload.summaryApproved !== 'boolean') fields.summaryApproved = 'Summary approval must be true or false.';

  if (Object.keys(fields).length) return { valid: false, fields };
  return {
    valid: true,
    value: {
      patientId,
      visitType,
      chiefComplaint,
      treatment,
      disposition,
      followUp,
      ...(followUp ? { followUpDate } : {}),
      painScore,
      temperature,
      pulse,
      clinicianRedFlag: Boolean(payload.clinicianRedFlag),
      riskAcknowledgement: acknowledgement,
      medicineId,
      medicineQuantity,
      notes,
      summaryDraft,
      summaryApproved: Boolean(payload.summaryApproved),
    },
  };
}

export function visitRiskInput(visit, recentVisitCount) {
  return {
    painScore: visit.painScore,
    clinicianRedFlag: visit.clinicianRedFlag,
    recentVisitCount,
    temperature: visit.temperature,
    pulse: visit.pulse,
  };
}

export function riskPriority(category) {
  return ({ high: 3, moderate: 2, low: 1 })[category] || 0;
}

export function validateQueueTriage(payload = {}) {
  const triagePriority = String(payload.triagePriority || 'unclassified').trim().toLowerCase();
  const triageReason = String(payload.triageReason || '').trim();
  if (!['unclassified', 'low', 'moderate', 'high'].includes(triagePriority)) return { valid: false, message: 'Choose a valid triage priority.' };
  if (triagePriority !== 'unclassified' && (!triageReason || triageReason.length > 240)) return { valid: false, message: 'Add a concise triage reason of 1–240 characters.' };
  return {
    valid: true,
    value: {
      triagePriority,
      triageReason: triagePriority === 'unclassified' ? '' : triageReason,
      prioritySource: triagePriority === 'unclassified' ? 'unclassified' : 'nurse_triage',
    },
  };
}

export function sortQueueEntries(entries = []) {
  return [...entries].sort((left, right) => {
    const priorityDifference = Number(right.priority || 0) - Number(left.priority || 0);
    if (priorityDifference) return priorityDifference;
    const leftArrival = new Date(left.arrivalAt || left.createdAt || 0).getTime();
    const rightArrival = new Date(right.arrivalAt || right.createdAt || 0).getTime();
    return leftArrival - rightArrival;
  });
}

export function queueStatusConflict(_currentStatus, nextStatus, hasOtherActiveEntry) {
  return nextStatus !== 'Released' && Boolean(hasOtherActiveEntry);
}
