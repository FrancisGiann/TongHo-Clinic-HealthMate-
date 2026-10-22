import test from 'node:test';
import assert from 'node:assert/strict';
import { guardianSignupDecisionEmail, publicGuardianSignupRequest, validateGuardianSignupDecisionReason, validateGuardianSignupPageQuery } from './guardianSignupApproval.js';

test('guardian signup request pagination validates bounded filters and sizes', () => {
  assert.deepEqual(validateGuardianSignupPageQuery({}), { valid: true, value: { status: 'pending_review', order: 'newest', limit: 25, page: 1, search: '' } });
  for (const query of [{ status: 'active' }, { order: 'random' }, { limit: 20 }, { page: '1.5' }, { page: 10001 }, { q: 'x'.repeat(101) }]) {
    assert.equal(validateGuardianSignupPageQuery(query).valid, false);
  }
});

test('guardian signup admin projection never returns a password hash or raw metadata', () => {
  const request = publicGuardianSignupRequest({ id: 'request-id', name: 'Parent', email: 'p@example.test', username: 'parent', student_id: 'S 1', relationship: 'Parent', status: 'pending_review', password_hash: 'secret', metadata: { password: 'raw' } });
  assert.equal(request.studentId, 'S 1');
  assert.equal('passwordHash' in request, false);
  assert.equal('password_hash' in request, false);
  assert.equal(JSON.stringify(request).includes('secret'), false);
});

test('rejection reasons are bounded and decision email copy has no rejection detail', () => {
  assert.equal(validateGuardianSignupDecisionReason('  verified mismatch  ').value, 'verified mismatch');
  assert.equal(validateGuardianSignupDecisionReason(' ').valid, false);
  assert.equal(validateGuardianSignupDecisionReason('x'.repeat(501)).valid, false);
  const email = guardianSignupDecisionEmail('rejected', '<Guardian>');
  assert.equal(email.html.includes('&lt;Guardian&gt;'), true);
  assert.equal(email.text.includes('verified mismatch'), false);
});
