import test from 'node:test';
import assert from 'node:assert/strict';
import {
  accountLoginAttemptKey,
  clearSession,
  consumeOtp,
  currentSessionTokenHash,
  hashSecret,
  listUserSessions,
  LOGIN_FAILURE_LIMIT,
  loginFailureKeyFor,
  loginAttemptsRemaining,
  loginAttemptsShouldLock,
  loginLockActive,
  normalizeIdentifier,
  issueSession,
  loadSession,
  publicUser,
  revokeAllUserSessions,
  revokeUserSession,
  validEmail,
  validatePassword,
} from './auth.js';

test('authentication input helpers normalize identifiers and validate email', () => {
  assert.equal(normalizeIdentifier('  Nurse@Example.COM '), 'nurse@example.com');
  assert.equal(validEmail('nurse@example.com'), true);
  assert.equal(validEmail('not-an-email'), false);
});

test('password policy requires length and character classes', () => {
  assert.match(validatePassword('short') || '', /12 characters/);
  assert.match(validatePassword('alllowercase123') || '', /uppercase/i);
  assert.equal(validatePassword('StrongPassword1!'), null);
  assert.match(validatePassword(`Aa1!${'x'.repeat(1021)}`) || '', /1,024 characters/);
});

test('public nurse license status requires both an admin verifier and a recorded license', () => {
  const account = { id: 'nurse-id', role: 'school_nurse', prc_license_number: 'PRC-123' };
  assert.equal(publicUser(account).prcLicenseVerified, false);
  assert.equal(publicUser({ ...account, prc_license_verified_at: new Date(), prc_license_verified_by: 'admin-id' }).prcLicenseVerified, true);
  assert.equal(publicUser({ ...account, prc_license_number: '', prc_license_verified_at: new Date(), prc_license_verified_by: 'admin-id' }).prcLicenseVerified, false);
});

test('malformed OTP challenge IDs and codes are rejected before database access', async () => {
  assert.equal(await consumeOtp('not-a-uuid', '123456', 'login'), null);
  assert.equal(await consumeOtp('00000000-0000-4000-8000-000000000000', '12345', 'login'), null);
  assert.equal(await consumeOtp('00000000-0000-4000-8000-000000000000', '12x456', 'login'), null);
});

test('secret hashing is deterministic without returning the source value', () => {
  const first = hashSecret('sensitive-token');
  assert.equal(first, hashSecret('sensitive-token'));
  assert.notEqual(first, 'sensitive-token');
  assert.equal(first.length, 64);
});

test('durable failed-login policy locks after five account attempts for fifteen minutes', () => {
  assert.equal(LOGIN_FAILURE_LIMIT, 5);
  assert.equal(accountLoginAttemptKey(' Nurse@Example.COM '), 'nurse@example.com');
  const user = { id: 'A1B2C3D4-E5F6-4789-ABCD-0123456789AB' };
  assert.equal(loginFailureKeyFor(user, 'clinicnurse'), 'user:a1b2c3d4-e5f6-4789-abcd-0123456789ab');
  assert.equal(loginFailureKeyFor(user, 'nurse@example.com'), loginFailureKeyFor(user, 'clinicnurse'));
  assert.equal(loginFailureKeyFor(null, ' Nurse@Example.COM '), 'nurse@example.com');
  assert.equal(loginAttemptsRemaining(4), 1);
  assert.equal(loginAttemptsRemaining(5), 0);
  assert.equal(loginAttemptsShouldLock(4), false);
  assert.equal(loginAttemptsShouldLock(5), true);
  assert.equal(loginLockActive('2026-01-01T00:00:01Z', Date.parse('2026-01-01T00:00:00Z')), true);
  assert.equal(loginLockActive('2026-01-01T00:00:00Z', Date.parse('2026-01-01T00:00:00Z')), false);
});

test('session issuance locks the account before insert and evicts beyond three sessions atomically', async () => {
  const originalEnvironment = new Map(['NODE_ENV', 'COOKIE_SECURE'].map((key) => [key, process.env[key]]));
  process.env.NODE_ENV = 'test';
  delete process.env.COOKIE_SECURE;
  const calls = [];
  const responseHeaders = {};
  const request = {
    ip: '203.0.113.7',
    headers: { 'x-forwarded-for': '198.51.100.9', 'user-agent': 'Test Browser' },
    socket: { remoteAddress: '127.0.0.1' },
  };
  try {
    await issueSession(request, { setHeader: (name, value) => { responseHeaders[name] = value; } }, { id: 'account-1' }, true, {
      transactionFn: async (work) => work({
        query: async (sql, params) => {
          calls.push({ sql, params });
          return { rows: [], rowCount: 1 };
        },
      }),
    });
    assert.match(calls[0].sql, /SELECT id FROM users WHERE id=\$1 FOR UPDATE/);
    assert.equal(calls[1].params[0], 'account-1');
    assert.match(calls[1].sql, /last_seen_at<=NOW\(\)-\(\$2::double precision/);
    assert.match(calls[2].sql, /INSERT INTO sessions/);
    assert.equal(calls[2].params[3], '203.0.113.7');
    assert.match(calls[3].sql, /ROW_NUMBER\(\) OVER \(ORDER BY created_at DESC,token_hash DESC\)/);
    assert.deepEqual(calls[3].params, ['account-1', 3]);
    assert.match(responseHeaders['Set-Cookie'], /Max-Age=\d+/);
    assert.doesNotMatch(responseHeaders['Set-Cookie'], /Secure/);
  } finally {
    for (const [key, value] of originalEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('session operations scope listing and revocation to the authenticated account', async () => {
  const queries = [];
  const accountId = 'account-a';
  const currentHash = 'a'.repeat(64);
  const rows = await listUserSessions(accountId, currentHash, async (sql, params) => {
    queries.push({ sql, params });
    return { rows: [{ token_hash: currentHash, created_at: new Date(0), last_seen_at: new Date(1), expires_at: new Date(2), user_agent: 'Browser' }] };
  });
  assert.equal(queries[0].params[0], accountId);
  assert.match(queries[0].sql, /WHERE user_id=\$1/);
  assert.equal(rows[0].current, true);
  assert.equal(rows[0].sessionId, currentHash);

  await revokeUserSession(accountId, currentHash, async (sql, params) => {
    queries.push({ sql, params });
    return { rowCount: 1, rows: [{ token_hash: currentHash }] };
  });
  assert.deepEqual(queries[1].params, [currentHash, accountId]);
  assert.match(queries[1].sql, /WHERE token_hash=\$1 AND user_id=\$2/);

  await revokeAllUserSessions(accountId, async (sql, params) => {
    queries.push({ sql, params });
    return { rowCount: 2, rows: [] };
  });
  assert.deepEqual(queries[2].params, [accountId]);
  assert.match(queries[2].sql, /DELETE FROM sessions WHERE user_id=\$1/);
});

test('session middleware applies idle and absolute expiry before refreshing activity', async () => {
  const token = 'b'.repeat(43);
  const req = { headers: { cookie: `healthmate_session=${token}` } };
  const calls = [];
  let nextCalled = false;
  await loadSession(req, {}, () => { nextCalled = true; }, async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [{ id: 'account-a', role: 'student', status: 'active' }] };
  });
  assert.equal(nextCalled, true);
  assert.equal(req.user.id, 'account-a');
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /s\.expires_at>NOW\(\)/);
  assert.match(calls[0].sql, /s\.last_seen_at>NOW\(\)-\(\$2::double precision/);
  assert.deepEqual(calls[0].params, [hashSecret(token), 15 * 60 * 1000]);

  const expiredReq = { headers: { cookie: `healthmate_session=${token}` } };
  const expiredCalls = [];
  await loadSession(expiredReq, {}, () => {}, async (sql, params) => {
    expiredCalls.push({ sql, params });
    return expiredCalls.length === 1 ? { rows: [] } : { rowCount: 1, rows: [] };
  });
  assert.equal(expiredReq.user, undefined);
  assert.match(expiredCalls[1].sql, /DELETE FROM sessions WHERE token_hash=\$1/);
  assert.deepEqual(expiredCalls[1].params, [hashSecret(token)]);
});

test('cookie clearing retains Secure in production and session IDs use only the token hash', async () => {
  const originalEnvironment = new Map(['NODE_ENV', 'COOKIE_SECURE'].map((key) => [key, process.env[key]]));
  process.env.NODE_ENV = 'production';
  delete process.env.COOKIE_SECURE;
  let deletedHash;
  const token = 'a'.repeat(43);
  const req = { headers: { cookie: `healthmate_session=${token}` } };
  const responseHeaders = {};
  try {
    assert.equal(currentSessionTokenHash(req), hashSecret(token));
    await clearSession(req, { setHeader: (name, value) => { responseHeaders[name] = value; } }, async (_sql, params) => {
      deletedHash = params[0];
      return { rowCount: 1 };
    });
    assert.equal(deletedHash, hashSecret(token));
    assert.match(responseHeaders['Set-Cookie'], /Secure/);
    assert.match(responseHeaders['Set-Cookie'], /Max-Age=0/);
  } finally {
    for (const [key, value] of originalEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
