function text(value, limit, required = false) {
  if (typeof value !== 'string') return required ? null : '';
  const normalized = value.trim();
  if (required && !normalized) return null;
  return normalized.length <= limit ? normalized : null;
}

function calendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function clinicDateKey(value) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function sameRecord(first, second) {
  const normalize = (value) => {
    if (Array.isArray(value)) return value.map(normalize);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalize(value[key])]));
  };
  return JSON.stringify(normalize(first)) === JSON.stringify(normalize(second));
}

function changedRecords(before = [], after = []) {
  const previous = new Map((Array.isArray(before) ? before : []).map((record) => [String(record.id), record]));
  return (Array.isArray(after) ? after : []).filter((record) => !previous.has(String(record.id)) || !sameRecord(previous.get(String(record.id)), record));
}

export function validateChangedClinicalRecords(before = {}, next = {}, { now = new Date() } = {}) {
  const studentIds = new Set((next.students || []).map((student) => String(student.id)));
  const changedRetiredRecords = [
    ...changedRecords(before.screenings, next.screenings),
    ...changedRecords(before.incidents, next.incidents),
  ];
  if (changedRetiredRecords.length) {
    return { valid: false, status: 410, code: 'FEATURE_REMOVED', message: 'Health screening and incident reporting have been removed. Historical records are retained and cannot be created or changed.' };
  }
  const changed = {
    immunizations: changedRecords(before.immunizations, next.immunizations),
  };

  for (const [collection, records] of Object.entries(changed)) {
    for (const record of records) {
      const patientId = String(record.patientId ?? record.studentId ?? '').trim();
      if (!patientId || !studentIds.has(patientId)) return { valid: false, message: `${collection} records must reference a current student.` };
    }
  }

  for (const record of changed.immunizations) {
    const vaccineName = text(record.vaccineName, 120, true);
    const doseNumber = text(record.doseNumber, 80, true);
    const dateAdministered = text(record.dateAdministered, 10, true);
    const nextDueDate = record.nextDueDate == null || record.nextDueDate === '' ? '' : text(record.nextDueDate, 10, true);
    const source = String(record.source || '').trim().toLowerCase();
    const clinicName = text(record.clinicName, 160);
    if (!vaccineName || !doseNumber || !dateAdministered || !calendarDate(dateAdministered)) return { valid: false, message: 'Immunization records need a vaccine, dose, and valid administration date.' };
    if (!['clinic', 'external'].includes(source)) return { valid: false, message: 'Choose whether the vaccine was given by the school clinic or an external clinic.' };
    if (clinicName === null) return { valid: false, message: 'Clinic name must be 160 characters or fewer.' };
    if (source === 'external' && !clinicName) return { valid: false, message: 'Enter the external clinic name.' };
    if (dateAdministered > clinicDateKey(now)) return { valid: false, message: 'Administration date cannot be in the future.' };
    if (nextDueDate === null || (nextDueDate && !calendarDate(nextDueDate))) return { valid: false, message: 'Next due date must be a valid date.' };
    if (nextDueDate && nextDueDate < dateAdministered) return { valid: false, message: 'Next due date cannot be before the administration date.' };
  }



  return { valid: true };
}
