import nodemailer from 'nodemailer';

const placeholders = new Set(['', 'your-gmail-app-password', 'changeme', 'replace-me']);

export function emailConfigured() {
  return Boolean(
    process.env.SMTP_HOST &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS &&
    !placeholders.has(String(process.env.SMTP_PASS).trim().toLowerCase()),
  );
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function smtpSecurityConfiguration(env = process.env) {
  const secure = String(env.SMTP_SECURE || 'false').toLowerCase() === 'true';
  return {
    secure,
    requireTLS: !secure,
    tls: { rejectUnauthorized: env.SMTP_TLS_REJECT_UNAUTHORIZED !== 'false' },
  };
}

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  ...smtpSecurityConfiguration(),
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

export async function sendEmail({ to, subject, text, html }) {
  if (!emailConfigured()) {
    const error = new Error('Email delivery is not configured.');
    error.code = 'EMAIL_NOT_CONFIGURED';
    throw error;
  }
  return transporter.sendMail({
    from: `${process.env.SMTP_FROM_NAME || 'HealthMate+'} <${process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER}>`,
    to,
    subject,
    text,
    html,
  });
}

export async function sendOtpEmail(email, code, purpose = 'verification') {
  const safeCode = escapeHtml(code);
  return sendEmail({
    to: email,
    subject: `HealthMate+ ${purpose} code`,
    text: `Your HealthMate+ ${purpose} code is ${code}. It expires in 5 minutes.`,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:24px"><h2>HealthMate+</h2><p>Your ${escapeHtml(purpose)} code is:</p><p style="font-size:32px;font-weight:700;letter-spacing:6px">${safeCode}</p><p>This code expires in 5 minutes. Do not share it.</p></div>`,
  });
}
