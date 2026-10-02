import { createHash } from 'node:crypto';

const REQUEST_FINGERPRINT_FIELD = '_requestFingerprint';

export function validVisitRequestId(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function visitRequestFingerprint(input) {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

export function matchesVisitRequest(existing, userId, fingerprint) {
  return String(existing?.created_by || '') === String(userId || '')
    && existing?.data?.[REQUEST_FINGERPRINT_FIELD] === fingerprint;
}

export function publicVisitRecord(record) {
  if (!record || typeof record !== 'object') return record;
  const { [REQUEST_FINGERPRINT_FIELD]: _requestFingerprint, ...visible } = record;
  return visible;
}

export async function findVisitRequest(queryFn, requestId, userId, fingerprint, { forUpdate = false } = {}) {
  if (!requestId) return null;
  const result = await queryFn(
    `SELECT v.id,v.patient_id,v.data,v.created_by,p.patient_type,p.data->>'name' AS patient_name
     FROM visits v LEFT JOIN patients p ON p.id=v.patient_id WHERE v.id=$1${forUpdate ? ' FOR UPDATE OF v' : ''}`,
    [requestId],
  );
  if (!result.rowCount) return null;
  const prior = result.rows[0];
  if (!matchesVisitRequest(prior, userId, fingerprint)) return { kind: 'conflict' };
  const visit = publicVisitRecord(prior.data);
  return {
    kind: 'replay',
    visit,
    assessment: visit.riskAssessment,
    patientType: prior.patient_type || '',
    patientName: prior.patient_name || '',
  };
}

// Call inside the clinic data transaction, which serializes writes on clinic_settings.
export async function createOrReplayVisitRequest(client, options) {
  const { requestId, userId, fingerprint, create } = options;
  const existing = await findVisitRequest(client.query.bind(client), requestId, userId, fingerprint, { forUpdate: true });
  if (existing) return existing;
  return { kind: 'created', value: await create() };
}
