export function isValidCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function timestamp(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function compareText(first, second) {
  return first < second ? -1 : first > second ? 1 : 0;
}

export function compareImmunizationLatest(first, second) {
  const firstDate = isValidCalendarDate(first?.dateAdministered) ? first.dateAdministered : '';
  const secondDate = isValidCalendarDate(second?.dateAdministered) ? second.dateAdministered : '';
  const dateOrder = compareText(firstDate, secondDate);
  if (dateOrder) return dateOrder;
  const createdAtOrder = timestamp(first?.createdAt) - timestamp(second?.createdAt);
  if (createdAtOrder) return Math.sign(createdAtOrder);
  return compareText(String(first?.id ?? ''), String(second?.id ?? ''));
}

export function latestImmunizationsByStudentVaccine(records = [], getStudentId = (record) => record.studentId ?? record.patientId) {
  const latest = new Map();
  for (const [index, record] of records.entries()) {
    const id = String(record?.id ?? index);
    const patientId = String(getStudentId(record) ?? '');
    const vaccineName = String(record?.vaccineName || '').trim().toLocaleLowerCase();
    const vaccineKey = vaccineName ? `vaccine:${vaccineName}` : `unknown:${id}`;
    const key = JSON.stringify([patientId || `unknown-patient:${id}`, vaccineKey]);
    const current = latest.get(key);
    if (!current || compareImmunizationLatest(record, current) > 0) latest.set(key, record);
  }
  return [...latest.values()];
}
