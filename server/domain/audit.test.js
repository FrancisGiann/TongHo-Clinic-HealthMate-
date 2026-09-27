import test from 'node:test';
import assert from 'node:assert/strict';
import { redactAuditDetails, sanitizeAuditLogs } from './audit.js';

test('audit response keeps account metadata but strips clinical narratives', () => {
  const safe = redactAuditDetails('USER_INVITED', { email: 'nurse@example.test', role: 'school_nurse', password: 'secret' });
  assert.deepEqual(safe, { role: 'school_nurse', email: 'nurse@example.test' });
  assert.deepEqual(redactAuditDetails('QUEUE_ENTRY_CREATED', {
    triagePriority: 3,
    priority: 3,
    prioritySource: 'nurse',
    triageReason: 'Sensitive symptom narrative',
  }), { triagePriority: 3, prioritySource: 'nurse', priority: 3 });
  assert.deepEqual(redactAuditDetails('RISK_ASSESSMENT_ACKNOWLEDGED', { overrideReason: 'Sensitive explanation' }), {});
});

test('audit log sanitizer does not pass through unknown event details', () => {
  const [entry] = sanitizeAuditLogs([{ event: 'UNKNOWN_EVENT', details: { private: 'value' } }]);
  assert.deepEqual(entry.details, {});
});

test('nurse license audit details record verification status without the license number', () => {
  assert.deepEqual(redactAuditDetails('NURSE_PRC_LICENSE_VERIFICATION_UPDATED', {
    verified: true,
    cleared: false,
    prcLicenseNumber: 'PRIVATE-123',
  }), { verified: true, cleared: false });
});
