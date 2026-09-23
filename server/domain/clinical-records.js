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

function dateTime(value) {
  return clinicDateTimeTimestamp(value) !== null;
}

function clinicDateTimeTimestamp(value) {
  if (typeof value !== 'string') return null;
  if (calendarDate(value)) {
    const [year, month, day] = value.split('-').map(Number);
    return Date.UTC(year, month - 1, day, -8);
  }
  const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})?$/);
  if (!match || !calendarDate(match[1])) return null;
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  const second = Number(match[4] || 0);
  const millisecond = Number((match[5] || '').padEnd(3, '0') || 0);
  if (hour > 23 || minute > 59 || second > 59) return null;
  if (match[6]) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const [year, month, day] = match[1].split('-').map(Number);
  return Date.UTC(year, month - 1, day, hour - 8, minute, second, millisecond);
}

function clinicDateKey(value) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function numeric(value, min, max) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : undefined;
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
  const previous = new Map(before.map((record) => [String(record.id), record]));
  return after.filter((record) => !previous.has(String(record.id)) || !sameRecord(previous.get(String(record.id)), record));
}

export function validateChangedClinicalRecords(before = {}, next = {}, { now = new Date() } = {}) {
  const studentIds = new Set((next.students || []).map((student) => String(student.id)));
  const changed = {
    screenings: changedRecords(before.screenings, next.screenings),
    immunizations: changedRecords(before.immunizations, next.immunizations),
    incidents: changedRecords(before.incidents, next.incidents),
  };

  for (const [collection, records] of Object.entries(changed)) {
    for (const record of records) {
      const patientId = String(record.patientId ?? record.studentId ?? '').trim();
      if (!patientId || !studentIds.has(patientId)) return { valid: false, message: `${collection} records must reference a current student.` };
    }
  }

  for (const record of changed.screenings) {
    const schoolYear = text(record.schoolYear, 40, true);
    const date = text(record.date, 32, true);
    const vision = text(record.visionFinding ?? record.vision, 240);
    const hearing = text(record.hearingFinding ?? record.hearing, 240);
    const height = numeric(record.heightCm, 40, 250);
    const weight = numeric(record.weightKg, 1, 300);
    const bmi = numeric(record.bmi, 1, 150);
    if (!schoolYear || !date || !calendarDate(date)) return { valid: false, message: 'Screening records need a school year and a valid date.' };
    if (date > clinicDateKey(now)) return { valid: false, message: 'Screening date cannot be in the future.' };
    if (vision === null || hearing === null || height === undefined || weight === undefined || bmi === undefined) return { valid: false, message: 'Review the screening findings and measurement values.' };
    const hasMeasuredFinding = Boolean(vision || hearing || height !== null || weight !== null);
    if (!hasMeasuredFinding) return { valid: false, message: 'Enter at least one measured screening finding.' };
    if (bmi !== null) {
      if (height === null || weight === null) return { valid: false, message: 'BMI can only be saved when height and weight are recorded.' };
      const calculated = weight / ((height / 100) ** 2);
      if (Math.abs(calculated - bmi) > 0.2) return { valid: false, message: 'BMI must match the recorded height and weight.' };
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

  for (const record of changed.incidents) {
    const incidentType = text(record.type, 80, true);
    const description = text(record.description, 2000, true);
    const actionTaken = text(record.actionTaken, 2000, true);
    const location = text(record.location, 160, true);
    const date = text(record.date, 40, true);
    const otherTypeDescription = text(record.otherTypeDescription, 160);
    if (!incidentType || !description || !actionTaken || !location || !date || !dateTime(date)) return { valid: false, message: 'Incident records need a date, location, type, description, and action taken.' };
    if (clinicDateTimeTimestamp(date) > new Date(now).getTime()) return { valid: false, message: 'Incident date and time cannot be in the future.' };
    if (incidentType.toLowerCase() === 'other' && !otherTypeDescription) return { valid: false, message: 'Describe the incident type when Other is selected.' };
    if (otherTypeDescription === null) return { valid: false, message: 'Custom incident type must be 160 characters or fewer.' };
  }

  return { valid: true };
}
