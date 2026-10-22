const TOTAL_FIELDS = [
  ['Visits', 'visits'], ['Unique patients', 'uniquePatients'], ['Appointments', 'appointments'],
  ['Medicines dispensed', 'medicinesDispensed'], ['Follow-ups', 'followUps'],
];
const CATEGORY_FIELDS = [
  ['Patient types', 'patientTypes'], ['Complaints', 'complaints'], ['Consultation types', 'consultationTypes'],
  ['Treatments', 'treatments'], ['Medication use', 'medications'], ['Supply use', 'supplies'],
  ['Unclassified historical items', 'unclassifiedItems'], ['Grades', 'grades'],
];
const SUMMARY_HEALTH_FIELDS = [
  'birthDate', 'gender', 'bloodType', 'allergies', 'allergiesStatus', 'conditions', 'conditionsStatus',
  'medications', 'medicationsStatus', 'pastIllness', 'presentIllness', 'hospitalizationHistory',
  'hospitalizationDetails', 'g6pdDeficiency', 'medicationAtHome', 'takingRegularMedication',
  'regularMedicationName', 'onTherapy', 'lastTreatmentDate', 'therapistName', 'therapyInterventions',
  'hasConcerns', 'concernsDetails',
];
const SUMMARY_VISIT_FIELDS = [
  'id', 'date', 'time', 'type', 'chiefComplaint', 'treatment', 'disposition',
  'followUp', 'followUpDate', 'nurseName', 'summary',
];

export function clinicReportPrintModel(report = {}) {
  const suppressedTotals = report.suppressedTotals || [];
  const suppressedCategories = report.suppressedAggregates || [];
  return {
    totals: TOTAL_FIELDS.map(([label, key]) => ({ label, value: suppressedTotals.includes(key) ? 'Withheld' : report.totals?.[key] ?? 0 })),
    timeSeries: Object.entries(report.timeSeries || {}).map(([date, count]) => [date, report.timeSeriesSuppressed || count === null ? 'Withheld' : count]),
    categories: CATEGORY_FIELDS.map(([title, key]) => ({
      title,
      entries: Object.entries(report[key] || {}),
      withheld: suppressedCategories.includes(key),
    })),
  };
}

export function patientSummaryPrintModel(summary = {}, fallbackPatient = {}) {
  const patient = { ...(fallbackPatient || {}), ...(summary.patient || {}) };
  const health = summary.currentHealth || {};
  const visits = Array.isArray(summary.visits) ? summary.visits : [];
  const projectedHealth = Object.fromEntries(SUMMARY_HEALTH_FIELDS
    .filter((field) => health[field] !== undefined)
    .map((field) => [field, health[field]]));
  const faculty = patient.patientType === 'faculty';
  return {
    patient: {
      name: patient.name || '',
      patientType: faculty ? 'faculty' : 'student',
      studentId: faculty ? '' : patient.studentId || '',
      facultyId: faculty ? patient.facultyId || patient.studentId || '' : '',
      gradeLevel: faculty ? '' : patient.gradeLevel || '',
      section: faculty ? '' : patient.section || '',
      department: faculty ? patient.department || '' : '',
      position: faculty ? patient.position || '' : '',
    },
    health: projectedHealth,
    period: { start: summary.period?.start || '', end: summary.period?.end || '' },
    totalVisits: visits.length,
    visits: visits.map((visit) => Object.fromEntries(SUMMARY_VISIT_FIELDS
      .filter((field) => visit?.[field] !== undefined)
      .map((field) => [field, visit[field]]))),
  };
}

export function formatHealthValue(value, emptyLabel = 'No record provided') {
  if (value === null || value === undefined || value === '') return emptyLabel;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'none') return 'None reported';
    if (normalized === 'unknown') return 'Unknown';
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => formatHealthValue(item, '')).filter(Boolean).join(', ') || emptyLabel;
  if (typeof value === 'object') {
    const details = Object.entries(value).flatMap(([field, item]) => {
      if (item === null || item === undefined || item === '') return [];
      const label = field.replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase()).replace(/Details$/, 'details');
      if (typeof item === 'boolean') return item ? [`${label}: Yes`] : [];
      const rendered = formatHealthValue(item, '');
      return rendered ? [`${label}: ${rendered}`] : [];
    });
    if (details.length) return details.join('; ');
    if (Object.values(value).some((item) => item === false)) return 'None reported';
    return emptyLabel;
  }
  return String(value);
}

export function formatHealthField(key, health = {}) {
  const status = health[`${key}Status`];
  if (['allergies', 'conditions', 'medications'].includes(key)) {
    if (status === 'none') return 'None reported';
    if (status === 'unknown') return 'Unknown';
  }
  return formatHealthValue(health[key], ['hospitalizationHistory', 'onTherapy', 'hasConcerns'].includes(key) ? 'Unknown' : 'No record provided');
}
