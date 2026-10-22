const STUDENT_IDENTITY_FIELDS = ['studentId', 'name', 'gradeLevel', 'section', 'adviser'];
const FACULTY_IDENTITY_FIELDS = ['facultyId', 'studentId', 'name', 'department', 'position'];
const CURRENT_HEALTH_FIELDS = [
  'birthDate', 'gender', 'bloodType', 'allergies', 'allergiesStatus', 'conditions', 'conditionsStatus',
  'medications', 'medicationsStatus', 'pastIllness', 'presentIllness', 'hospitalizationHistory',
  'hospitalizationDetails', 'g6pdDeficiency', 'medicationAtHome', 'takingRegularMedication',
  'regularMedicationName', 'onTherapy', 'lastTreatmentDate', 'therapistName', 'therapyInterventions',
  'hasConcerns', 'concernsDetails',
];
const VISIT_FIELDS = ['date', 'time', 'type', 'chiefComplaint', 'treatment', 'disposition', 'followUp', 'followUpDate', 'nurseName'];

export function validSummaryDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validateSummaryRange(start, end, maxDays = 366) {
  if (!validSummaryDate(start) || !validSummaryDate(end) || start > end) return { valid: false };
  const days = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000;
  return days <= maxDays ? { valid: true, start, end } : { valid: false };
}

function copyFields(source, fields) {
  return Object.fromEntries(fields.filter((field) => source?.[field] !== undefined && source[field] !== null)
    .map((field) => [field, source[field]]));
}

export function projectPatientSummaryIdentity(patient) {
  const isFaculty = patient?.patient_type === 'faculty' || patient?.patientType === 'faculty';
  const data = patient?.data && typeof patient.data === 'object' ? patient.data : patient || {};
  const identity = copyFields(data, isFaculty ? FACULTY_IDENTITY_FIELDS : STUDENT_IDENTITY_FIELDS);
  return { id: String(patient?.id || data.id || ''), patientType: isFaculty ? 'faculty' : 'student', ...identity };
}

export function projectPatientSummaryHealth(patient) {
  const data = patient?.data && typeof patient.data === 'object' ? patient.data : patient || {};
  const base = copyFields(data, CURRENT_HEALTH_FIELDS);
  if ((patient?.patient_type || patient?.patientType || data.patientType) !== 'faculty') {
    // guardianHealthRecord is written from acceptedProfileFields only after nurse approval.
    // Draft and submission workflow properties are deliberately never traversed.
    Object.assign(base, copyFields(data.guardianHealthRecord, CURRENT_HEALTH_FIELDS));
  }
  return base;
}

export function projectPatientSummaryVisit(row) {
  const data = row?.data && typeof row.data === 'object' ? row.data : {};
  const date = typeof row?.date === 'string' && row.date ? row.date : data.date;
  const visit = { id: String(row?.id || data.id || ''), ...copyFields({ ...data, date }, VISIT_FIELDS) };
  if (typeof data.summaryApprovedBy === 'string' && data.summaryApprovedBy.trim()) {
    visit.summary = typeof data.consultationSummary === 'string' ? data.consultationSummary : '';
  }
  return visit;
}

export function patientSummaryForRange({ patient, visits = [], start, end }) {
  const range = validateSummaryRange(start, end);
  if (!range.valid) throw new Error('A valid report date range is required.');
  const selectedVisits = visits.map(projectPatientSummaryVisit)
    .filter((visit) => validSummaryDate(visit.date) && visit.date >= start && visit.date <= end)
    .sort((a, b) => `${b.date || ''}T${b.time || ''}`.localeCompare(`${a.date || ''}T${a.time || ''}`) || b.id.localeCompare(a.id));
  return {
    patient: projectPatientSummaryIdentity(patient),
    currentHealth: projectPatientSummaryHealth(patient),
    period: { start, end },
    totals: { visits: selectedVisits.length },
    visits: selectedVisits,
  };
}
