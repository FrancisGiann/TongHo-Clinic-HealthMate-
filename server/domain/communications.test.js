import test from 'node:test';
import assert from 'node:assert/strict';
import { broadcastBatchId, validateBroadcastPayload, validateConsentUpdate } from './communications.js';

test('pending consent requires a real calendar due date and clears dates for completed statuses', () => {
  assert.deepEqual(validateConsentUpdate({ consentStatus: 'pending', consentDueDate: '2026-09-30' }), {
    valid: true,
    value: { consentStatus: 'pending', consentDueDate: '2026-09-30' },
  });
  assert.equal(validateConsentUpdate({ consentStatus: 'pending', consentDueDate: '2026-02-30' }).valid, false);
  assert.equal(validateConsentUpdate({ consentStatus: 'pending', consentDueDate: '' }).valid, false);
  assert.deepEqual(validateConsentUpdate({ consentStatus: 'received', consentDueDate: '2026-09-30' }), {
    valid: true,
    value: { consentStatus: 'received', consentDueDate: null },
  });
  assert.deepEqual(validateConsentUpdate({ consentStatus: 'unrecorded', consentDueDate: null }), {
    valid: true,
    value: { consentStatus: 'unrecorded', consentDueDate: null },
  });
  assert.equal(validateConsentUpdate({ consentStatus: 'unknown', consentDueDate: null }).valid, false);
});

test('broadcast requires bounded content, explicit valid recipients, and a UUID retry key', () => {
  const payload = {
    type: 'emergency',
    subject: '  Weather closure  ',
    body: ' Please follow the school advisory. ',
    roles: ['guardian', 'school_nurse'],
    requestId: 'c694f921-0cc7-4b2b-a94f-d9362b8fb497',
  };
  assert.deepEqual(validateBroadcastPayload(payload), {
    valid: true,
    value: { ...payload, subject: 'Weather closure', body: 'Please follow the school advisory.' },
  });
  assert.equal(validateBroadcastPayload({ ...payload, roles: ['guardian', 'invalid'] }).valid, false);
  assert.equal(validateBroadcastPayload({ ...payload, roles: ['student'] }).valid, false);
  assert.equal(validateBroadcastPayload({ ...payload, roles: ['guardian', 'guardian'] }).valid, false);
  assert.equal(validateBroadcastPayload({ ...payload, roles: [] }).valid, false);
  assert.equal(validateBroadcastPayload({ ...payload, subject: ' '.repeat(161) }).valid, false);
  assert.equal(validateBroadcastPayload({ ...payload, subject: 'Update\nBcc: recipient@example.test' }).valid, false);
  assert.equal(validateBroadcastPayload({ ...payload, body: 'invalid\u0000message' }).valid, false);
  assert.equal(validateBroadcastPayload({ ...payload, requestId: 'retry-later' }).valid, false);
});

test('broadcast retry keys are stable per administrator and isolated across administrators', () => {
  const requestId = 'c694f921-0cc7-4b2b-a94f-d9362b8fb497';
  assert.equal(broadcastBatchId('admin-1', requestId), broadcastBatchId('admin-1', requestId));
  assert.notEqual(broadcastBatchId('admin-1', requestId), broadcastBatchId('admin-2', requestId));
});
