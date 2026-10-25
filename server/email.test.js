import test from 'node:test';
import assert from 'node:assert/strict';
import { emailConfigured, emailTlsVerified, sendEmail } from './email.js';
import { otpEmail } from './emailTemplates.js';
const env = { RESEND_API_KEY: 'synthetic-private-key', RESEND_FROM_EMAIL: 'clinic@example.invalid', RESEND_FROM_NAME: 'HealthMate+' };

test('Resend configuration is required; SMTP alone cannot enable delivery', () => {
  assert.equal(emailConfigured(env), true);
  assert.equal(emailConfigured({ SMTP_HOST: 'host', SMTP_USER: 'user', SMTP_PASS: 'secret' }), false);
  assert.equal(emailConfigured({ ...env, RESEND_API_KEY: '' }), false);
  assert.equal(emailConfigured({ ...env, RESEND_FROM_EMAIL: 'bad\naddress' }), false);
  assert.equal(emailConfigured({ ...env, RESEND_FROM_NAME: 'Name\r\nBcc: x' }), false);
  assert.equal(emailTlsVerified({ NODE_TLS_REJECT_UNAUTHORIZED: '0' }), false);
});

test('Resend receives the original recipient, subject, HTML and text with a bounded HTTPS request', async () => {
  const message = { to: 'recipient@example.invalid', ...otpEmail('012345', 'login') };
  let calls = 0;
  const result = await sendEmail(message, { env, fetchFn: async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.resend.com/emails');
    assert.equal(options.redirect, 'error');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, `Bearer ${env.RESEND_API_KEY}`);
    assert.ok(options.signal instanceof AbortSignal);
    assert.deepEqual(JSON.parse(options.body), { from: 'HealthMate+ <clinic@example.invalid>', ...message });
    return { ok: true, json: async () => ({ id: 'synthetic-id' }) };
  } });
  assert.deepEqual(result, { id: 'synthetic-id' });
  assert.equal(calls, 1);
});

test('delivery failures are sanitized and never retried or sent via SMTP', async () => {
  for (const status of [401, 403, 429, 422, 500]) {
    let calls = 0;
    await assert.rejects(sendEmail({ to: 'private@example.invalid' }, { env, fetchFn: async () => {
      calls++; return { ok: false, status, json: async () => ({ message: 'PRIVATE_PROVIDER_MESSAGE' }) };
    } }), (error) => {
      assert.doesNotMatch(error.message, /private@example|synthetic-private-key|PRIVATE_PROVIDER_MESSAGE/);
      assert.match(error.code, /^EMAIL_/); return true;
    });
    assert.equal(calls, 1);
  }
  await assert.rejects(sendEmail({}, { env, fetchFn: async () => { throw new Error('secret provider detail'); } }), { code: 'EMAIL_DELIVERY_UNCONFIRMED' });
  await assert.rejects(sendEmail({}, { env, fetchFn: async () => ({ ok: true, json: async () => ({}) }) }), { code: 'EMAIL_DELIVERY_UNCONFIRMED' });
  const never = async () => { assert.fail('must not call provider'); };
  await assert.rejects(sendEmail({}, { env: {}, fetchFn: never }), { code: 'EMAIL_NOT_CONFIGURED' });
  await assert.rejects(sendEmail({}, { env: { ...env, NODE_TLS_REJECT_UNAUTHORIZED: '0' }, fetchFn: never }), { code: 'EMAIL_TLS_CONFIGURATION' });
});
