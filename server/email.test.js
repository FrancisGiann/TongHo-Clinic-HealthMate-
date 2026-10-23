import test from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
import { smtpSecurityConfiguration } from './email.js';

test('SMTP requires certificate-verified STARTTLS unless implicit TLS is selected', () => {
  assert.deepEqual(smtpSecurityConfiguration({ SMTP_SECURE: 'false' }), {
    secure: false,
    requireTLS: true,
    tls: { rejectUnauthorized: true },
  });
  assert.deepEqual(smtpSecurityConfiguration({ SMTP_SECURE: 'true', SMTP_TLS_REJECT_UNAUTHORIZED: 'true' }), {
    secure: true,
    requireTLS: false,
    tls: { rejectUnauthorized: true },
  });
  assert.equal(smtpSecurityConfiguration({ SMTP_TLS_REJECT_UNAUTHORIZED: 'false' }).tls.rejectUnauthorized, false);
});

test('OTP email composes through Nodemailer without network delivery', async (t) => {
  const env = {
    SMTP_HOST: 'smtp.example.invalid', SMTP_PORT: '587',
    SMTP_USER: 'sender@example.invalid', SMTP_PASS: 'synthetic-test-only',
    SMTP_FROM_EMAIL: 'sender@example.invalid', SMTP_FROM_NAME: 'HealthMate+',
    SMTP_SECURE: 'false', SMTP_TLS_REJECT_UNAUTHORIZED: 'true',
  };
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  const transport = nodemailer.createTransport({ jsonTransport: true });
  t.mock.method(nodemailer, 'createTransport', (options) => {
    assert.equal(options.requireTLS, true);
    assert.equal(options.tls.rejectUnauthorized, true);
    return transport;
  });
  Object.assign(process.env, env);
  try {
    const { sendOtpEmail } = await import('./email.js?offline-compatibility-test');
    const result = await sendOtpEmail('recipient@example.invalid', '123456', 'verification');
    const message = JSON.parse(result.message);
    assert.equal(message.subject, 'HealthMate+ verification code');
    assert.equal(message.to[0].address, 'recipient@example.invalid');
    assert.match(message.text, /123456/);
    assert.match(message.html, /123456/);
    assert.deepEqual(result.envelope.to, ['recipient@example.invalid']);
  } finally {
    transport.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
