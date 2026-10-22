import test from 'node:test';
import assert from 'node:assert/strict';
import { incidentPhotoReadable, incidentPhotosEnabled, projectIncident, validateIncidentPayload, validateIncidentPhotoDecision } from './incidents.js';

const validPayload = { patientId: 'student-1', date: '2026-10-20', time: '09:15', location: 'Library', description: 'Fell during break', actionTaken: 'Assessed', visitId: 'visit-1' };

test('incident input is bounded and only accepts real Manila calendar dates and same-day times', () => {
  assert.deepEqual(validateIncidentPayload(validPayload), { valid: true, value: { patientId: 'student-1', incidentDate: '2026-10-20', incidentTime: '09:15', location: 'Library', description: 'Fell during break', actionTaken: 'Assessed', visitId: 'visit-1' } });
  assert.equal(validateIncidentPayload({ ...validPayload, date: '2026-02-30' }).code, 'INVALID_DATE');
  assert.equal(validateIncidentPayload({ ...validPayload, time: '24:01' }).code, 'INVALID_TIME');
  assert.equal(validateIncidentPayload({ ...validPayload, description: 'x'.repeat(5001) }).code, 'INVALID_DESCRIPTION');
  assert.equal(validateIncidentPayload({ ...validPayload, patientId: 'x'.repeat(121) }).code, 'INVALID_PATIENT');
});

test('incident projection is an explicit clinical whitelist and never includes legacy or photo internals', () => {
  const projected = projectIncident({ id: 'i-1', patient_id: 's-1', incident_date: '2026-10-20', incident_time: '09:15:00', location: 'Hall', description: 'Description', action_taken: 'Care', visit_id: null, private_notes: 'secret', storage_key: 'incidents/secret', fingerprint: 'secret' });
  assert.deepEqual(Object.keys(projected).sort(), ['actionTaken', 'createdAt', 'date', 'description', 'id', 'location', 'patientId', 'photos', 'time', 'updatedAt', 'visitId'].sort());
  assert.equal(JSON.stringify(projected).includes('secret'), false);
});

test('photo consent enforces current notice and state transitions', () => {
  assert.equal(validateIncidentPhotoDecision({ decision: 'granted', noticeVersion: 'old' }, { status: 'pending' }).code, 'NOTICE_VERSION_REQUIRED');
  const grant = validateIncidentPhotoDecision({ decision: 'granted', noticeVersion: 'incident-photo-defense-v1' }, { status: 'pending' });
  assert.equal(grant.valid, true);
  assert.equal(validateIncidentPhotoDecision({ decision: 'declined', noticeVersion: 'incident-photo-defense-v1' }, { status: 'granted' }).code, 'INVALID_CONSENT_STATE');
  assert.equal(validateIncidentPhotoDecision({ decision: 'revoked', noticeVersion: 'incident-photo-defense-v1' }, { status: 'granted' }).value.decision, 'revoked');
});

test('feature flag fails closed and photos require current grant, non-expired and non-deletion state', () => {
  assert.equal(incidentPhotosEnabled({}), false);
  assert.equal(incidentPhotosEnabled({ INCIDENT_PHOTOS_ENABLED: 'TRUE' }), true);
  const consent = { status: 'granted', granted_event_id: 'event-1' };
  const photo = { consent_event_id: 'event-1', expires_at: '2027-01-01T00:00:00Z' };
  assert.equal(incidentPhotoReadable({ enabled: true, consent, photo, now: '2026-12-31T23:00:00Z' }), true);
  assert.equal(incidentPhotoReadable({ enabled: false, consent, photo }), false);
  assert.equal(incidentPhotoReadable({ enabled: true, consent, photo: { ...photo, consent_event_id: 'event-old' } }), false);
  assert.equal(incidentPhotoReadable({ enabled: true, consent, photo: { ...photo, deletion_requested_at: 'now' } }), false);
  assert.equal(incidentPhotoReadable({ enabled: true, consent, photo, now: '2027-01-01T00:00:00Z' }), false);
});
