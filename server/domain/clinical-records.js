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

export function validateChangedClinicalRecords(before = {}, next = {}) {
  const changedImmunizations = changedRecords(before.immunizations, next.immunizations);
  if (changedImmunizations.length) {
    return { valid: false, status: 410, code: 'FEATURE_REMOVED', message: 'Immunization records are retained as historical data and cannot be created or changed.' };
  }
  const changedRetiredRecords = [
    ...changedRecords(before.screenings, next.screenings),
    ...changedRecords(before.incidents, next.incidents),
  ];
  if (changedRetiredRecords.length) {
    return { valid: false, status: 410, code: 'FEATURE_REMOVED', message: 'Screening and incident records are retained as historical data; this feature has been removed and records cannot be created or changed.' };
  }

  return { valid: true };
}
