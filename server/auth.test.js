import test from 'node:test';
import assert from 'node:assert/strict';
import {
  accountLoginAttemptKey,
  clearSession,
  consumeOtp,
  createOtpChallenge,
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
  passwordResetChallenge,
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

test('concurrent OTP requests serialize destination cooldown checks before insert or email', async () => {
  let rows = [];
  let queue = Promise.resolve();
  let sent = 0;
  const transactionFn = async (work) => {
    let release;
    const previous = queue;
    queue = new Promise((resolve) => { release = resolve; });
    await previous;
    const staged = [...rows];
    const client = { query: async (sql, params = []) => {
      if (/pg_advisory_xact_lock/.test(sql)) return { rows: [], rowCount: 1 };
      if (/SELECT created_at FROM otp_challenges/.test(sql)) return { rows: staged.filter((row) => row.destination === params[0] && row.purpose === params[1]).map(() => ({ created_at: new Date() })), rowCount: staged.some((row) => row.destination === params[0] && row.purpose === params[1]) ? 1 : 0 };
      if (/UPDATE otp_challenges SET consumed_at=NOW\(\),metadata='\{\}'::jsonb/.test(sql)) return { rows: [], rowCount: 0 };
      if (/INSERT INTO otp_challenges/.test(sql)) {
        staged.push({ id: params[0], destination: params[2], purpose: params[3] });
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected OTP query: ${sql}`);
    } };
    try {
      const value = await work(client);
      rows = staged;
      return value;
    } finally { release(); }
  };
  const request = () => createOtpChallenge({ email: 'Guardian@Example.test' }, 'guardian_signup', { name: 'Guardian' }, {
    transactionFn, sendEmail: async () => { sent += 1; }, queryFn: async () => ({ rowCount: 1 }),
  });
  const results = await Promise.allSettled([request(), request()]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.find((result) => result.status === 'rejected').reason.code, 'OTP_COOLDOWN');
  assert.equal(sent, 1);
  assert.equal(rows.length, 1);
});

test('deferred OTP delivery returns before SMTP and retains the challenge after delivery failure', async () => {
  let challengeRow = null;
  const deletes = [];
  const logged = [];
  const transactionFn = async (work) => work({ query: async (sql, params = []) => {
    if (/pg_advisory_xact_lock/.test(sql)) return { rows: [], rowCount: 1 };
    if (/SELECT created_at FROM otp_challenges/.test(sql)) return { rows: [], rowCount: 0 };
    if (/UPDATE otp_challenges SET consumed_at=NOW\(\),metadata='\{\}'::jsonb/.test(sql)) return { rows: [], rowCount: 0 };
    if (/INSERT INTO otp_challenges/.test(sql)) {
      challengeRow = { id: params[0], destination: params[2], purpose: params[3] };
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`Unexpected OTP query: ${sql}`);
  } });
  let rejectDelivery;
  const pendingDelivery = new Promise((_, reject) => { rejectDelivery = reject; });
  const challengeId = await createOtpChallenge({ email: 'guardian@example.test' }, 'guardian_signup', { name: 'Guardian' }, {
    transactionFn,
    queryFn: async (sql) => { deletes.push(sql); return { rowCount: 1 }; },
    sendEmail: () => pendingDelivery,
    deferDelivery: true,
    logger: { error: (message) => logged.push(message) },
  });
  assert.equal(challengeRow.id, challengeId);
  assert.deepEqual(deletes, []);

  rejectDelivery(new Error('SMTP unavailable'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(deletes, []);
  assert.deepEqual(logged, ['OTP delivery could not be completed.']);
  assert.equal(challengeRow.id, challengeId);
});

test('a resent guardian signup code invalidates its predecessor and erases the old password hash', async () => {
  const rows = [{ id: 'old-challenge', destination: 'guardian@example.test', purpose: 'guardian_signup', metadata: { passwordHash: 'old-bcrypt-hash' }, consumed_at: null }];
  const transactionFn = async (work) => {
    const staged = structuredClone(rows);
    const result = await work({ query: async (sql, params = []) => {
      if (/pg_advisory_xact_lock/.test(sql)) return { rows: [], rowCount: 1 };
      if (/SELECT created_at FROM otp_challenges/.test(sql)) return { rows: [], rowCount: 0 };
      if (/UPDATE otp_challenges SET consumed_at=NOW\(\),metadata='\{\}'::jsonb/.test(sql)) {
        for (const row of staged) if (row.destination === params[0] && row.purpose === params[1] && !row.consumed_at) { row.consumed_at = new Date(); row.metadata = {}; }
        return { rows: [], rowCount: 1 };
      }
      if (/INSERT INTO otp_challenges/.test(sql)) {
        staged.push({ id: params[0], destination: params[2], purpose: params[3], metadata: JSON.parse(params[7]), consumed_at: null });
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected OTP query: ${sql}`);
    } });
    rows.splice(0, rows.length, ...staged);
    return result;
  };
  await createOtpChallenge({ email: 'guardian@example.test' }, 'guardian_signup', { passwordHash: 'new-bcrypt-hash' }, {
    transactionFn,
    sendEmail: async () => {},
    deferDelivery: true,
  });
  assert.deepEqual(rows[0].metadata, {});
  assert.ok(rows[0].consumed_at);
  assert.equal(rows[1].metadata.passwordHash, 'new-bcrypt-hash');
  assert.equal(JSON.stringify(rows[0]).includes('old-bcrypt-hash'), false);
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

function otpStore({ purpose = 'guardian_signup', code = '123456', expiresAt = Date.now() + 60_000, attempts = 0, consumedAt = null } = {}) {
  const id = '00000000-0000-4000-8000-000000000001';
  const challenge = {
    id, user_id: null, destination: 'guardian@example.test', purpose,
    code_hash: hashSecret(`${id}:guardian@example.test:${code}`), max_attempts: 5,
    attempts, expires_at: new Date(expiresAt), consumed_at: consumedAt,
    metadata: { name: 'Guardian' },
  };
  const client = { query: async (sql, params) => {
    if (/SELECT \* FROM otp_challenges/.test(sql)) return { rows: params[0] === id ? [challenge] : [], rowCount: params[0] === id ? 1 : 0 };
    if (/SET attempts=attempts\+1,metadata='\{\}'::jsonb/.test(sql)) { challenge.attempts += 1; challenge.metadata = {}; return { rowCount: 1, rows: [] }; }
    if (/SET metadata='\{\}'::jsonb/.test(sql)) { challenge.metadata = {}; return { rowCount: 1, rows: [] }; }
    if (/SET attempts=attempts\+1/.test(sql)) { challenge.attempts += 1; return { rowCount: 1, rows: [] }; }
    if (/SET consumed_at=NOW\(\)/.test(sql)) { challenge.consumed_at = new Date(); return { rowCount: 1, rows: [] }; }
    throw new Error(`Unexpected OTP query: ${sql}`);
  } };
  let queue = Promise.resolve();
  const transactionFn = async (work) => {
    let release;
    const previous = queue;
    queue = new Promise((resolve) => { release = resolve; });
    await previous;
    const snapshot = structuredClone(challenge);
    try { return await work(client); }
    catch (error) { Object.assign(challenge, snapshot); throw error; }
    finally { release(); }
  };
  return { id, challenge, transactionFn };
}

test('OTP rejects expiry, wrong purpose, replay, and exhausted attempts without consuming a new challenge', async () => {
  const expired = otpStore({ expiresAt: Date.now() - 1 });
  assert.equal(await consumeOtp(expired.id, '123456', 'guardian_signup', { transactionFn: expired.transactionFn }), null);
  assert.deepEqual(expired.challenge.metadata, {}, 'expired signup challenge drops its password hash metadata');
  const wrongPurpose = otpStore();
  assert.equal(await consumeOtp(wrongPurpose.id, '123456', 'login', { transactionFn: wrongPurpose.transactionFn }), null);
  assert.equal(wrongPurpose.challenge.consumed_at, null);
  assert.deepEqual(wrongPurpose.challenge.metadata, { name: 'Guardian' }, 'a login attempt cannot invalidate a signup challenge');
  const consumed = otpStore({ consumedAt: new Date() });
  assert.equal(await consumeOtp(consumed.id, '123456', 'guardian_signup', { transactionFn: consumed.transactionFn }), null);
  assert.deepEqual(consumed.challenge.metadata, {});
  const exhausted = otpStore({ attempts: 5 });
  assert.equal(await consumeOtp(exhausted.id, '123456', 'guardian_signup', { transactionFn: exhausted.transactionFn }), null);
  assert.deepEqual(exhausted.challenge.metadata, {});
});

test('OTP wrong-code attempts commit while a later account creation failure rolls consumption back', async () => {
  const wrong = otpStore();
  assert.equal(await consumeOtp(wrong.id, '654321', 'guardian_signup', { transactionFn: wrong.transactionFn }), null);
  assert.equal(wrong.challenge.attempts, 1);
  assert.equal(wrong.challenge.consumed_at, null);
  assert.deepEqual(wrong.challenge.metadata, { name: 'Guardian' }, 'retryable wrong codes retain signup data until the attempt limit');

  const finalAttempt = otpStore({ attempts: 4 });
  assert.equal(await consumeOtp(finalAttempt.id, '654321', 'guardian_signup', { transactionFn: finalAttempt.transactionFn }), null);
  assert.equal(finalAttempt.challenge.attempts, 5);
  assert.deepEqual(finalAttempt.challenge.metadata, {}, 'the attempt that exhausts the challenge also erases the password hash');

  const failure = otpStore();
  await assert.rejects(consumeOtp(failure.id, '123456', 'guardian_signup', {
    transactionFn: failure.transactionFn,
    onConsume: async () => { throw new Error('unique constraint'); },
  }), /unique constraint/);
  assert.equal(failure.challenge.consumed_at, null);
});

test('concurrent successful OTP verification consumes a challenge once', async () => {
  const store = otpStore();
  const consume = () => consumeOtp(store.id, '123456', 'guardian_signup', { transactionFn: store.transactionFn });
  const results = await Promise.all([consume(), consume()]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.ok(store.challenge.consumed_at);
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


test('password recovery keeps delivery failures and unavailable accounts generic', async () => {
  const active = { id: 'fictional-account', status: 'active', role: 'guardian' };
  const options = { newId: () => 'opaque-fallback', logger: { error() {} } };
  for (const user of [null, { ...active, status: 'inactive' }, { ...active, role: 'student' }]) {
    assert.equal(await passwordResetChallenge(user, { ...options, issueChallenge: () => assert.fail('unavailable account must not send') }), 'opaque-fallback');
  }
  assert.equal(await passwordResetChallenge(active, { ...options, issueChallenge: async (user, purpose) => {
    assert.equal(user, active); assert.equal(purpose, 'password_reset'); return 'issued-challenge';
  } }), 'issued-challenge');
  const logs = [];
  assert.equal(await passwordResetChallenge(active, { ...options, logger: { error: (...args) => logs.push(args) }, issueChallenge: async () => {
    throw new Error('private provider/account detail');
  } }), 'opaque-fallback');
  assert.deepEqual(logs, [['Password reset delivery could not be completed.']]);
});
