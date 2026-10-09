export const rosterIdTrimCharacters = '\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';

export function normalizeRosterIdentifier(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function patientRosterIdentitySql(trimParameter) {
  const trim = `$${trimParameter}`;
  return `CASE WHEN patient_type='faculty'
    THEN COALESCE(NULLIF(BTRIM(data->>'facultyId',${trim}),''),BTRIM(data->>'studentId',${trim}),'')
    ELSE BTRIM(COALESCE(data->>'studentId',''),${trim}) END`;
}
