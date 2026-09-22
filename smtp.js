import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

function getSmtpConfig() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error('Missing SMTP configuration. Please set SMTP_HOST, SMTP_USER, and SMTP_PASS in your .env file.');
  }

  return {
    host,
    port,
    secure: String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
    auth: {
      user,
      pass,
    },
    tls: {
      rejectUnauthorized: false,
    },
  };
}

export function createSmtpTransport() {
  return nodemailer.createTransport(getSmtpConfig());
}

export async function verifySmtpConnection() {
  const transporter = createSmtpTransport();
  await transporter.verify();
  return true;
}

export async function sendEmail({
  to,
  subject,
  text,
  html,
  from = `${process.env.SMTP_FROM_NAME || 'HealthMate+'} <${process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER}>`,
}) {
  if (!to || !subject) {
    throw new Error('Email requires a recipient and subject.');
  }

  const transporter = createSmtpTransport();

  const info = await transporter.sendMail({
    from,
    to,
    subject,
    text,
    html,
  });

  return info;
}

export async function sendWelcomeEmail({ to, fullName, username }) {
  const subject = 'Welcome to HealthMate+';
  const text = `Hello ${fullName || 'Nurse'},\n\nYour account has been created successfully in HealthMate+.\n\nUsername: ${username}\n\nPlease sign in to continue.`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px;">
      <h2 style="margin-bottom: 12px; color: #1f2937;">Welcome to HealthMate+</h2>
      <p style="color: #374151;">Hello ${fullName || 'Nurse'},</p>
      <p style="color: #374151;">Your account has been created successfully.</p>
      <p style="color: #374151;"><strong>Username:</strong> ${username}</p>
      <p style="color: #374151;">Please sign in to continue using the clinic management system.</p>
    </div>
  `;

  return sendEmail({ to, subject, text, html });
}

const [, , command = 'help'] = process.argv;

async function handleCli() {
  if (command === 'verify') {
    await verifySmtpConnection();
    console.log('SMTP connection verified successfully.');
    return;
  }

  if (command === 'test') {
    const to = process.env.SMTP_TEST_TO || process.env.SMTP_USER;
    if (!to) {
      throw new Error('Set SMTP_TEST_TO to receive a test email.');
    }

    const result = await sendEmail({
      to,
      subject: 'HealthMate+ SMTP Test',
      text: 'This is a test email from the HealthMate+ SMTP setup.',
      html: '<p>This is a test email from the HealthMate+ SMTP setup.</p>',
    });

    console.log('Test email sent successfully:', result.messageId);
    return;
  }

  console.log(`Usage:\n  node smtp.js verify\n  node smtp.js test\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  handleCli().catch((error) => {
    console.error('SMTP error:', error.message);
    process.exit(1);
  });
}
