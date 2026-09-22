function dateKey(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function increment(target, key) {
  if (!key) return;
  target[key] = (target[key] || 0) + 1;
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
  const complaints = {};
  const consultationTypes = {};
  const treatments = {};
  const medicines = {};
  const uniquePatients = new Set();

  visits.forEach((visit) => {
    uniquePatients.add(String(visit.studentId || visit.patientId || 'unknown'));
    increment(complaints, visit.chiefComplaint || 'Not recorded');
    increment(consultationTypes, visit.type || 'Other');
    increment(treatments, visit.treatment || 'Not recorded');
  });
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
    },
    complaints,
    consultationTypes,
    treatments,
    medicines,
    generatedAt: new Date().toISOString(),
  };
}
