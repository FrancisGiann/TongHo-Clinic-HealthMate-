const visitTypes = new Set(['Illness', 'Injury', 'Follow-up', 'Emergency', 'Routine Check']);

function isCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function clinicCalendarDate(value) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function clinicToday(now) {
  return clinicCalendarDate(now);
}

function boundedText(value, maxLength, { required = false } = {}) {
  if (typeof value !== 'string') return required ? null : '';
  const normalized = value.trim();
  if (required && !normalized) return null;
  return normalized.length <= maxLength ? normalized : null;
}

function optionalNumber(value, { min, max, integer = false } = {}) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
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
  const hasDispensations = Object.prototype.hasOwnProperty.call(payload, 'dispensations');
  const dispensations = hasDispensations
    ? payload.dispensations
    : medicineId ? [{ itemId: medicineId, quantity: medicineQuantity }] : [];

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
  if (hasDispensations && medicineId) fields.dispensations = 'Use either the item list or the legacy medicine fields, not both.';
  if (!Array.isArray(dispensations) || dispensations.length > 20) fields.dispensations = 'Choose up to 20 inventory items to dispense.';
  else {
    const itemIds = new Set();
    for (const entry of dispensations) {
      const itemId = boundedText(String(entry?.itemId ?? entry?.inventoryItemId ?? ''), 120, { required: true });
      const quantity = optionalNumber(entry?.quantity, { min: 1, max: 100, integer: true });
      if (!itemId || quantity === undefined || quantity === null) {
        fields.dispensations = 'Each dispensed item needs a valid inventory item and a whole-number quantity from 1 to 100.';
        break;
      }
      if (itemIds.has(itemId)) {
        fields.dispensations = 'Each inventory item can appear only once in the dispense list.';
        break;
      }
      itemIds.add(itemId);
    }
  }
  if (payload.followUp !== undefined && typeof payload.followUp !== 'boolean') fields.followUp = 'Follow-up must be true or false.';
  if (followUp && (!followUpDate || !isCalendarDate(followUpDate))) fields.followUpDate = 'Choose a valid follow-up date.';
  else if (followUp && followUpDate < clinicToday(now)) fields.followUpDate = 'Follow-up date must be today or later.';
  if (!followUp && payload.followUpDate !== undefined && payload.followUpDate !== null && payload.followUpDate !== '') {
    fields.followUpDate = 'A follow-up date can only be saved when follow-up is scheduled.';
  }
  if (payload.clinicianRedFlagAssessed !== undefined && typeof payload.clinicianRedFlagAssessed !== 'boolean') {
    fields.clinicianRedFlagAssessed = 'Complete the clinician warning-sign screen before saving.';
  }
  if (payload.clinicianRedFlag !== undefined && payload.clinicianRedFlag !== null && typeof payload.clinicianRedFlag !== 'boolean') {
    fields.clinicianRedFlag = 'Urgent warning sign must be true or false.';
  }
  const clinicianRedFlagAssessed = payload.clinicianRedFlagAssessed === undefined
    ? typeof payload.clinicianRedFlag === 'boolean'
    : payload.clinicianRedFlagAssessed;
  if (clinicianRedFlagAssessed && payload.clinicianRedFlagAssessed !== undefined && typeof payload.clinicianRedFlag !== 'boolean') {
    fields.clinicianRedFlag = 'Record whether an urgent warning sign was observed.';
  }
  if (!clinicianRedFlagAssessed && payload.clinicianRedFlag === true) {
    fields.clinicianRedFlagAssessed = 'An observed urgent warning sign must be recorded as assessed.';
  }

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
      clinicianRedFlagAssessed,
      riskAcknowledgement: acknowledgement,
      medicineId,
      medicineQuantity,
      dispensations: hasDispensations ? dispensations.map((entry) => ({
        itemId: String(entry.itemId ?? entry.inventoryItemId).trim(),
        quantity: Number(entry.quantity),
      })) : (medicineId ? [{ itemId: medicineId, quantity: medicineQuantity }] : []),
      notes,
      summaryDraft,
      summaryApproved: Boolean(payload.summaryApproved),
    },
  };
}

export function visitRiskInput(visit, recentVisitCount) {
  return {
    painScore: visit.painScore,
    clinicianRedFlag: visit.clinicianRedFlagAssessed === false ? null : visit.clinicianRedFlag,
    recentVisitCount,
    temperature: visit.temperature,
    pulse: visit.pulse,
  };
}
