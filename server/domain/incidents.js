export const INCIDENT_PHOTO_NOTICE_VERSION = 'incident-photo-defense-v1';

export function incidentPhotosEnabled(env = process.env) {
  return String(env.INCIDENT_PHOTOS_ENABLED || '').trim().toLowerCase() === 'true';
}

export function validateIncidentPayload(payload = {}) {
  const patientId = String(payload.patientId || '').trim();
  const incidentDate = String(payload.date || '').trim();
  const incidentTime = String(payload.time || '').trim();
  const location = typeof payload.location === 'string' ? payload.location.trim() : '';
  const description = typeof payload.description === 'string' ? payload.description.trim() : '';
  const actionTaken = typeof payload.actionTaken === 'string' ? payload.actionTaken.trim() : '';
  const visitId = payload.visitId === undefined || payload.visitId === null || payload.visitId === '' ? null : String(payload.visitId).trim();
  if (!patientId || patientId.length > 120) return { valid: false, code: 'INVALID_PATIENT', message: 'Choose a valid student record.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(incidentDate) || !Number.isFinite(Date.parse(`${incidentDate}T00:00:00Z`)) || new Date(`${incidentDate}T00:00:00Z`).toISOString().slice(0, 10) !== incidentDate) {
    return { valid: false, code: 'INVALID_DATE', message: 'Choose a real incident date.' };
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(incidentTime)) return { valid: false, code: 'INVALID_TIME', message: 'Enter a valid incident time.' };
  if (!location || location.length > 160) return { valid: false, code: 'INVALID_LOCATION', message: 'Enter a location from 1 to 160 characters.' };
  if (!description || description.length > 5000) return { valid: false, code: 'INVALID_DESCRIPTION', message: 'Enter a description from 1 to 5000 characters.' };
  if (actionTaken.length > 5000) return { valid: false, code: 'INVALID_ACTION', message: 'Action taken must be 5000 characters or fewer.' };
  if (visitId && visitId.length > 120) return { valid: false, code: 'INVALID_VISIT', message: 'Choose a valid linked clinic visit.' };
  return { valid: true, value: { patientId, incidentDate, incidentTime, location, description, actionTaken, visitId } };
}

export function projectIncident(row, { includeSensitive = true, consent = null, photos = [] } = {}) {
  const data = row.data || row;
  const projection = {
    id: String(row.id || data.id || ''),
    patientId: String(row.patient_id || data.patientId || ''),
    date: String(row.incident_date || data.date || '').slice(0, 10),
    time: String(row.incident_time || data.time || '').slice(0, 5),
    location: String(row.location ?? data.location ?? ''),
    description: includeSensitive ? String(row.description ?? data.description ?? '') : undefined,
    actionTaken: includeSensitive ? String(row.action_taken ?? data.actionTaken ?? '') : undefined,
    visitId: row.visit_id || data.visitId || null,
    createdAt: row.created_at || data.createdAt || null,
    updatedAt: row.updated_at || data.updatedAt || null,
  };
  if (consent) projection.photoConsent = {
    status: consent.status,
    guardianUserId: consent.guardian_user_id || consent.guardianUserId,
    noticeVersion: consent.notice_version || consent.noticeVersion,
    updatedAt: consent.updated_at || consent.updatedAt || null,
  };
  projection.photos = photos.map((photo) => ({ id: String(photo.id), contentType: photo.content_type, sizeBytes: Number(photo.size_bytes), width: Number(photo.width), height: Number(photo.height), createdAt: photo.created_at, expiresAt: photo.expires_at }));
  return Object.fromEntries(Object.entries(projection).filter(([, value]) => value !== undefined));
}

export function validateIncidentPhotoDecision(payload = {}, current = {}) {
  const decision = String(payload.decision || '').trim();
  const version = String(payload.noticeVersion || '').trim();
  if (version !== INCIDENT_PHOTO_NOTICE_VERSION) return { valid: false, code: 'NOTICE_VERSION_REQUIRED', message: 'Review the current photo notice before responding.' };
  if (!['granted', 'declined', 'revoked'].includes(decision)) return { valid: false, code: 'INVALID_DECISION', message: 'Choose a valid photo-consent decision.' };
  const status = String(current.status || '');
  if (decision === 'granted' && !['pending', 'declined', 'revoked'].includes(status)) return { valid: false, code: 'INVALID_CONSENT_STATE', message: 'This photo request cannot be granted in its current state.' };
  if (decision === 'declined' && status !== 'pending') return { valid: false, code: 'INVALID_CONSENT_STATE', message: 'This photo request cannot be declined in its current state.' };
  if (decision === 'revoked' && status !== 'granted') return { valid: false, code: 'INVALID_CONSENT_STATE', message: 'Only active photo consent can be revoked.' };
  return { valid: true, value: { decision, noticeVersion: version } };
}

export function incidentPhotoReadable({ enabled, consent, photo, now = new Date() }) {
  if (!enabled || !consent || consent.status !== 'granted' || !photo) return false;
  if (String(photo.consent_event_id || photo.consentEventId || '') !== String(consent.granted_event_id || consent.grantedEventId || '')) return false;
  if (photo.deletion_requested_at || photo.deleted_at || photo.deletionRequestedAt || photo.deletedAt) return false;
  const expires = Date.parse(photo.expires_at || photo.expiresAt || '');
  return Number.isFinite(expires) && expires > new Date(now).getTime();
}

export function normalizeIncidentText(value) {
  return String(value || '').trim();
}
