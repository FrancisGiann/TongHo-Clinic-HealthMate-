import test from 'node:test';
import assert from 'node:assert/strict';
import { clearExpiredGuardianSignupOtpMetadata } from './auth.js';
import { startGuardianSignupOtpCleanupScheduler } from './authCleanup.js';

test('expired and exhausted signup cleanup clears only OTP metadata without deleting challenge history', async () => {
  let statement;
  await clearExpiredGuardianSignupOtpMetadata(async (sql, ...params) => {
    statement = { sql, params };
    return { rowCount: 2, rows: [{ id: 'expired' }, { id: 'exhausted' }] };
  });
  assert.match(statement.sql, /purpose='guardian_signup'/);
  assert.match(statement.sql, /expires_at<=NOW\(\) OR attempts>=max_attempts OR consumed_at IS NOT NULL/);
  assert.match(statement.sql, /SET metadata='\{\}'::jsonb/);
  assert.doesNotMatch(statement.sql, /DELETE FROM otp_challenges/);
  assert.deepEqual(statement.params, []);
});

test('signup metadata cleanup runs at startup and periodically, with an awaitable stop', async () => {
  let runOnce;
  let intervalCallback;
  let runs = 0;
  const cleared = [];
  const stop = startGuardianSignupOtpCleanupScheduler({
    enabled: true,
    initialDelayMs: 0,
    intervalMs: 60_000,
    run: async () => { runs += 1; await new Promise((resolve) => { cleared.push(resolve); }); },
    setTimeoutFn: (callback) => { runOnce = callback; return 'initial'; },
    setIntervalFn: (callback) => { intervalCallback = callback; return 'periodic'; },
    clearTimeoutFn: () => {},
    clearIntervalFn: () => {},
  });
  runOnce();
  await Promise.resolve();
  assert.equal(runs, 1);
  cleared.shift()();
  await stop.drain();
  intervalCallback();
  await Promise.resolve();
  assert.equal(runs, 2);
  const drain = stop();
  cleared.shift()();
  await drain;
});

test('signup metadata cleanup is inert when the database is not configured', async () => {
  const stop = startGuardianSignupOtpCleanupScheduler({ enabled: false, run: async () => assert.fail('must not run') });
  await stop();
  await stop.drain();
});
