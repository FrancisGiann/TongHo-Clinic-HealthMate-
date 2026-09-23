function dateKey(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function increment(target, key) {
  if (!key) return;
  target[key] = (target[key] || 0) + 1;
}

const smallCellThreshold = 5;
const aggregateMaps = ['complaints', 'consultationTypes', 'treatments', 'medicines', 'riskCategories', 'grades', 'incidentSeverities'];
const aggregateTotals = ['visits', 'uniquePatients', 'incidents', 'appointments', 'medicinesDispensed', 'followUps', 'screenedPatients', 'completeImmunizationPatients'];

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
  if (suppressedAggregates.includes('incidentSeverities')) addSuppressedTotal('incidents');
  suppressed.suppressedAggregates = suppressedAggregates;
  suppressed.suppressedTotals = suppressedTotals;
  suppressed.timeSeriesSuppressed = hiddenDates.size > 0;
  suppressed.smallCohortSuppressed = smallCohort;
  return suppressed;
}

export function reportForRole(report, role) {
  return role === 'system_administrator' ? suppressSmallCellAggregates(report) : report;
}

export function buildClinicReport(data, startDate, endDate) {
  const start = String(startDate);
  const end = String(endDate);
  const inPeriod = (value) => {
    const key = dateKey(value);
    return key && key >= start && key <= end;
  };
  const visits = (data.visits || []).filter((visit) => inPeriod(visit.date || visit.createdAt));
  const incidents = (data.incidents || []).filter((incident) => inPeriod(incident.date || incident.createdAt));
  const appointments = (data.appointments || []).filter((appointment) => inPeriod(appointment.date || appointment.startsAt));
  const dispenseLogs = (data.dispenseLogs || []).filter((entry) => inPeriod(entry.date || entry.createdAt));
  const screenings = (data.screenings || []).filter((entry) => inPeriod(entry.date || entry.createdAt));
  const immunizations = (data.immunizations || []).filter((entry) => inPeriod(entry.date || entry.createdAt));
  const complaints = {};
  const consultationTypes = {};
  const treatments = {};
  const medicines = {};
  const riskCategories = {};
  const grades = {};
  const incidentSeverities = {};
  const timeSeries = {};
  const uniquePatients = new Set();
  const screenedPatients = new Set(screenings.map((record) => String(record.studentId || record.patientId || record.id)));
  const completeImmunizationPatients = new Set(immunizations.filter((record) => /complete|up to date/i.test(String(record.remarks || record.status || ''))).map((record) => String(record.studentId || record.patientId || record.id)));
  const students = new Map((data.students || []).map((student) => [String(student.id), student]));

  visits.forEach((visit) => {
    uniquePatients.add(String(visit.studentId || visit.patientId || 'unknown'));
    increment(complaints, visit.chiefComplaint || 'Not recorded');
    increment(consultationTypes, visit.type || 'Other');
    increment(treatments, visit.treatment || 'Not recorded');
    increment(riskCategories, visit.riskAssessment?.category || visit.riskCategory || 'unclassified');
    increment(grades, students.get(String(visit.studentId || visit.patientId))?.gradeLevel || 'Not recorded');
    const key = dateKey(visit.date || visit.createdAt);
    if (key) timeSeries[key] = (timeSeries[key] || 0) + 1;
  });
  incidents.forEach((incident) => increment(incidentSeverities, incident.severity || 'Not recorded'));
  dispenseLogs.forEach((entry) => {
    const key = entry.medicineName || entry.inventoryItemName || 'Unknown item';
    medicines[key] = (medicines[key] || 0) + (Number(entry.quantity) || 0);
  });

  return {
    period: { start, end },
    totals: {
      visits: visits.length,
      uniquePatients: uniquePatients.size,
      incidents: incidents.length,
      appointments: appointments.length,
      medicinesDispensed: dispenseLogs.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0),
      followUps: visits.filter((visit) => visit.followUp).length,
      screenedPatients: screenedPatients.size,
      completeImmunizationPatients: completeImmunizationPatients.size,
    },
    complaints,
    consultationTypes,
    treatments,
    medicines,
    riskCategories,
    grades,
    incidentSeverities,
    timeSeries: Object.fromEntries(Array.from({ length: Math.max(0, Math.round((new Date(`${end}T00:00:00Z`) - new Date(`${start}T00:00:00Z`)) / 86400000) + 1) }, (_, index) => {
      const date = new Date(`${start}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() + index);
      const key = date.toISOString().slice(0, 10);
      return [key, timeSeries[key] || 0];
    })),
    generatedAt: new Date().toISOString(),
  };
}
