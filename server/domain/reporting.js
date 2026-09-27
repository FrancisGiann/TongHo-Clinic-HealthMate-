function dateKey(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function increment(target, key) {
  if (!key) return;
  target[key] = (target[key] || 0) + 1;
}

const smallCellThreshold = 5;
const aggregateMaps = ['complaints', 'consultationTypes', 'treatments', 'medicines', 'medications', 'supplies', 'unclassifiedItems', 'riskCategories', 'grades', 'patientTypes'];
const aggregateTotals = ['visits', 'uniquePatients', 'appointments', 'medicinesDispensed', 'medicationUnitsDispensed', 'supplyUnitsDispensed', 'unclassifiedUnitsDispensed', 'followUps'];

export function suppressSmallCellAggregates(report, threshold = smallCellThreshold) {
  const suppressed = { ...report, totals: { ...report.totals }, timeSeries: { ...report.timeSeries } };
  const suppressedAggregates = [];
  const suppressedTotals = [];
  const smallCohort = Number(report.totals?.uniquePatients) > 0 && Number(report.totals.uniquePatients) < threshold;
  for (const key of aggregateMaps) {
    const values = report[key] || {};
    const visible = {};
    const hiddenLabels = new Set();
    for (const [label, count] of Object.entries(values)) {
      if (smallCohort || (Number(count) > 0 && Number(count) < threshold)) hiddenLabels.add(label);
      else visible[label] = count;
    }
    if (!smallCohort && hiddenLabels.size === 1) {
      const complementary = Object.entries(visible).sort((first, second) => Number(first[1]) - Number(second[1]))[0];
      if (complementary) hiddenLabels.add(complementary[0]);
    }
    for (const label of hiddenLabels) delete visible[label];
    suppressed[key] = visible;
    if (smallCohort || hiddenLabels.size > 0) suppressedAggregates.push(key);
  }
  for (const key of aggregateTotals) {
    const count = Number(report.totals?.[key]);
    if (count > 0 && count < threshold) {
      suppressed.totals[key] = null;
      suppressedTotals.push(key);
    }
  }
  const hiddenDates = new Set();
  for (const [date, count] of Object.entries(suppressed.timeSeries)) {
    if (smallCohort || (Number(count) > 0 && Number(count) < threshold)) hiddenDates.add(date);
  }
  const visitCategoriesSuppressed = ['complaints', 'consultationTypes', 'treatments', 'riskCategories', 'grades']
    .some((key) => suppressedAggregates.includes(key));
  if (visitCategoriesSuppressed) for (const date of Object.keys(suppressed.timeSeries)) hiddenDates.add(date);
  if (!smallCohort && hiddenDates.size === 1) {
    const complementary = Object.entries(suppressed.timeSeries)
      .filter(([date]) => !hiddenDates.has(date))
      .sort((first, second) => Number(first[1]) - Number(second[1]))[0];
    if (complementary) hiddenDates.add(complementary[0]);
  }
  for (const date of hiddenDates) suppressed.timeSeries[date] = null;
  const addSuppressedTotal = (key) => {
    suppressed.totals[key] = null;
    if (!suppressedTotals.includes(key)) suppressedTotals.push(key);
  };
  if (visitCategoriesSuppressed || hiddenDates.size > 0) addSuppressedTotal('visits');
  if (suppressedAggregates.includes('medicines')) addSuppressedTotal('medicinesDispensed');
  if (suppressedAggregates.includes('medications')) addSuppressedTotal('medicationUnitsDispensed');
  if (suppressedAggregates.includes('supplies')) addSuppressedTotal('supplyUnitsDispensed');
  if (suppressedAggregates.includes('unclassifiedItems')) addSuppressedTotal('unclassifiedUnitsDispensed');
  if (suppressedAggregates.includes('patientTypes')) addSuppressedTotal('uniquePatients');
  suppressed.suppressedAggregates = suppressedAggregates;
  suppressed.suppressedTotals = suppressedTotals;
  suppressed.timeSeriesSuppressed = hiddenDates.size > 0;
  suppressed.smallCohortSuppressed = smallCohort;
  return suppressed;
}

export function reportForRole(report, role) {
  const safeReport = withoutRemovedWorkflowFields(report);
  return role === 'system_administrator' ? suppressSmallCellAggregates(safeReport) : safeReport;
}

export function reportSnapshotForStorage(report) {
  return withoutRemovedWorkflowFields(report);
}

function withoutRemovedWorkflowFields(report = {}) {
  const sanitized = { ...report };
  if (sanitized.totals) {
    sanitized.totals = { ...sanitized.totals };
    delete sanitized.totals.vaccineDueRecords;
    delete sanitized.totals.incidents;
    delete sanitized.totals.screenedPatients;
  }
  delete sanitized.vaccineTracking;
  delete sanitized.screeningVisionFindings;
  delete sanitized.screeningHearingFindings;
  delete sanitized.incidentSeverities;
  const removedAggregates = new Set(['screeningVisionFindings', 'screeningHearingFindings', 'incidentSeverities']);
  if (Array.isArray(sanitized.suppressedAggregates)) {
    sanitized.suppressedAggregates = sanitized.suppressedAggregates.filter((key) => !removedAggregates.has(key));
  }
  if (Array.isArray(sanitized.suppressedTotals)) {
    sanitized.suppressedTotals = sanitized.suppressedTotals.filter((key) => !['vaccineDueRecords', 'incidents', 'screenedPatients'].includes(key));
  }
  return sanitized;
}

export function buildClinicReport(data, startDate, endDate) {
  const start = String(startDate);
  const end = String(endDate);
  const inPeriod = (value) => {
    const key = dateKey(value);
    return key && key >= start && key <= end;
  };
  const visits = (data.visits || []).filter((visit) => inPeriod(visit.date || visit.createdAt));
  const appointments = (data.appointments || []).filter((appointment) => inPeriod(appointment.date || appointment.startsAt));
  const dispenseLogs = (data.dispenseLogs || []).filter((entry) => inPeriod(entry.date || entry.createdAt));
  const complaints = {};
  const consultationTypes = {};
  const treatments = {};
  const medicines = {};
  const medications = {};
  const supplies = {};
  const unclassifiedItems = {};
  const riskCategories = {};
  const grades = {};
  const patientTypes = {};
  const patientsByType = new Map();
  const timeSeries = {};
  const uniquePatients = new Set();
  const students = new Map((data.students || []).map((student) => [String(student.id), student]));

  visits.forEach((visit) => {
    uniquePatients.add(String(visit.studentId || visit.patientId || 'unknown'));
    increment(complaints, visit.chiefComplaint || 'Not recorded');
    increment(consultationTypes, visit.type || 'Other');
    increment(treatments, visit.treatment || 'Not recorded');
    increment(riskCategories, visit.riskAssessment?.category || visit.riskCategory || 'unclassified');
    const patient = students.get(String(visit.studentId || visit.patientId));
    const patientType = patient?.patientType === 'faculty' ? 'faculty' : 'student';
    if (!patientsByType.has(patientType)) patientsByType.set(patientType, new Set());
    patientsByType.get(patientType).add(String(visit.studentId || visit.patientId || 'unknown'));
    if (patientType === 'student') increment(grades, patient?.gradeLevel || 'Not recorded');
    const key = dateKey(visit.date || visit.createdAt);
    if (key) timeSeries[key] = (timeSeries[key] || 0) + 1;
  });
  let medicationUnitsDispensed = 0;
  let supplyUnitsDispensed = 0;
  let unclassifiedUnitsDispensed = 0;
  dispenseLogs.forEach((entry) => {
    const key = entry.itemName || entry.inventoryItemName || entry.medicineName || 'Unknown item';
    const quantity = Number(entry.quantity) || 0;
    medicines[key] = (medicines[key] || 0) + quantity;
    if (entry.itemType === 'medication') {
      medicationUnitsDispensed += quantity;
      medications[key] = (medications[key] || 0) + quantity;
    } else if (entry.itemType === 'supply') {
      supplyUnitsDispensed += quantity;
      supplies[key] = (supplies[key] || 0) + quantity;
    } else {
      unclassifiedUnitsDispensed += quantity;
      unclassifiedItems[key] = (unclassifiedItems[key] || 0) + quantity;
    }
  });

  for (const [patientType, patientsOfType] of patientsByType) patientTypes[patientType] = patientsOfType.size;

  return {
    period: { start, end },
    totals: {
      visits: visits.length,
      uniquePatients: uniquePatients.size,
      appointments: appointments.length,
      medicinesDispensed: dispenseLogs.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0),
      medicationUnitsDispensed,
      supplyUnitsDispensed,
      unclassifiedUnitsDispensed,
      followUps: visits.filter((visit) => visit.followUp).length,
    },
    complaints,
    consultationTypes,
    treatments,
    medicines,
    medications,
    supplies,
    unclassifiedItems,
    riskCategories,
    grades,
    patientTypes,
    timeSeries: Object.fromEntries(Array.from({ length: Math.max(0, Math.round((new Date(`${end}T00:00:00Z`) - new Date(`${start}T00:00:00Z`)) / 86400000) + 1) }, (_, index) => {
      const date = new Date(`${start}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() + index);
      const key = date.toISOString().slice(0, 10);
      return [key, timeSeries[key] || 0];
    })),
    generatedAt: new Date().toISOString(),
  };
}
