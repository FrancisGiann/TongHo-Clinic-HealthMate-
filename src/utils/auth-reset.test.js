import test from 'node:test';
import assert from 'node:assert/strict';
import { api } from './api.js';
import { clearPasswordReset, requestPasswordReset, resetPassword } from './auth.js';

test('reset challenges are cleared on cancellation and cannot return from a stale request', async () => {
  const originalPost = api.post;
  let finishRequest;
  api.post = () => new Promise((resolve) => { finishRequest = resolve; });
  try {
    const pending = requestPasswordReset('synthetic@example.invalid');
    clearPasswordReset();
    finishRequest({ challengeId: 'old-challenge', message: 'If the account exists, a reset code was sent.' });
    assert.equal((await pending).success, false);
    let posted = false;
    api.post = async () => { posted = true; };
    assert.equal((await resetPassword('synthetic@example.invalid', '123456', 'Example!234567')).success, false);
    assert.equal(posted, false);
  } finally {
    clearPasswordReset();
    api.post = originalPost;
  }
});

test('reset errors preserve the challenge for retry and success consumes the client challenge', async () => {
  const originalPost = api.post;
  const calls = [];
  let failConfirm = true;
  api.post = async (path, body) => {
    calls.push({ path, body });
    if (path.endsWith('/request')) return { challengeId: 'synthetic-challenge' };
    if (failConfirm) throw new Error('The reset code is invalid or expired.');
    return { message: 'Password reset.' };
  };
  try {
    assert.equal((await requestPasswordReset('synthetic@example.invalid')).success, true);
    assert.equal((await resetPassword('synthetic@example.invalid', '123456', 'Example!234567')).error, 'The reset code is invalid or expired.');
    failConfirm = false;
    assert.equal((await resetPassword('synthetic@example.invalid', '654321', 'Example!234567')).success, true);
    assert.equal(calls[2].body.challengeId, 'synthetic-challenge');
    assert.equal((await resetPassword('synthetic@example.invalid', '654321', 'Example!234567')).success, false);
    assert.equal(calls.length, 3);
  } finally {
    clearPasswordReset();
    api.post = originalPost;
  }
});

test('a late confirmation cannot clear a newly requested challenge after leaving the reset form', async () => {
  const originalPost = api.post;
  let finishConfirmation;
  api.post = async (path) => path.endsWith('/request')
    ? { challengeId: 'first-challenge' }
    : new Promise((resolve) => { finishConfirmation = resolve; });
  try {
    await requestPasswordReset('first@example.invalid');
    const pending = resetPassword('first@example.invalid', '123456', 'Example!234567');
    clearPasswordReset();
    api.post = async () => ({ challengeId: 'next-challenge' });
    await requestPasswordReset('next@example.invalid');
    finishConfirmation({ message: 'Password reset.' });
    await pending;
    let confirmed;
    api.post = async (_path, body) => { confirmed = body; return {}; };
    assert.equal((await resetPassword('next@example.invalid', '654321', 'Example!234567')).success, true);
    assert.equal(confirmed.challengeId, 'next-challenge');
  } finally {
    clearPasswordReset();
    api.post = originalPost;
  }
});
