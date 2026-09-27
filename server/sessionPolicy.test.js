import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SESSION_ABSOLUTE_TTL_MS,
  sessionCookieMaxAgeSeconds,
} from './sessionPolicy.js';

test('session absolute lifetime is capped at twelve hours', () => {
  assert.equal(SESSION_ABSOLUTE_TTL_MS, 12 * 60 * 60 * 1000);
});

test('remembered cookies never outlive the absolute session cap', () => {
  const now = Date.parse('2026-09-26T00:00:00Z');
  assert.equal(sessionCookieMaxAgeSeconds(false, now + SESSION_ABSOLUTE_TTL_MS, now), null);
  assert.equal(sessionCookieMaxAgeSeconds(true, now + SESSION_ABSOLUTE_TTL_MS * 2, now), SESSION_ABSOLUTE_TTL_MS / 1000);
  assert.equal(sessionCookieMaxAgeSeconds(true, now + 60_000, now), 60);
});
