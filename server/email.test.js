import test from 'node:test';
import assert from 'node:assert/strict';
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
