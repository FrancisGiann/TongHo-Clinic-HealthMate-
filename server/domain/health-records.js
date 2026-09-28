const PAST_ILLNESS_FIELDS = [
  'chickenpox', 'pneumonia', 'dengue', 'measles', 'gastroenteritis', 'amoebasis',
  'typhoidFever', 'heartDisease', 'asthma', 'headInjury', 'otherPastIllness',
];
const PRESENT_ILLNESS_FIELDS = [
  'allergicRhinitis', 'hyperacidity', 'asthma', 'skinDisorder', 'skinDisorderDetails',
  'eyeDisorder', 'eyeDisorderDetails', 'otherPresentIllness',
];
const HOME_MEDICATION_FIELDS = ['pain', 'painName', 'fever', 'feverName', 'allergies', 'allergiesName', 'stomachache', 'stomachacheName', 'otherMedication'];
const DOCUMENT_FIELDS = ['psychiatricEvaluation', 'diagnosticAssessment', 'medicationRecords'];
const TEXT_LIMITS = {
  birthDate: 10,
  gender: 40,
  motherName: 160,
  fatherName: 160,
  guardianName: 160,
  guardianPhone: 40,
  guardianRelation: 80,
  bloodType: 3,
  allergies: 1000,
  conditions: 2000,
  medications: 2000,
  hospitalizationDetails: 1000,
  g6pdDeficiency: 20,
  takingRegularMedication: 20,
  regularMedicationName: 1000,
  lastTreatmentDate: 10,
  therapistName: 160,
  concernsDetails: 2000,
  therapyInterventions: 1000,
  allergiesStatus: 20,
  conditionsStatus: 20,
  medicationsStatus: 20,
};
const BLOOD_TYPES = new Set(['', 'O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-']);
const YES_NO_UNKNOWN = new Set(['', 'yes', 'no', 'unknown']);

function cleanText(value, field, limit, errors) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') {
    errors[field] = 'Enter text for this field.';
    return '';
  }
  const cleaned = value.trim();
  if (cleaned.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(cleaned)) {
    errors[field] = `Use no more than ${limit} characters.`;
  }
  return cleaned.slice(0, limit);
}

function cleanFlags(value, keys, field, errors) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const output = {};
  for (const key of keys) {
    if (key.startsWith('other') || key.endsWith('Name') || key.endsWith('Details')) output[key] = cleanText(source[key], `${field}.${key}`, 200, errors);
    else {
      if (source[key] !== undefined && source[key] !== null && typeof source[key] !== 'boolean') errors[`${field}.${key}`] = 'Choose yes or no or leave unanswered.';
      output[key] = typeof source[key] === 'boolean' ? source[key] : null;
    }
  }
  return output;
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value && date <= new Date();
}

export function normalizeHealthRecordAnswers(payload) {
  const errors = {};
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { valid: false, errors: { form: 'A health record is required.' } };
  }
  const value = {};
  for (const [field, limit] of Object.entries(TEXT_LIMITS)) value[field] = cleanText(payload[field], field, limit, errors);
  value.pastIllness = cleanFlags(payload.pastIllness, PAST_ILLNESS_FIELDS, 'pastIllness', errors);
  value.presentIllness = cleanFlags(payload.presentIllness, PRESENT_ILLNESS_FIELDS, 'presentIllness', errors);
  value.medicationAtHome = cleanFlags(payload.medicationAtHome, HOME_MEDICATION_FIELDS, 'medicationAtHome', errors);
  value.documentsSubmitted = cleanFlags(payload.documentsSubmitted ?? payload.documents, DOCUMENT_FIELDS, 'documentsSubmitted', errors);

  for (const field of ['allergiesStatus', 'conditionsStatus', 'medicationsStatus']) {
    if (!['', 'none', 'reported', 'unknown'].includes(value[field])) errors[field] = 'Choose unknown, none reported, or information provided.';
  }
  for (const [statusField, valueField] of [['allergiesStatus', 'allergies'], ['conditionsStatus', 'conditions'], ['medicationsStatus', 'medications']]) {
    if (value[statusField] === 'none') value[valueField] = '';
    if (value[statusField] === 'reported' && !value[valueField]) errors[valueField] = 'Enter the reported information.';
    if (!value[statusField] && value[valueField]) value[statusField] = 'reported';
    if (!value[statusField]) value[statusField] = 'unknown';
  }

  for (const field of ['hospitalizationHistory', 'onTherapy', 'hasConcerns']) {
    const answer = payload[field];
    if (answer === true || answer === 'yes') value[field] = true;
    else if (answer === false || answer === 'no') value[field] = false;
    else if (answer === undefined || answer === null || answer === '' || answer === 'unknown') value[field] = null;
    else {
      errors[field] = 'Choose yes, no, or unknown.';
      value[field] = null;
    }
  }
  if (value.birthDate && !isValidDate(value.birthDate)) errors.birthDate = 'Enter a valid date of birth that is not in the future.';
  if (value.gender && !['Male', 'Female', 'Other', 'Prefer not to say'].includes(value.gender)) errors.gender = 'Choose a valid option.';
  if (!BLOOD_TYPES.has(value.bloodType)) errors.bloodType = 'Choose a valid blood type or leave it blank.';
  if (!YES_NO_UNKNOWN.has(value.g6pdDeficiency)) errors.g6pdDeficiency = 'Choose yes, no, or unknown.';
  if (!YES_NO_UNKNOWN.has(value.takingRegularMedication)) errors.takingRegularMedication = 'Choose yes, no, or unknown.';
  if (value.guardianPhone && !/^[\d\s+().-]{7,40}$/.test(value.guardianPhone)) errors.guardianPhone = 'Enter a valid contact number.';
  if (Object.keys(errors).length) return { valid: false, errors };
  return { valid: true, value };
}

export function acceptedProfileFields(answers, currentProfile = {}) {
  const normalized = normalizeHealthRecordAnswers(answers);
  if (!normalized.valid) throw new Error('Only a validated health record can update a patient profile.');
  const omitUnanswered = (value) => {
    if (Array.isArray(value)) return value.map(omitUnanswered);
    if (!value || typeof value !== 'object') return value === '' || value === null ? undefined : value;
    return Object.fromEntries(Object.entries(value)
      .map(([key, item]) => [key, omitUnanswered(item)])
      .filter(([, item]) => item !== undefined));
  };
  const accepted = omitUnanswered(normalized.value);
  const baseline = currentProfile?.guardianHealthRecord && typeof currentProfile.guardianHealthRecord === 'object'
    ? currentProfile.guardianHealthRecord
    : currentProfile;
  const projection = Object.fromEntries(Object.keys(normalized.value)
    .filter((field) => baseline?.[field] !== undefined)
    .map((field) => [field, baseline[field]]));
  for (const [field, value] of Object.entries(accepted)) {
    if (['pastIllness', 'presentIllness', 'medicationAtHome', 'documents', 'documentsSubmitted'].includes(field)) {
      projection[field] = { ...(projection[field] || {}), ...value };
    } else {
      projection[field] = value;
    }
  }
  for (const [statusField, valueField] of [['allergiesStatus', 'allergies'], ['conditionsStatus', 'conditions'], ['medicationsStatus', 'medications']]) {
    if (accepted?.[statusField] === 'none') projection[valueField] = '';
    else if (accepted?.[statusField] === 'unknown') projection[statusField] = 'unknown';
  }
  return projection;
}

export function normalizeDocumentReceiptStatus(value) {
  if (value === undefined) return { valid: true, value: null };
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some((field) => !DOCUMENT_FIELDS.includes(field))) {
    return { valid: false, message: 'Document receipt status must use the supported document fields.' };
  }
  const normalized = {};
  for (const field of DOCUMENT_FIELDS) {
    if (typeof value[field] !== 'boolean') return { valid: false, message: 'Set each document receipt status to received or not received.' };
    normalized[field] = value[field];
  }
  return { valid: true, value: normalized };
}

export function validatePaperSignatureForAcceptance(submission) {
  if (submission?.source !== 'paper' || submission?.paper_signature_presence?.guardianPresent === true) {
    return { valid: true };
  }
  return {
    valid: false,
    status: 409,
    code: 'GUARDIAN_PAPER_SIGNATURE_REQUIRED',
    message: 'A paper record cannot be accepted until a guardian signature is confirmed as present.',
  };
}
