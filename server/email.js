import { otpEmail } from './emailTemplates.js';
export { escapeHtml } from './emailTemplates.js';

export function emailConfigured(env = process.env) {
  const key = String(env.RESEND_API_KEY || '').trim();
  const sender = String(env.RESEND_FROM_EMAIL || '').trim();
  const name = String(env.RESEND_FROM_NAME || 'HealthMate+');
  return Boolean(key && !['changeme', 'replace-me', 're_xxxxxxxxx'].includes(key.toLowerCase())
    && /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(sender)
    && !/[\r\n<>]/.test(name));
}

export function emailTlsVerified(env = process.env) {
  return env.NODE_TLS_REJECT_UNAUTHORIZED !== '0';
}

function deliveryError(code, message) {
  return Object.assign(new Error(message), { code });
}

export async function sendEmail({ to, subject, text, html }, { fetchFn = globalThis.fetch, env = process.env } = {}) {
  if (!emailConfigured(env)) throw deliveryError('EMAIL_NOT_CONFIGURED', 'Resend email delivery is not configured.');
  if (!emailTlsVerified(env)) throw deliveryError('EMAIL_TLS_CONFIGURATION', 'Email delivery requires certificate-verified HTTPS.');
  let response;
  try {
    response = await fetchFn('https://api.resend.com/emails', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY.trim()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: `${env.RESEND_FROM_NAME || 'HealthMate+'} <${env.RESEND_FROM_EMAIL.trim()}>`, to, subject, text, html }),
    });
  } catch {
    // Never expose provider errors, request bodies, API keys or recipient details.
    // Do not automatically retry: a timed-out request may already have been accepted.
    throw deliveryError('EMAIL_DELIVERY_UNCONFIRMED', 'Email delivery could not be confirmed.');
  }
  if (!response.ok) {
    const code = response.status === 429 ? 'EMAIL_RATE_LIMITED'
      : [401, 403].includes(response.status) ? 'EMAIL_PROVIDER_CONFIGURATION'
      : 'EMAIL_DELIVERY_FAILED';
    throw deliveryError(code, 'Resend did not accept the email. Check server email configuration and provider status.');
  }
  let result;
  try { result = await response.json(); } catch { /* Malformed success remains unconfirmed. */ }
  if (typeof result?.id !== 'string' || !result.id) throw deliveryError('EMAIL_DELIVERY_UNCONFIRMED', 'Email delivery could not be confirmed.');
  return { id: result.id };
}

export async function sendOtpEmail(email, code, purpose = 'verification') {
  return sendEmail({ to: email, ...otpEmail(code, purpose) });
}
