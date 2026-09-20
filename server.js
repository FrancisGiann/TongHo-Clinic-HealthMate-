import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';
import crypto from 'node:crypto';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3001);
const SCHOOL_NAME = 'Tong Ho Academy Health Center';
const BRAND_NAME = process.env.SMTP_FROM_NAME || 'HealthMate+';
const PLACEHOLDER_SMTP_VALUES = new Set(['', 'YOUR_GMAIL_APP_PASSWORD', 'your_gmail_app_password', 'changeme', 'replace-me']);
const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const OTP_WINDOW_MS = 10 * 60 * 1000;
const OTP_MAX_REQUESTS = 3;
const OTP_MAX_ATTEMPTS = 5;
const otpChallenges = new Map();
const otpRequestHistory = new Map();
const isSmtpConfigured = () => {
  const host = String(process.env.SMTP_HOST || '').trim();
  const user = String(process.env.SMTP_USER || '').trim();
  const pass = String(process.env.SMTP_PASS || '').trim();

  return Boolean(
    host &&
    user &&
    pass &&
    !PLACEHOLDER_SMTP_VALUES.has(host) &&
    !PLACEHOLDER_SMTP_VALUES.has(user) &&
    !PLACEHOLDER_SMTP_VALUES.has(pass)
  );
};

if (!isSmtpConfigured()) {
  console.warn('Email OTP is disabled: set SMTP_HOST, SMTP_USER, and SMTP_PASS in .env.');
}

app.use(cors());
app.use(express.json());

app.get('/', (_req, res) => {
  res.json({
    ok: true,
    service: 'HealthMate email API',
    routes: [
      '/api/health',
      '/api/send-otp',
      '/api/verify-otp',
      '/api/send-welcome-email'
    ]
  });
});

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

function hashOtp(email, otp) {
  return crypto.createHash('sha256').update(`${email}:${otp}`).digest('hex');
}

function createOtp() {
  return String(crypto.randomInt(100000, 1000000));
}

function pruneRequestHistory(email, now = Date.now()) {
  const recent = (otpRequestHistory.get(email) || []).filter((timestamp) => now - timestamp < OTP_WINDOW_MS);
  otpRequestHistory.set(email, recent);
  return recent;
}

function genericOtpResponse(res) {
  return res.status(429).json({
    success: false,
    message: 'Please wait before requesting another verification code.'
  });
}

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  tls: {
    rejectUnauthorized: false,
  },
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'healthmate-email-api' });
});

app.post(['/send-otp', '/api/send-otp'], async (req, res) => {
  const email = normalizeEmail(req.body?.email || req.body?.to);
  const now = Date.now();

  if (!isValidEmail(email)) {
    return res.status(400).json({ success: false, message: 'A valid email address is required.' });
  }

  const existing = otpChallenges.get(email);
  if (existing && now - existing.createdAt < OTP_RESEND_COOLDOWN_MS) {
    return genericOtpResponse(res);
  }

  const recentRequests = pruneRequestHistory(email, now);
  if (recentRequests.length >= OTP_MAX_REQUESTS) {
    return genericOtpResponse(res);
  }

  const code = createOtp();
  otpChallenges.set(email, {
    hash: hashOtp(email, code),
    createdAt: now,
    expiresAt: now + OTP_TTL_MS,
    attempts: 0
  });
  otpRequestHistory.set(email, [...recentRequests, now]);

  try {
    if (!isSmtpConfigured()) {
      otpChallenges.delete(email);
      return res.status(503).json({ success: false, message: 'Email delivery is not configured.' });
    }

    await transporter.sendMail({
      from: `${BRAND_NAME} <${process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER}>`,
      to: email,
      subject: 'Your verification code',
      text: `Your verification code is ${code}. It expires in 5 minutes. If you didn't request this, ignore this email.`,
      html: `
          <div style="font-family: Arial, sans-serif; background: #f4f9f8; padding: 24px;">
            <div style="max-width: 620px; margin: 0 auto; background: #ffffff; border: 1px solid #dfeae7; border-radius: 18px; overflow: hidden; box-shadow: 0 10px 25px rgba(15, 23, 42, 0.06);">
              <div style="background: linear-gradient(135deg, #143a72 0%, #1f6f8b 100%); padding: 24px 28px; color: #ffffff;">
                <div style="font-size: 12px; letter-spacing: 2px; text-transform: uppercase; opacity: 0.9;">${SCHOOL_NAME}</div>
                <h2 style="margin: 10px 0 0; font-size: 28px;">Verification Code</h2>
              </div>
              <div style="padding: 28px; color: #1f2937;">
                <p style="margin: 0 0 16px; font-size: 16px;">Hello,</p>
                <p style="margin: 0 0 16px; font-size: 16px;">Use the verification code below to complete your request.</p>
                <div style="text-align: center; margin: 28px 0; padding: 18px 12px; border-radius: 12px; background: #eefaf7; border: 1px solid #cfe7df;">
                  <div style="font-size: 12px; letter-spacing: 2px; text-transform: uppercase; color: #375f62; margin-bottom: 8px;">Your code</div>
                  <div style="font-size: 36px; letter-spacing: 8px; font-weight: 700; color: #0f172a;">${code}</div>
                </div>
                <p style="margin: 0; font-size: 14px; color: #475569;">This code expires in 5 minutes. If you didn't request this, ignore this email.</p>
              </div>
            </div>
          </div>
        `
    });

    return res.json({ success: true, message: 'If the address can receive mail, a verification code has been sent.' });
  } catch (error) {
    otpChallenges.delete(email);
    console.error('OTP send failed:', error);
    return res.status(500).json({
      success: false,
      message: 'Unable to send the verification email. Please try again later.'
    });
  }
});

app.post(['/verify-otp', '/api/verify-otp'], (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const otp = String(req.body?.otp || '').trim();
  const challenge = otpChallenges.get(email);

  if (!isValidEmail(email) || !/^\d{6}$/.test(otp) || !challenge) {
    return res.status(400).json({ success: false, message: 'The verification code is invalid or expired.' });
  }

  if (Date.now() >= challenge.expiresAt || challenge.attempts >= OTP_MAX_ATTEMPTS) {
    otpChallenges.delete(email);
    return res.status(400).json({ success: false, message: 'The verification code is invalid or expired. Please request a new one.' });
  }

  challenge.attempts += 1;
  const providedHash = hashOtp(email, otp);
  if (!crypto.timingSafeEqual(Buffer.from(providedHash, 'hex'), Buffer.from(challenge.hash, 'hex'))) {
    if (challenge.attempts >= OTP_MAX_ATTEMPTS) {
      otpChallenges.delete(email);
      return res.status(429).json({ success: false, message: 'Too many incorrect attempts. Please request a new code.' });
    }
    return res.status(400).json({ success: false, message: 'The verification code is invalid or expired.' });
  }

  otpChallenges.delete(email);
  return res.json({ success: true, message: 'Email verified successfully.' });
});

app.post('/api/send-welcome-email', async (req, res) => {
  const { to, fullName, username } = req.body || {};

  if (!to || !username) {
    return res.status(400).json({
      success: false,
      message: 'Recipient email and username are required.'
    });
  }

  try {
    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER,
      to,
      subject: 'Welcome to HealthMate+',
      text: `Hello ${fullName || 'Nurse'},\n\nYour account has been created successfully in HealthMate+.\n\nUsername: ${username}\n\nPlease sign in to continue.`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px;">
          <h2 style="margin-bottom: 12px; color: #1f2937;">Welcome to HealthMate+</h2>
          <p style="color: #374151;">Hello ${fullName || 'Nurse'},</p>
          <p style="color: #374151;">Your account has been created successfully.</p>
          <p style="color: #374151;"><strong>Username:</strong> ${username}</p>
          <p style="color: #374151;">Please sign in to continue using the clinic management system.</p>
        </div>
      `,
    });

    return res.json({
      success: true,
      messageId: info.messageId,
      message: 'Welcome email sent successfully.'
    });
  } catch (error) {
    console.error('SMTP send failed:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to send email.',
      error: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`HealthMate email API running on http://localhost:${PORT}`);
});

// Example usage:
// fetch("http://localhost:3001/api/send-otp", {
//   method: "POST",
//   headers: { "Content-Type": "application/json" },
//   body: JSON.stringify({ to: "jeelocaig23@email.com" })
// })
//   .then(res => res.json())
//   .then(data => console.log(data));
