import { createHash } from 'node:crypto';

const CONSENT_STATUSES = new Set(['unrecorded', 'pending', 'received', 'not_required']);
const BROADCAST_TYPES = new Set(['announcement', 'emergency', 'consent_reminder']);
const BROADCAST_ROLES = new Set(['guardian', 'school_nurse', 'system_administrator']);

function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function validateConsentUpdate(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { valid: false, message: 'Consent status is required.' };
  }
  const status = payload.consentStatus;
  if (!CONSENT_STATUSES.has(status)) {
    return { valid: false, message: 'Choose not recorded, pending, received, or not required.' };
  }
  if (status === 'pending') {
    if (!isIsoDate(payload.consentDueDate)) {
      return { valid: false, message: 'A valid due date is required for pending consent.' };
    }
    return { valid: true, value: { consentStatus: status, consentDueDate: payload.consentDueDate } };
  }
  return { valid: true, value: { consentStatus: status, consentDueDate: null } };
}

export function validateBroadcastPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { valid: false, message: 'A broadcast message is required.' };
  }
  const type = payload.type;
  const subject = typeof payload.subject === 'string' ? payload.subject.trim() : '';
  const body = typeof payload.body === 'string' ? payload.body.trim() : '';
  const roles = payload.roles;
  if (!BROADCAST_TYPES.has(type)) return { valid: false, message: 'Choose a valid notification type.' };
  if (!subject || subject.length > 160) return { valid: false, message: 'Subject must be between 1 and 160 characters.' };
  if (/[\u0000-\u001f\u007f]/.test(subject)) return { valid: false, message: 'Subject must be a single line without control characters.' };
  if (!body || body.length > 2000) return { valid: false, message: 'Message must be between 1 and 2000 characters.' };
  if (body.includes('\u0000')) return { valid: false, message: 'Message contains an unsupported character.' };
  if (!Array.isArray(roles) || roles.length === 0 || roles.some((role) => !BROADCAST_ROLES.has(role))) {
    return { valid: false, message: 'Choose at least one valid recipient role.' };
  }
  if (new Set(roles).size !== roles.length) return { valid: false, message: 'Recipient roles must not be repeated.' };
  if (!validUuid(payload.requestId)) return { valid: false, message: 'A valid request id is required.' };
  return { valid: true, value: { type, subject, body, roles, requestId: payload.requestId } };
}

export function broadcastBatchId(actorId, requestId) {
  return createHash('sha256').update(`${String(actorId)}:${String(requestId)}`).digest('hex');
}
