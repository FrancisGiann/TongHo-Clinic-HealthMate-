import crypto from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import { databaseConfigured, query, transaction } from './db.js';
import {
  audit,
  checkLoginLock,
  clearFailedLogin,
  clearSession,
  consumeOtp,
  createOtpChallenge,
  createRawToken,
  findUser,
  hashPassword,
  hashSecret,
  issueSession,
  loadSession,
  normalizeIdentifier,
  publicUser,
  recordFailedLogin,
  requireAuth,
  requireRoles,
  validEmail,
  validatePassword,
  verifyPassword,
} from './auth.js';
import { emailConfigured, escapeHtml, sendEmail } from './email.js';
import { approveDraftRiskRule, assessRisk, getDemonstrationRules, validateRiskRules } from './domain/risk.js';
import { buildClinicReport, reportForRole, reportSnapshotForStorage } from './domain/reporting.js';
import { applyStockAdjustment, validateInventoryArchive, validateInventoryItem, validateStockAdjustment } from './domain/inventory.js';
import { persistVisitAndDispensations, resolveInventoryDispensations } from './domain/dispensing.js';
import { validateChangedClinicalRecords } from './domain/clinical-records.js';
import { sanitizeAuditLogs } from './domain/audit.js';
import { summarizeEncounter } from './ai.js';
import { clinicCalendarDate, queueStatusConflict, riskPriority, validateQueueTriage, validateVisitPayload, visitRiskInput } from './domain/visit.js';
import { appointmentSettings, clinicDateTime, generateAppointmentSlots, isAppointmentTransitionAllowed, isValidAppointmentDate, normalizeAppointmentStatus, rankAppointmentSlots } from './domain/scheduling.js';
import { clinicalWriteRoles, reportReadRoles } from './domain/authorization.js';
import { broadcastBatchId, validateBroadcastPayload, validateConsentUpdate } from './domain/communications.js';
import { clinicDataTransaction, linkUserToPatient, listUsers, loadClinicData, saveClinicData, validateVersionAfterAdvance } from './repository.js';
import { runClinicReminderSweep } from './reminders.js';

const currentDir = dirname(fileURLToPath(import.meta.url));
const distDir = join(currentDir, '..', 'dist');
const allowedRoles = new Set(['student', 'guardian', 'school_nurse', 'system_administrator']);
const staffRoles = reportReadRoles;

function errorResponse(res, status, code, message, fields) {
  return res.status(status).json({ error: { code, message, ...(fields ? { fields } : {}) } });
}

function visibleReport(report, user) {
  return reportForRole(report, user.role);
}

async function readInventoryState(client, schemaVersion) {
  const [result, adjustments] = await Promise.all([
    client.query('SELECT id,quantity,data FROM inventory_items ORDER BY created_at'),
    client.query('SELECT data FROM stock_adjustments ORDER BY created_at'),
  ]);
  return {
    inventory: result.rows.map((row) => ({ ...(row.data || {}), id: row.id, quantity: row.quantity })),
    stockAdjustments: adjustments.rows.map((row) => row.data),
    schemaVersion,
  };
}

function inventoryRecordId(value) {
  const id = String(value || '').trim();
  return id && id.length <= 120 ? id : null;
}

function allowedOrigins() {
  const configured = [process.env.APP_URL, process.env.DEV_APP_URL].filter(Boolean);
  if (!process.env.APP_URL && process.env.NODE_ENV !== 'production') configured.push('http://localhost:5173', 'http://localhost:5174');
  return [...new Set(configured.map((origin) => {
    try { return new URL(origin).origin; } catch { return String(origin).replace(/\/$/, ''); }
  }))];
}

function ensureSameOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (!origin || allowedOrigins().includes(origin)) return next();
  return errorResponse(res, 403, 'ORIGIN_REJECTED', 'The request origin is not allowed.');
}

async function latestRules() {
  const result = await query("SELECT version,name,status,rules FROM risk_rules WHERE status='clinician_approved' ORDER BY version DESC LIMIT 1");
  if (!result.rows[0]) return getDemonstrationRules();
  return { ...result.rows[0].rules, version: result.rows[0].version, name: result.rows[0].name, status: result.rows[0].status };
}

async function canAccessPatient(user, patientId) {
  if (staffRoles.includes(user.role)) return true;
  if (user.role === 'student') {
    const result = await query('SELECT 1 FROM patients WHERE id=$1 AND user_id=$2', [String(patientId), user.id]);
    return Boolean(result.rowCount);
  }
  const result = await query('SELECT 1 FROM guardian_patient_links WHERE guardian_user_id=$1 AND patient_id=$2', [user.id, String(patientId)]);
  return Boolean(result.rowCount);
}

async function createNotification({ userId, channel = 'in_app', type, subject, body, dedupeKey = null, metadata = {} }) {
  const id = crypto.randomUUID();
  const result = await query(
    `INSERT INTO notifications(id,user_id,channel,type,subject,body,dedupe_key,metadata)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
     ON CONFLICT(dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING RETURNING *`,
    [id, userId || null, channel, type, subject, body, dedupeKey, JSON.stringify(metadata)],
  );
  return result.rows[0] || null;
}

async function notifyLinkedUsers(patientId, { type, subject, body, dedupeKey }) {
  const users = await query(
    `SELECT DISTINCT u.id,u.email,u.name FROM users u
     WHERE u.status='active' AND (
       u.id=(SELECT user_id FROM patients WHERE id=$1)
       OR u.id IN (SELECT guardian_user_id FROM guardian_patient_links WHERE patient_id=$1)
     )`,
    [String(patientId)],
  );
  for (const user of users.rows) {
    await createNotification({ userId: user.id, type, subject, body, dedupeKey: `${dedupeKey}:in-app:${user.id}`, metadata: { patientId: String(patientId) } });
    const emailNotification = await createNotification({ userId: user.id, channel: 'email', type, subject, body, dedupeKey: `${dedupeKey}:email:${user.id}`, metadata: { patientId: String(patientId) } });
    if (!emailNotification) continue;
    try {
      await sendEmail({
        to: user.email,
        subject,
        text: body,
        html: `<p>Hello ${escapeHtml(user.name)},</p><p>${escapeHtml(body)}</p><p>Sign in to HealthMate+ for authorized details.</p>`,
      });
      await query("UPDATE notifications SET status='sent',sent_at=NOW() WHERE id=$1", [emailNotification.id]);
    } catch {
      await query("UPDATE notifications SET status='failed' WHERE id=$1", [emailNotification.id]);
    }
  }
}

export async function runClinicReminders({ req = null, source = 'manual', now = new Date() } = {}) {
  const result = await runClinicReminderSweep({ now, notifyPatient: notifyLinkedUsers });
  const auditRequest = req || { headers: {}, user: null };
  const event = source === 'scheduled' ? 'NOTIFICATION_REMINDERS_SCHEDULED' : 'NOTIFICATION_REMINDERS_TRIGGERED';
  await audit(auditRequest, event, { ...result, source }, 'reminder_job', result.today);
  return result;
}

function newRecords(before = [], after = []) {
  const existing = new Set(before.map((record) => String(record.id)));
  return after.filter((record) => !existing.has(String(record.id)));
}

function formatAppointmentLabel(recordOrValue) {
  const value = typeof recordOrValue === 'object'
    ? (recordOrValue.startsAt || (recordOrValue.date ? `${recordOrValue.date}T${recordOrValue.time || '00:00'}` : ''))
    : recordOrValue;
  const date = clinicDateTime(value || '');
  return Number.isNaN(date.getTime())
    ? 'the selected schedule'
    : date.toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' });
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(cors({ origin: (origin, callback) => callback(null, !origin || allowedOrigins().includes(origin)), credentials: true }));
  app.use(express.json({ limit: '5mb' }));
  app.use(ensureSameOrigin);

  app.get('/api/health', async (_req, res) => {
    if (!databaseConfigured) return res.status(503).json({ ok: false, service: 'healthmate-api', database: 'not-configured' });
    try {
      await query('SELECT 1');
      return res.json({ ok: true, service: 'healthmate-api', database: 'connected', email: emailConfigured() ? 'configured' : 'not-configured' });
    } catch {
      return res.status(503).json({ ok: false, service: 'healthmate-api', database: 'unavailable' });
    }
  });

  app.use('/api', loadSession);

  app.post('/api/auth/login', async (req, res) => {
    const identifier = normalizeIdentifier(req.body?.identifier || req.body?.username);
    const password = String(req.body?.password || '');
    if (!identifier || !password) return errorResponse(res, 400, 'VALIDATION_ERROR', 'Email/username and password are required.');
    const lockedUntil = await checkLoginLock(identifier);
    if (lockedUntil) return errorResponse(res, 429, 'ACCOUNT_LOCKED', `Too many attempts. Try again after ${new Date(lockedUntil).toLocaleTimeString()}.`);
    const user = await findUser(identifier);
    const valid = user ? await verifyPassword(password, user.password_hash) : false;
    if (!user || !valid) {
      const attemptsRemaining = await recordFailedLogin(identifier);
      await audit(req, 'LOGIN_FAILED', { identifier, attemptsRemaining });
      return res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials.', attemptsRemaining } });
    }
    if (user.status !== 'active') return errorResponse(res, 403, 'ACCOUNT_INACTIVE', 'This account is not active. Contact an administrator.');
    await clearFailedLogin(identifier);
    const requireOtp = user.mfa_enabled || process.env.REQUIRE_LOGIN_OTP !== 'false';
    if (requireOtp) {
      const challengeId = await createOtpChallenge(user, 'login', { remember: Boolean(req.body?.remember) });
      await audit(req, 'LOGIN_OTP_SENT', { userId: user.id });
      return res.status(202).json({ data: { mfaRequired: true, challengeId, username: user.username, message: 'A verification code was sent to your email.' } });
    }
    await issueSession(req, res, user, Boolean(req.body?.remember));
    await query('UPDATE users SET last_login_at=NOW() WHERE id=$1', [user.id]);
    req.user = user;
    await audit(req, 'LOGIN_SUCCESS');
    return res.json({ data: { user: publicUser(user) } });
  });

  app.post('/api/auth/otp/verify', async (req, res) => {
    const challenge = await consumeOtp(req.body?.challengeId, req.body?.code, 'login');
    if (!challenge) return errorResponse(res, 400, 'INVALID_OTP', 'The verification code is invalid or expired.');
    const result = await query("SELECT * FROM users WHERE id=$1 AND status='active'", [challenge.user_id]);
    const user = result.rows[0];
    if (!user) return errorResponse(res, 403, 'ACCOUNT_INACTIVE', 'This account is not active.');
    await issueSession(req, res, user, Boolean(challenge.metadata?.remember));
    await query('UPDATE users SET last_login_at=NOW() WHERE id=$1', [user.id]);
    req.user = user;
    await audit(req, 'LOGIN_SUCCESS', { mfa: true });
    return res.json({ data: { user: publicUser(user) } });
  });

  app.get('/api/auth/me', requireAuth, (req, res) => res.json({ data: { user: publicUser(req.user) } }));

  app.post('/api/auth/logout', requireAuth, async (req, res) => {
    await audit(req, 'LOGOUT');
    await clearSession(req, res);
    return res.json({ data: { success: true } });
  });

  app.post('/api/auth/password/change', requireAuth, async (req, res) => {
    const passwordError = validatePassword(req.body?.newPassword);
    if (passwordError) return errorResponse(res, 400, 'WEAK_PASSWORD', passwordError);
    if (!(await verifyPassword(String(req.body?.currentPassword || ''), req.user.password_hash))) {
      return errorResponse(res, 400, 'INVALID_CURRENT_PASSWORD', 'Current password is incorrect.');
    }
    await transaction(async (client) => {
      await client.query('UPDATE users SET password_hash=$1,updated_at=NOW() WHERE id=$2', [await hashPassword(req.body.newPassword), req.user.id]);
      await client.query('DELETE FROM sessions WHERE user_id=$1', [req.user.id]);
    });
    await clearSession(req, res);
    await audit(req, 'PASSWORD_CHANGED');
    return res.json({ data: { success: true, message: 'Password changed. Sign in again with the new password.' } });
  });

  app.patch('/api/me/mfa', requireAuth, async (req, res) => {
    const enabled = Boolean(req.body?.enabled);
    await query('UPDATE users SET mfa_enabled=$1,updated_at=NOW() WHERE id=$2', [enabled, req.user.id]);
    await audit(req, 'MFA_SETTING_UPDATED', { enabled });
    return res.json({ data: { success: true, enabled } });
  });

  app.post('/api/auth/password-reset/request', async (req, res) => {
    const user = await findUser(req.body?.identifier);
    let challengeId = crypto.randomUUID();
    if (user?.status === 'active') challengeId = await createOtpChallenge(user, 'password_reset');
    await audit(req, 'PASSWORD_RESET_REQUESTED', { accountFound: Boolean(user) });
    return res.json({ data: { challengeId, message: 'If the account exists, a reset code was sent.' } });
  });

  app.post('/api/auth/password-reset/confirm', async (req, res) => {
    const passwordError = validatePassword(req.body?.password);
    if (passwordError) return errorResponse(res, 400, 'WEAK_PASSWORD', passwordError);
    const challenge = await consumeOtp(req.body?.challengeId, req.body?.code, 'password_reset');
    if (!challenge) return errorResponse(res, 400, 'INVALID_OTP', 'The reset code is invalid or expired.');
    await transaction(async (client) => {
      await client.query('UPDATE users SET password_hash=$1,updated_at=NOW() WHERE id=$2', [await hashPassword(req.body.password), challenge.user_id]);
      await client.query('DELETE FROM sessions WHERE user_id=$1', [challenge.user_id]);
    });
    await audit(req, 'PASSWORD_RESET_COMPLETED', {}, 'user', challenge.user_id);
    return res.json({ data: { success: true, message: 'Password reset successfully.' } });
  });

  app.post('/api/auth/activate', async (req, res) => {
    const tokenHash = hashSecret(req.body?.token || '');
    const passwordError = validatePassword(req.body?.password);
    if (passwordError) return errorResponse(res, 400, 'WEAK_PASSWORD', passwordError);
    const username = normalizeIdentifier(req.body?.username).replace(/\s+/g, '.');
    if (!/^[a-z0-9._-]{3,80}$/.test(username)) return errorResponse(res, 400, 'INVALID_USERNAME', 'Use 3–80 letters, numbers, dots, underscores, or dashes. Spaces become dots.');
    const invitationResult = await query('SELECT * FROM invitations WHERE token_hash=$1 AND accepted_at IS NULL AND expires_at>NOW()', [tokenHash]);
    const invitation = invitationResult.rows[0];
    if (!invitation) return errorResponse(res, 400, 'INVALID_INVITATION', 'The invitation is invalid or expired.');
    const userResult = await query('SELECT * FROM users WHERE LOWER(email)=LOWER($1)', [invitation.email]);
    const user = userResult.rows[0];
    try {
      await transaction(async (client) => {
        await client.query("UPDATE users SET username=$1,password_hash=$2,status='active',updated_at=NOW() WHERE id=$3", [username, await hashPassword(req.body.password), user.id]);
        await client.query('UPDATE invitations SET accepted_at=NOW() WHERE id=$1', [invitation.id]);
      });
    } catch (error) {
      if (error.code === '23505') return errorResponse(res, 409, 'USERNAME_TAKEN', 'That username or email is already in use.');
      throw error;
    }
    return res.json({ data: { success: true, message: 'Account activated. You can now sign in.' } });
  });

  app.post('/api/admin/users/invite', requireRoles('system_administrator'), async (req, res) => {
    const email = normalizeIdentifier(req.body?.email);
    const name = String(req.body?.name || '').trim();
    const role = String(req.body?.role || '');
    if (!validEmail(email) || !name || !allowedRoles.has(role)) return errorResponse(res, 400, 'VALIDATION_ERROR', 'A valid name, email, and role are required.');
    if (['student', 'guardian'].includes(role)) {
      const patient = await query('SELECT 1 FROM patients WHERE id=$1', [String(req.body?.patientId || '')]);
      if (!patient.rowCount) return errorResponse(res, 400, 'PATIENT_LINK_REQUIRED', 'Select an existing patient for student and guardian accounts.');
    }
    if (await findUser(email)) return errorResponse(res, 409, 'ACCOUNT_EXISTS', 'An account with this email already exists.');
    const userId = crypto.randomUUID();
    const invitationId = crypto.randomUUID();
    const rawToken = createRawToken();
    const placeholderHash = await bcrypt.hash(createRawToken(), 12);
    await transaction(async (client) => {
      await client.query(
        `INSERT INTO users(id,username,email,password_hash,name,role,status,mfa_enabled)
         VALUES($1,$2,$3,$4,$5,$6,'invited',TRUE)`,
        [userId, `invited-${userId.slice(0, 8)}`, email, placeholderHash, name, role],
      );
      await client.query(
        `INSERT INTO invitations(id,token_hash,email,role,patient_id,invited_by,expires_at)
         VALUES($1,$2,$3,$4,$5,$6,NOW()+INTERVAL '72 hours')`,
        [invitationId, hashSecret(rawToken), email, role, req.body?.patientId ? String(req.body.patientId) : null, req.user.id],
      );
    });
    if (req.body?.patientId) await linkUserToPatient(userId, req.body.patientId, role, req.body?.relationship);
    const activationUrl = `${process.env.APP_URL || 'http://localhost:5173'}/?activate=${encodeURIComponent(rawToken)}`;
    try {
      await sendEmail({
        to: email,
        subject: 'Your HealthMate+ account invitation',
        text: `You were invited to HealthMate+. Activate your account: ${activationUrl}`,
        html: `<p>Hello ${escapeHtml(name)},</p><p>You were invited to HealthMate+.</p><p><a href="${escapeHtml(activationUrl)}">Activate your account</a></p><p>This link expires in 72 hours.</p>`,
      });
    } catch (error) {
      await audit(req, 'INVITATION_EMAIL_FAILED', { email, reason: error.code || 'delivery_error' }, 'user', userId);
      return res.status(201).json({ data: { userId, emailSent: false, message: 'Account created, but the invitation email could not be delivered.' } });
    }
    await audit(req, 'USER_INVITED', { role, email }, 'user', userId);
    return res.status(201).json({ data: { userId, emailSent: true } });
  });

  app.get('/api/admin/users', requireRoles('system_administrator'), async (_req, res) => res.json({ data: { users: await listUsers() } }));

  app.post('/api/admin/users/:id/resend-invitation', requireRoles('system_administrator'), async (req, res) => {
    const result = await query("SELECT id,email,name,role,status FROM users WHERE id=$1", [req.params.id]);
    const account = result.rows[0];
    if (!account) return errorResponse(res, 404, 'NOT_FOUND', 'User not found.');
    if (account.status !== 'invited') return errorResponse(res, 409, 'NOT_INVITED', 'Only pending invitations can be resent.');
    const rawToken = createRawToken();
    await transaction(async (client) => {
      await client.query('UPDATE invitations SET accepted_at=NOW() WHERE LOWER(email)=LOWER($1) AND accepted_at IS NULL', [account.email]);
      await client.query(
        `INSERT INTO invitations(id,token_hash,email,role,patient_id,invited_by,expires_at)
         VALUES($1,$2,$3,$4,(SELECT patient_id FROM invitations WHERE LOWER(email)=LOWER($3) ORDER BY created_at DESC LIMIT 1),$5,NOW()+INTERVAL '72 hours')`,
        [crypto.randomUUID(), hashSecret(rawToken), account.email, account.role, req.user.id],
      );
    });
    const activationUrl = `${process.env.APP_URL || 'http://localhost:5173'}/?activate=${encodeURIComponent(rawToken)}`;
    try {
      await sendEmail({
        to: account.email,
        subject: 'Your HealthMate+ account invitation',
        text: `Activate your HealthMate+ account: ${activationUrl}`,
        html: `<p>Hello ${escapeHtml(account.name)},</p><p><a href="${escapeHtml(activationUrl)}">Activate your HealthMate+ account</a></p><p>This link expires in 72 hours.</p>`,
      });
    } catch (error) {
      await audit(req, 'INVITATION_EMAIL_FAILED', { email: account.email, reason: error.code || 'delivery_error' }, 'user', account.id);
      return errorResponse(res, 502, 'EMAIL_DELIVERY_FAILED', 'The invitation was renewed, but the email could not be delivered. Check SMTP settings and retry.');
    }
    await audit(req, 'INVITATION_RESENT', { email: account.email }, 'user', account.id);
    return res.json({ data: { success: true, message: 'Invitation resent.' } });
  });

  app.patch('/api/admin/users/:id/status', requireRoles('system_administrator'), async (req, res) => {
    const status = String(req.body?.status || '');
    if (!['active', 'suspended', 'deactivated'].includes(status)) return errorResponse(res, 400, 'INVALID_STATUS', 'Invalid account status.');
    if (req.params.id === req.user.id && status !== 'active') return errorResponse(res, 400, 'SELF_DEACTIVATION', 'You cannot deactivate your own account.');
    const current = await query('SELECT status FROM users WHERE id=$1', [req.params.id]);
    if (!current.rowCount) return errorResponse(res, 404, 'NOT_FOUND', 'User not found.');
    if (current.rows[0].status === 'invited' && status === 'active') return errorResponse(res, 409, 'ACTIVATION_REQUIRED', 'Invited users must activate their account from the secure email link.');
    const result = await query('UPDATE users SET status=$1,updated_at=NOW() WHERE id=$2 RETURNING *', [status, req.params.id]);
    if (status !== 'active') await query('DELETE FROM sessions WHERE user_id=$1', [req.params.id]);
    await audit(req, 'ACCOUNT_STATUS_CHANGED', { status }, 'user', req.params.id);
    return res.json({ data: { user: publicUser(result.rows[0]) } });
  });

  app.get('/api/admin/audit-logs', requireRoles('system_administrator'), async (req, res) => {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 100)));
    const result = await query('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT $1', [limit]);
    return res.json({ data: { logs: sanitizeAuditLogs(result.rows) } });
  });

  app.get('/api/data', requireAuth, async (req, res) => res.json({ data: await loadClinicData(req.user) }));

  app.patch('/api/admin/settings/clinic', requireRoles('system_administrator'), async (req, res) => {
    const fields = {
      schoolName: 160,
      schoolYear: 40,
      address: 300,
      clinicName: 160,
      nurseName: 160,
      contactNumber: 60,
    };
    const updates = {};
    for (const [key, maxLength] of Object.entries(fields)) {
      if (req.body?.[key] === undefined) continue;
      const value = String(req.body[key]).trim();
      if (!value || value.length > maxLength) return errorResponse(res, 400, 'VALIDATION_ERROR', `${key} must be between 1 and ${maxLength} characters.`);
      updates[key] = value;
    }
    for (const key of ['clinicOpenTime', 'clinicCloseTime']) {
      if (req.body?.[key] === undefined) continue;
      const value = String(req.body[key]).trim();
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return errorResponse(res, 400, 'VALIDATION_ERROR', `${key} must be a valid 24-hour time.`);
      updates[key] = value;
    }
    if (req.body?.appointmentDurationMinutes !== undefined) {
      const duration = Number(req.body.appointmentDurationMinutes);
      if (![15, 30, 45, 60].includes(duration)) return errorResponse(res, 400, 'VALIDATION_ERROR', 'Appointment duration must be 15, 30, 45, or 60 minutes.');
      updates.appointmentDurationMinutes = duration;
    }
    let saved;
    await transaction(async (client) => {
      const locked = await client.query('SELECT data FROM clinic_settings WHERE id=1 FOR UPDATE');
      const current = locked.rows[0]?.data || {};
      const next = { ...current, ...updates };
      const result = await client.query('UPDATE clinic_settings SET data=$1::jsonb,version=version+1,updated_at=NOW() WHERE id=1 RETURNING data,version', [JSON.stringify(next)]);
      saved = result.rows[0];
      await audit(req, 'CLINIC_SETTINGS_UPDATED', { fields: Object.keys(updates) }, 'clinic_settings', '1', client);
    });
    return res.json({ data: { settings: saved.data, schemaVersion: saved.version } });
  });

  app.put('/api/data', requireRoles(...clinicalWriteRoles), async (req, res) => {
    const before = await loadClinicData(req.user);
    const clinicalValidation = validateChangedClinicalRecords(before, req.body?.data || {});
    if (!clinicalValidation.valid) return errorResponse(res, 400, 'VALIDATION_ERROR', clinicalValidation.message);
    const version = await saveClinicData(req.body?.data, req.user, req.body?.version);
    const after = await loadClinicData(req.user);
    for (const visit of newRecords(before.visits, after.visits)) {
      await notifyLinkedUsers(visit.studentId || visit.patientId, {
        type: 'clinic_visit',
        subject: 'Clinic visit recorded',
        body: `A clinic visit was recorded on ${visit.date || 'the current date'}.`,
        dedupeKey: `visit:${visit.id}`,
      });
    }
    for (const appointment of newRecords(before.appointments, after.appointments)) {
      await notifyLinkedUsers(appointment.studentId || appointment.patientId, {
        type: 'appointment',
        subject: 'Clinic appointment update',
        body: `A clinic appointment is ${appointment.status || 'pending'} for ${formatAppointmentLabel(appointment)}.`,
        dedupeKey: `appointment:${appointment.id}`,
      });
    }
    for (const immunization of newRecords(before.immunizations, after.immunizations)) {
      await notifyLinkedUsers(immunization.studentId || immunization.patientId, {
        type: 'immunization',
        subject: 'Immunization record updated',
        body: `An immunization record was updated${immunization.nextDueDate ? `; next due date: ${immunization.nextDueDate}` : ''}.`,
        dedupeKey: `immunization:${immunization.id}`,
      });
    }
    await audit(req, 'CLINIC_DATA_UPDATED', { version });
    return res.json({ data: { ...after, schemaVersion: version } });
  });

  app.post('/api/inventory', requireRoles('school_nurse'), async (req, res) => {
    const validation = validateInventoryItem(req.body || {}, { create: true });
    if (!validation.valid) return errorResponse(res, 400, 'VALIDATION_ERROR', validation.message);
    const id = crypto.randomUUID();
    const item = { id, ...validation.value, archived: false, archivedAt: null };
    let state;
    await clinicDataTransaction(async (client) => {
      const schemaVersion = await validateVersionAfterAdvance(client, req.body?.schemaVersion);
      const duplicate = await client.query(
        "SELECT id FROM inventory_items WHERE LOWER(data->>'name')=LOWER($1) AND COALESCE(data->>'archived','false') <> 'true' LIMIT 1",
        [item.name],
      );
      if (duplicate.rowCount) {
        const error = new Error('An active inventory item with this name already exists.');
        error.status = 409;
        error.code = 'ITEM_NAME_EXISTS';
        throw error;
      }
      await client.query('INSERT INTO inventory_items(id,quantity,data) VALUES($1,$2,$3::jsonb)', [id, item.quantity, JSON.stringify(item)]);
      if (item.quantity > 0) {
        const adjustmentId = crypto.randomUUID();
        const adjustment = { id: adjustmentId, medicineId: id, medicineName: item.name, quantity: item.quantity, quantityDelta: item.quantity, reason: 'Initial stock', date: new Date().toISOString() };
        await client.query(
          'INSERT INTO stock_adjustments(id,inventory_item_id,quantity,data,created_by) VALUES($1,$2,$3,$4::jsonb,$5)',
          [adjustmentId, id, item.quantity, JSON.stringify(adjustment), req.user.id],
        );
      }
      await audit(req, 'INVENTORY_ITEM_CREATED', { category: item.category }, 'inventory_item', id, client);
      state = await readInventoryState(client, schemaVersion);
    });
    return res.status(201).json({ data: state });
  });

  app.patch('/api/inventory/:id', requireRoles('school_nurse'), async (req, res) => {
    const id = inventoryRecordId(req.params.id);
    if (!id) return errorResponse(res, 400, 'VALIDATION_ERROR', 'A valid inventory item id is required.');
    const validation = validateInventoryItem(req.body || {});
    if (!validation.valid) return errorResponse(res, 400, 'VALIDATION_ERROR', validation.message);
    let state;
    await clinicDataTransaction(async (client) => {
      const schemaVersion = await validateVersionAfterAdvance(client, req.body?.schemaVersion);
      const locked = await client.query('SELECT id,quantity,data FROM inventory_items WHERE id=$1 FOR UPDATE', [id]);
      if (!locked.rowCount) {
        const error = new Error('Inventory item not found.');
        error.status = 404;
        error.code = 'NOT_FOUND';
        throw error;
      }
      const current = locked.rows[0].data || {};
      if (current.archived) {
        const error = new Error('Restore this item before editing it.');
        error.status = 409;
        error.code = 'ITEM_ARCHIVED';
        throw error;
      }
      const duplicate = await client.query(
        "SELECT id FROM inventory_items WHERE id<>$1 AND LOWER(data->>'name')=LOWER($2) AND COALESCE(data->>'archived','false') <> 'true' LIMIT 1",
        [id, validation.value.name],
      );
      if (duplicate.rowCount) {
        const error = new Error('An active inventory item with this name already exists.');
        error.status = 409;
        error.code = 'ITEM_NAME_EXISTS';
        throw error;
      }
      const next = { ...current, ...validation.value, id, quantity: locked.rows[0].quantity };
      await client.query('UPDATE inventory_items SET data=$1::jsonb,updated_at=NOW() WHERE id=$2', [JSON.stringify(next), id]);
      await audit(req, 'INVENTORY_ITEM_UPDATED', { category: next.category }, 'inventory_item', id, client);
      state = await readInventoryState(client, schemaVersion);
    });
    return res.json({ data: state });
  });

  app.post('/api/inventory/:id/stock-adjustments', requireRoles('school_nurse'), async (req, res) => {
    const id = inventoryRecordId(req.params.id);
    if (!id) return errorResponse(res, 400, 'VALIDATION_ERROR', 'A valid inventory item id is required.');
    const validation = validateStockAdjustment(req.body || {});
    if (!validation.valid) return errorResponse(res, 400, 'VALIDATION_ERROR', validation.message);
    let state;
    await clinicDataTransaction(async (client) => {
      const schemaVersion = await validateVersionAfterAdvance(client, req.body?.schemaVersion);
      const locked = await client.query('SELECT id,quantity,data FROM inventory_items WHERE id=$1 FOR UPDATE', [id]);
      if (!locked.rowCount) {
        const error = new Error('Inventory item not found.');
        error.status = 404;
        error.code = 'NOT_FOUND';
        throw error;
      }
      const current = locked.rows[0].data || {};
      if (current.archived) {
        const error = new Error('Archived items cannot have stock adjustments. Restore the item first.');
        error.status = 409;
        error.code = 'ITEM_ARCHIVED';
        throw error;
      }
      const adjustmentResult = applyStockAdjustment(locked.rows[0].quantity, validation.value.quantityDelta);
      if (!adjustmentResult.valid) {
        const error = new Error(adjustmentResult.message);
        error.status = 409;
        error.code = adjustmentResult.code;
        throw error;
      }
      const quantity = adjustmentResult.quantity;
      const next = { ...current, id, quantity };
      const adjustmentId = crypto.randomUUID();
      const adjustment = { id: adjustmentId, medicineId: id, medicineName: current.name || '', quantity: validation.value.quantityDelta, quantityDelta: validation.value.quantityDelta, reason: validation.value.reason, date: new Date().toISOString() };
      await client.query('UPDATE inventory_items SET quantity=$1,data=$2::jsonb,updated_at=NOW() WHERE id=$3', [quantity, JSON.stringify(next), id]);
      await client.query(
        'INSERT INTO stock_adjustments(id,inventory_item_id,quantity,data,created_by) VALUES($1,$2,$3,$4::jsonb,$5)',
        [adjustmentId, id, validation.value.quantityDelta, JSON.stringify(adjustment), req.user.id],
      );
      await audit(req, 'INVENTORY_STOCK_ADJUSTED', { quantityDelta: validation.value.quantityDelta }, 'inventory_item', id, client);
      state = await readInventoryState(client, schemaVersion);
    });
    return res.json({ data: state });
  });

  app.patch('/api/inventory/:id/archive', requireRoles('school_nurse'), async (req, res) => {
    const id = inventoryRecordId(req.params.id);
    if (!id) return errorResponse(res, 400, 'VALIDATION_ERROR', 'A valid inventory item id is required.');
    const validation = validateInventoryArchive(req.body || {});
    if (!validation.valid) return errorResponse(res, 400, 'VALIDATION_ERROR', validation.message);
    let state;
    await clinicDataTransaction(async (client) => {
      const schemaVersion = await validateVersionAfterAdvance(client, req.body?.schemaVersion);
      const locked = await client.query('SELECT id,quantity,data FROM inventory_items WHERE id=$1 FOR UPDATE', [id]);
      if (!locked.rowCount) {
        const error = new Error('Inventory item not found.');
        error.status = 404;
        error.code = 'NOT_FOUND';
        throw error;
      }
      const current = locked.rows[0].data || {};
      if (!validation.value.archived) {
        const duplicate = await client.query(
          "SELECT id FROM inventory_items WHERE id<>$1 AND LOWER(data->>'name')=LOWER($2) AND COALESCE(data->>'archived','false') <> 'true' LIMIT 1",
          [id, current.name || ''],
        );
        if (duplicate.rowCount) {
          const error = new Error('Another active inventory item already uses this name. Rename it before restoring this item.');
          error.status = 409;
          error.code = 'ITEM_NAME_EXISTS';
          throw error;
        }
      }
      const next = { ...current, id, quantity: locked.rows[0].quantity, archived: validation.value.archived, archivedAt: validation.value.archived ? new Date().toISOString() : null };
      await client.query('UPDATE inventory_items SET data=$1::jsonb,updated_at=NOW() WHERE id=$2', [JSON.stringify(next), id]);
      await audit(req, validation.value.archived ? 'INVENTORY_ITEM_ARCHIVED' : 'INVENTORY_ITEM_RESTORED', {}, 'inventory_item', id, client);
      state = await readInventoryState(client, schemaVersion);
    });
    return res.json({ data: state });
  });

  app.patch('/api/patients/:id/consent', requireRoles('school_nurse'), async (req, res) => {
    const patientId = String(req.params.id || '').trim();
    if (!patientId || patientId.length > 120) return errorResponse(res, 400, 'VALIDATION_ERROR', 'A valid patient id is required.');
    const validation = validateConsentUpdate(req.body || {});
    if (!validation.valid) return errorResponse(res, 400, 'VALIDATION_ERROR', validation.message, { consentStatus: validation.message });

    try {
      const result = await clinicDataTransaction(async (client) => {
        const locked = await client.query('SELECT data FROM patients WHERE id=$1 FOR UPDATE', [patientId]);
        if (!locked.rowCount) {
          const error = new Error('The selected patient was not found.');
          error.status = 404;
          error.code = 'PATIENT_NOT_FOUND';
          throw error;
        }
        const current = locked.rows[0].data && typeof locked.rows[0].data === 'object' && !Array.isArray(locked.rows[0].data)
          ? locked.rows[0].data
          : {};
        const next = { ...current, ...validation.value };
        await client.query('UPDATE patients SET data=$1::jsonb,updated_at=NOW() WHERE id=$2', [JSON.stringify(next), patientId]);
        await audit(req, 'PATIENT_CONSENT_TRACKING_UPDATED', validation.value, 'patient_consent', patientId, client);
        const version = await client.query('SELECT version FROM clinic_settings WHERE id=1');
        return { schemaVersion: version.rows[0]?.version };
      });
      return res.json({ data: { ...validation.value, schemaVersion: result.schemaVersion } });
    } catch (error) {
      if (error.status === 404) return errorResponse(res, 404, error.code, error.message);
      throw error;
    }
  });

  app.post('/api/risk/assess', requireRoles(...clinicalWriteRoles), async (req, res) => {
    const rules = await latestRules();
    const result = assessRisk(req.body || {}, rules);
    if (req.body?.visitId) {
      const visit = await query('SELECT id FROM visits WHERE id=$1', [String(req.body.visitId)]);
      if (!visit.rowCount) return errorResponse(res, 404, 'VISIT_NOT_FOUND', 'The visit for this assessment was not found.');
      await query(
        'INSERT INTO risk_assessments(id,visit_id,rule_version,result) VALUES($1,$2,$3,$4::jsonb)',
        [crypto.randomUUID(), String(req.body.visitId), Number(result.ruleVersion || 0), JSON.stringify(result)],
      );
    }
    await audit(req, 'RISK_ASSESSMENT_CALCULATED', { category: result.category, status: result.status, ruleVersion: result.ruleVersion });
    return res.json({ data: result });
  });

  app.post('/api/visits', requireRoles(...clinicalWriteRoles), async (req, res) => {
    const validation = validateVisitPayload(req.body || {});
    if (!validation.valid) return errorResponse(res, 400, 'VALIDATION_ERROR', 'Review the visit fields and try again.', validation.fields);
    const input = validation.value;
    if (input.summaryApproved && req.user.role !== 'school_nurse') {
      return errorResponse(res, 403, 'NURSE_APPROVAL_REQUIRED', 'Only a school nurse can approve a consultation summary.');
    }
    const rules = await latestRules();
    const recent = await query('SELECT COUNT(*)::int AS count FROM visits WHERE patient_id=$1', [input.patientId]);
    const assessment = assessRisk(visitRiskInput(input, recent.rows[0]?.count || 0), rules);
    if (assessment.status !== 'complete') return errorResponse(res, 400, 'RISK_INPUT_INCOMPLETE', assessment.rationale, { missingFields: assessment.missingFields });
    if (assessment.category === 'high' && !input.riskAcknowledgement) {
      return errorResponse(res, 400, 'HIGH_RISK_ACKNOWLEDGEMENT_REQUIRED', 'Document the nurse acknowledgement before saving a high-risk visit.', { riskAcknowledgement: 'Required for high-risk results.' });
    }
    if (input.summaryApproved && !input.summaryDraft) return errorResponse(res, 400, 'SUMMARY_REQUIRED', 'A nurse-approved summary must contain text.');

    const visitId = crypto.randomUUID();
    let visit;
    try {
      await clinicDataTransaction(async (client) => {
        const patient = await client.query('SELECT id,data FROM patients WHERE id=$1 FOR SHARE', [input.patientId]);
        if (!patient.rowCount) {
          const error = new Error('The selected patient was not found.');
          error.status = 404;
          error.code = 'PATIENT_NOT_FOUND';
          throw error;
        }
        const createdAt = new Date();
        const { resolved: resolvedDispensations, lockOrder } = await resolveInventoryDispensations(client, input.dispensations);
        const legacyMedicine = input.medicineId ? resolvedDispensations.find((entry) => entry.itemId === input.medicineId) : null;
        visit = {
          id: visitId,
          patientId: input.patientId,
          studentId: input.patientId,
          date: clinicCalendarDate(createdAt),
          time: createdAt.toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit' }),
          createdAt: createdAt.toISOString(),
          type: input.visitType,
          chiefComplaint: input.chiefComplaint,
          treatment: input.treatment,
          disposition: input.disposition,
          followUp: input.followUp,
          ...(input.followUpDate ? { followUpDate: input.followUpDate } : {}),
          medicineId: input.medicineId || null,
          medicineQuantity: input.medicineId ? input.medicineQuantity : 0,
          medicineName: legacyMedicine?.itemName || null,
          dispensations: resolvedDispensations.map(({ itemId, itemName, itemType, quantity }) => ({ itemId, itemName, itemType, quantity })),
          temperature: input.temperature,
          pulse: input.pulse,
          painScore: input.painScore,
          riskAssessment: assessment,
          riskAcknowledgement: input.riskAcknowledgement || '',
          notes: input.notes || '',
          consultationSummary: input.summaryApproved ? input.summaryDraft : '',
          summaryProvider: input.summaryApproved ? 'approved-nurse-workflow' : null,
          summaryApprovedBy: input.summaryApproved ? req.user.id : null,
          nurseName: req.user.name,
        };
        await persistVisitAndDispensations(client, {
          persistVisit: async () => {
            await client.query(
              'INSERT INTO visits(id,patient_id,data,created_by) VALUES($1,$2,$3::jsonb,$4)',
              [visitId, input.patientId, JSON.stringify(visit), req.user.id],
            );
            await client.query(
              'INSERT INTO risk_assessments(id,visit_id,rule_version,result,acknowledged_by,acknowledged_at,override_reason) VALUES($1,$2,$3,$4::jsonb,$5,CASE WHEN $6 THEN NOW() ELSE NULL END,$7)',
              [crypto.randomUUID(), visitId, Number(assessment.ruleVersion || 0), JSON.stringify(assessment), assessment.category === 'high' ? req.user.id : null, assessment.category === 'high' && Boolean(input.riskAcknowledgement), assessment.category === 'high' ? (input.riskAcknowledgement || null) : null],
            );
          },
          resolved: resolvedDispensations,
          lockOrder,
          visitId,
          createdAt,
          userId: req.user.id,
        });
        await audit(req, 'CLINIC_VISIT_CREATED', { category: assessment.category, ruleVersion: assessment.ruleVersion, inventoryItemsDispensed: resolvedDispensations.length }, 'visit', visitId, client);
      });
    } catch (error) {
      if (error.status) return errorResponse(res, error.status, error.code || 'VISIT_SAVE_FAILED', error.message);
      throw error;
    }
    try {
      await notifyLinkedUsers(input.patientId, {
        type: 'clinic_visit',
        subject: 'Clinic visit recorded',
        body: `A ${input.visitType.toLowerCase()} clinic visit was recorded on ${visit.date}.`,
        dedupeKey: `visit:${visitId}`,
      });
    } catch (error) {
      console.error('Visit notification failed:', error.message);
    }
    return res.status(201).json({ data: { visit, assessment, summaryPendingApproval: Boolean(input.summaryDraft && !input.summaryApproved) } });
  });

  app.get('/api/risk/rules', requireRoles(...reportReadRoles), async (_req, res) => {
    const result = await query('SELECT id,version,name,status,rules,approved_by,approved_at,created_at FROM risk_rules ORDER BY version DESC');
    return res.json({ data: { rules: result.rows, demonstrationRules: getDemonstrationRules() } });
  });

  app.post('/api/risk/rules', requireRoles('system_administrator'), async (req, res) => {
    const version = Number(req.body?.version);
    const name = String(req.body?.name || '').trim();
    const rules = req.body?.rules;
    const status = 'draft';
    if (!Number.isInteger(version) || version < 1 || !name || !rules || !Array.isArray(rules.indicators) || !validateRiskRules(rules).valid) {
      return errorResponse(res, 400, 'VALIDATION_ERROR', 'Version, name, thresholds, and indicators are required.');
    }
    const id = crypto.randomUUID();
    try {
      await query(
        `INSERT INTO risk_rules(id,version,name,rules,status,approved_by,approved_at)
         VALUES($1,$2,$3,$4::jsonb,$5,$6,CASE WHEN $5='clinician_approved' THEN NOW() ELSE NULL END)`,
        [id, version, name, JSON.stringify(rules), status, null],
      );
    } catch (error) {
      if (error.code === '23505') return errorResponse(res, 409, 'VERSION_EXISTS', 'That risk-rule version already exists.');
      throw error;
    }
    await audit(req, 'RISK_RULE_CREATED', { version, status }, 'risk_rule', id);
    return res.status(201).json({ data: { id, version, status } });
  });

  app.patch('/api/risk/rules/:id/approve', requireRoles('school_nurse'), async (req, res) => {
    if (!String(req.user.prc_license_number || '').trim()) return errorResponse(res, 403, 'LICENSE_REQUIRED', 'A school nurse with a recorded license is required to approve risk rules.');
    let approved;
    try {
      approved = await transaction(async (client) => {
        const rule = await approveDraftRiskRule(client, req.params.id, req.user.id);
        await audit(req, 'RISK_RULE_APPROVED', { version: rule.version, approverRole: req.user.role }, 'risk_rule', req.params.id, client);
        return rule;
      });
    } catch (error) {
      if (error.status) return errorResponse(res, error.status, error.code || 'RULE_APPROVAL_FAILED', error.message);
      throw error;
    }
    return res.json({ data: { ...approved, approvedBy: req.user.id } });
  });

  app.patch('/api/risk/assessments/:id/acknowledge', requireRoles(...clinicalWriteRoles), async (req, res) => {
    const reason = String(req.body?.overrideReason || '').trim();
    const result = await query('SELECT result FROM risk_assessments WHERE id=$1', [req.params.id]);
    if (!result.rowCount) return errorResponse(res, 404, 'NOT_FOUND', 'Risk assessment not found.');
    if (result.rows[0].result?.category === 'high' && !reason) return errorResponse(res, 400, 'OVERRIDE_REASON_REQUIRED', 'Document the acknowledgement or override reason for a high-risk result.');
    await query('UPDATE risk_assessments SET acknowledged_by=$1,acknowledged_at=NOW(),override_reason=$2 WHERE id=$3', [req.user.id, reason || null, req.params.id]);
    await audit(req, 'RISK_ASSESSMENT_ACKNOWLEDGED', { overrideReason: reason }, 'risk_assessment', req.params.id);
    return res.json({ data: { success: true } });
  });

  app.get('/api/queue', requireRoles(...clinicalWriteRoles), async (req, res) => {
    const search = String(req.query.search || '').trim().slice(0, 120);
    const result = await query(
      `SELECT q.id,q.patient_id,q.status,q.priority,q.data,q.created_at,q.updated_at,p.data AS patient
       FROM queue_entries q JOIN patients p ON p.id=q.patient_id
       WHERE ($1='' OR LOWER(COALESCE(p.data->>'name','')) LIKE LOWER('%' || $1 || '%') OR LOWER(q.patient_id) LIKE LOWER('%' || $1 || '%'))
       ORDER BY q.priority DESC,q.created_at ASC`,
      [search],
    );
    return res.json({ data: { queue: result.rows.map((row) => ({ ...row.data, id: row.id, patientId: row.patient_id, status: row.status, priority: row.priority, arrivalAt: row.created_at, patient: row.patient })) } });
  });

  app.post('/api/queue', requireRoles(...clinicalWriteRoles), async (req, res) => {
    const patientId = String(req.body?.patientId || '').trim();
    const triage = validateQueueTriage(req.body || {});
    if (!triage.valid) return errorResponse(res, 400, 'TRIAGE_REASON_REQUIRED', triage.message);
    const priority = riskPriority(triage.value.triagePriority);
    if (!patientId) return errorResponse(res, 400, 'VALIDATION_ERROR', 'Select a patient to add to the queue.');
    const id = crypto.randomUUID();
    try {
      await clinicDataTransaction(async (client) => {
        const patient = await client.query('SELECT id FROM patients WHERE id=$1', [patientId]);
        if (!patient.rowCount) {
          const error = new Error('The selected patient was not found.');
          error.status = 404;
          error.code = 'PATIENT_NOT_FOUND';
          throw error;
        }
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`queue:${patientId}`]);
        const active = await client.query("SELECT 1 FROM queue_entries WHERE patient_id=$1 AND status <> 'Released' LIMIT 1", [patientId]);
        if (active.rowCount) {
          const error = new Error('This patient is already active in the queue.');
          error.status = 409;
          error.code = 'ALREADY_QUEUED';
          throw error;
        }
        const arrivalAt = new Date();
        const data = { id, patientId, status: 'Waiting', priority, triagePriority: triage.value.triagePriority, triageReason: triage.value.triageReason, prioritySource: triage.value.prioritySource, arrivalAt: arrivalAt.toISOString() };
        await client.query('INSERT INTO queue_entries(id,patient_id,status,priority,data) VALUES($1,$2,$3,$4,$5::jsonb)', [id, patientId, 'Waiting', priority, JSON.stringify(data)]);
        await audit(req, 'QUEUE_ENTRY_CREATED', { triagePriority: triage.value.triagePriority, triageReason: triage.value.triageReason, prioritySource: triage.value.prioritySource, priority }, 'queue_entry', id, client);
      });
    } catch (error) {
      if (error.status) return errorResponse(res, error.status, error.code, error.message);
      throw error;
    }
    return res.status(201).json({ data: { id, patientId, status: 'Waiting', priority, ...triage.value } });
  });

  app.patch('/api/queue/:id', requireRoles(...clinicalWriteRoles), async (req, res) => {
    const status = String(req.body?.status || '').trim();
    const statuses = new Set(['Waiting', 'Being Seen', 'Treated', 'Released']);
    if (!statuses.has(status)) return errorResponse(res, 400, 'INVALID_STATUS', 'Choose a valid queue status.');
    let response;
    try {
      await clinicDataTransaction(async (client) => {
        const identity = await client.query('SELECT patient_id FROM queue_entries WHERE id=$1', [req.params.id]);
        if (!identity.rowCount) {
          const error = new Error('Queue entry not found.');
          error.status = 404;
          error.code = 'NOT_FOUND';
          throw error;
        }
        const patientId = identity.rows[0].patient_id;
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`queue:${patientId}`]);
        const current = await client.query('SELECT id,patient_id,status,priority,data FROM queue_entries WHERE id=$1 FOR UPDATE', [req.params.id]);
        if (!current.rowCount) {
          const error = new Error('Queue entry not found.');
          error.status = 404;
          error.code = 'NOT_FOUND';
          throw error;
        }
        if (status !== 'Released') {
          const active = await client.query("SELECT 1 FROM queue_entries WHERE patient_id=$1 AND id<>$2 AND status <> 'Released' LIMIT 1 FOR UPDATE", [patientId, req.params.id]);
          if (queueStatusConflict(current.rows[0].status, status, active.rowCount > 0)) {
            const error = new Error('This patient already has another active queue entry.');
            error.status = 409;
            error.code = 'ALREADY_QUEUED';
            throw error;
          }
        }
        const data = { ...current.rows[0].data, status, updatedAt: new Date().toISOString() };
        await client.query('UPDATE queue_entries SET status=$1,data=$2::jsonb,updated_at=NOW() WHERE id=$3', [status, JSON.stringify(data), req.params.id]);
        await audit(req, 'QUEUE_ENTRY_UPDATED', { status }, 'queue_entry', req.params.id, client);
        response = { ...data, id: req.params.id, patientId, priority: current.rows[0].priority };
      });
    } catch (error) {
      if (error.status) return errorResponse(res, error.status, error.code, error.message);
      throw error;
    }
    return res.json({ data: response });
  });

  app.post('/api/import/students', requireRoles('system_administrator'), async (req, res) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length || rows.length > 1000) return errorResponse(res, 400, 'VALIDATION_ERROR', 'Import between 1 and 1,000 fictional students.');
    const field = (row, key, max) => String(row?.[key] || '').trim().slice(0, max);
    const normalized = rows.map((row) => ({
      studentId: field(row, 'studentId', 80),
      name: field(row, 'name', 160),
      gradeLevel: field(row, 'gradeLevel', 40),
      section: field(row, 'section', 80),
      adviser: field(row, 'adviser', 160),
      birthDate: field(row, 'birthDate', 10),
      gender: field(row, 'gender', 30),
      guardianName: field(row, 'guardianName', 160),
      guardianPhone: field(row, 'guardianPhone', 40),
      guardianRelation: field(row, 'guardianRelation', 80),
    }));
    const keys = new Set();
    let duplicate = -1;
    for (let index = 0; index < normalized.length; index += 1) {
      const key = normalized[index].studentId.toLowerCase();
      if (!normalized[index].studentId || !normalized[index].name || keys.has(key)) { duplicate = index; break; }
      keys.add(key);
    }
    if (duplicate >= 0) return errorResponse(res, 400, 'VALIDATION_ERROR', `Student import row ${duplicate + 1} needs a unique Student ID and Name.`);
    let imported = 0;
    await clinicDataTransaction(async (client) => {
      for (const row of normalized) {
        const existing = await client.query("SELECT 1 FROM patients WHERE data->>'studentId'=$1 LIMIT 1", [row.studentId]);
        if (existing.rowCount) {
          const error = new Error(`Student ID ${row.studentId} already exists.`);
          error.status = 409;
          error.code = 'DUPLICATE_RECORD';
          throw error;
        }
        const id = crypto.randomUUID();
        await client.query("INSERT INTO patients(id,patient_type,data) VALUES($1,'student',$2::jsonb)", [id, JSON.stringify({ ...row, id })]);
        imported += 1;
      }
      await audit(req, 'STUDENTS_IMPORTED', { imported }, 'student_import', crypto.randomUUID(), client);
    });
    return res.status(201).json({ data: { imported } });
  });

  app.post('/api/import/visits', requireRoles(...clinicalWriteRoles), async (req, res) => {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length || rows.length > 1000) return errorResponse(res, 400, 'VALIDATION_ERROR', 'Import between 1 and 1,000 historical visits.');
    const normalized = rows.map((row) => ({
      patientId: String(row.patientId || row.studentId || '').trim(),
      date: String(row.date || '').trim(),
      type: String(row.type || 'Illness').trim().slice(0, 40),
      chiefComplaint: String(row.chiefComplaint || row.complaint || '').trim().slice(0, 300),
      treatment: String(row.treatment || '').trim().slice(0, 300),
      disposition: String(row.disposition || '').trim().slice(0, 120),
      notes: String(row.notes || '').trim().slice(0, 2000),
    }));
    const invalid = normalized.findIndex((row) => !row.patientId || !/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !row.chiefComplaint || !row.treatment);
    if (invalid >= 0) return errorResponse(res, 400, 'VALIDATION_ERROR', `Historical visit row ${invalid + 1} needs patient ID, date, complaint, and treatment.`);
    const duplicateKeys = new Set();
    const duplicateRow = normalized.findIndex((row) => {
      const key = `${row.patientId.toLowerCase()}|${row.date}|${row.chiefComplaint.toLowerCase()}`;
      if (duplicateKeys.has(key)) return true;
      duplicateKeys.add(key);
      return false;
    });
    if (duplicateRow >= 0) return errorResponse(res, 409, 'DUPLICATE_RECORD', `Historical visit row ${duplicateRow + 1} duplicates another row in this file.`);
    let imported = 0;
    await clinicDataTransaction(async (client) => {
      for (const row of normalized) {
        const patient = await client.query("SELECT id FROM patients WHERE id=$1 OR data->>'studentId'=$1 LIMIT 1", [row.patientId]);
        if (!patient.rowCount) {
          const error = new Error(`Patient ${row.patientId} was not found.`);
          error.status = 400;
          error.code = 'PATIENT_NOT_FOUND';
          throw error;
        }
        const existing = await client.query("SELECT 1 FROM visits WHERE patient_id=$1 AND data->>'date'=$2 AND LOWER(data->>'chiefComplaint')=LOWER($3) LIMIT 1", [patient.rows[0].id, row.date, row.chiefComplaint]);
        if (existing.rowCount) {
          const error = new Error(`A visit for ${row.patientId} on ${row.date} already exists.`);
          error.status = 409;
          error.code = 'DUPLICATE_RECORD';
          throw error;
        }
        const id = crypto.randomUUID();
        const data = { id, studentId: patient.rows[0].id, patientId: patient.rows[0].id, date: row.date, type: row.type, chiefComplaint: row.chiefComplaint, treatment: row.treatment, disposition: row.disposition, notes: row.notes, historicalImport: true, riskAssessment: null };
        await client.query('INSERT INTO visits(id,patient_id,data,created_by) VALUES($1,$2,$3::jsonb,$4)', [id, patient.rows[0].id, JSON.stringify(data), req.user.id]);
        imported += 1;
      }
      await audit(req, 'HISTORICAL_VISITS_IMPORTED', { imported }, 'visit_import', crypto.randomUUID(), client);
    });
    return res.status(201).json({ data: { imported } });
  });

  app.post('/api/visits/:id/summary', requireRoles(...clinicalWriteRoles), async (req, res) => {
    const visitResult = await query('SELECT data FROM visits WHERE id=$1', [req.params.id]);
    if (!visitResult.rowCount) return errorResponse(res, 404, 'NOT_FOUND', 'Visit not found.');
    const summary = await summarizeEncounter(visitResult.rows[0].data);
    await audit(req, 'CONSULTATION_SUMMARY_DRAFTED', { provider: summary.provider }, 'visit', req.params.id);
    return res.json({ data: { ...summary, requiresNurseApproval: true } });
  });

  app.post('/api/summaries/draft', requireRoles(...clinicalWriteRoles), async (req, res) => {
    const summary = await summarizeEncounter(req.body || {});
    await audit(req, 'CONSULTATION_SUMMARY_DRAFTED', { provider: summary.provider });
    return res.json({ data: { ...summary, requiresNurseApproval: true } });
  });

  app.get('/api/reports', requireRoles(...reportReadRoles), async (req, res) => {
    const end = String(req.query.end || new Date().toISOString().slice(0, 10));
    const start = String(req.query.start || end);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || Number.isNaN(Date.parse(`${start}T00:00:00Z`)) || Number.isNaN(Date.parse(`${end}T00:00:00Z`)) || start > end || (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) > 366 * 86400000) return errorResponse(res, 400, 'INVALID_PERIOD', 'Provide a valid report date range of one year or less.');
    return res.json({ data: visibleReport(buildClinicReport(await loadClinicData(req.user, { includeClinical: true }), start, end), req.user) });
  });

  app.get('/api/appointments/slots', requireAuth, async (req, res) => {
    const date = String(req.query.date || '');
    if (!isValidAppointmentDate(date)) return errorResponse(res, 400, 'INVALID_DATE', 'Provide a real date in YYYY-MM-DD format.');
    const [settingsResult, existing, visits] = await Promise.all([
      query('SELECT data FROM clinic_settings WHERE id=1'),
      query("SELECT starts_at FROM appointments WHERE (starts_at AT TIME ZONE 'Asia/Manila')::date=$1::date AND status NOT IN ('Cancelled','Rejected')", [date]),
      query("SELECT created_at FROM visits WHERE created_at >= NOW()-INTERVAL '90 days' AND created_at < NOW() AND data->>'historicalImport' IS DISTINCT FROM 'true'"),
    ]);
    const schedule = appointmentSettings(settingsResult.rows[0]?.data || {});
    const now = new Date();
    const freeSlots = generateAppointmentSlots(date, existing.rows.map((row) => row.starts_at), { ...schedule, now });
    const suggestions = rankAppointmentSlots(date, freeSlots, visits.rows.map((row) => row.created_at), schedule);
    const slots = suggestions.slots.map(({ local, startsAt, suggestionRank }) => ({ local, startsAt, suggestionRank }));
    const traffic = {
      historyAvailable: Boolean(suggestions.traffic.historyAvailable),
      lookbackDays: suggestions.traffic.lookbackDays,
    };
    return res.json({ data: { date, slots, traffic, schedule } });
  });

  app.post('/api/reports/snapshots', requireRoles(...reportReadRoles), async (req, res) => {
    const { start, end, type = 'custom' } = req.body || {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(start || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(end || '')) || Number.isNaN(Date.parse(`${start}T00:00:00Z`)) || Number.isNaN(Date.parse(`${end}T00:00:00Z`)) || start > end || (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) > 366 * 86400000) {
      return errorResponse(res, 400, 'INVALID_PERIOD', 'Provide a valid report date range.');
    }
    if (!['daily', 'weekly', 'monthly', 'custom'].includes(type)) return errorResponse(res, 400, 'INVALID_REPORT_TYPE', 'Invalid report type.');
    const report = buildClinicReport(await loadClinicData(req.user, { includeClinical: true }), start, end);
    const id = crypto.randomUUID();
    await query(
      'INSERT INTO report_snapshots(id,report_type,period_start,period_end,data,created_by) VALUES($1,$2,$3,$4,$5::jsonb,$6)',
      [id, type, start, end, JSON.stringify(reportSnapshotForStorage(report)), req.user.id],
    );
    await audit(req, 'REPORT_SNAPSHOT_CREATED', { type, start, end }, 'report', id);
    return res.status(201).json({ data: { id, ...visibleReport(report, req.user) } });
  });

  app.get('/api/reports/snapshots', requireRoles(...reportReadRoles), async (req, res) => {
    const result = await query('SELECT id,report_type,period_start,period_end,data,created_at FROM report_snapshots ORDER BY created_at DESC LIMIT 100');
    return res.json({ data: { snapshots: result.rows.map((snapshot) => ({ ...snapshot, data: visibleReport(reportSnapshotForStorage(snapshot.data || {}), req.user) })) } });
  });

  app.get('/api/notifications', requireAuth, async (req, res) => {
    const result = await query('SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100', [req.user.id]);
    return res.json({ data: { notifications: result.rows } });
  });

  app.patch('/api/notifications/:id/read', requireAuth, async (req, res) => {
    const result = await query("UPDATE notifications SET status='read',read_at=NOW() WHERE id=$1 AND user_id=$2 RETURNING *", [req.params.id, req.user.id]);
    if (!result.rowCount) return errorResponse(res, 404, 'NOT_FOUND', 'Notification not found.');
    return res.json({ data: { notification: result.rows[0] } });
  });

  app.post('/api/appointments', requireRoles('student', 'guardian', ...clinicalWriteRoles), async (req, res) => {
    const patientId = String(req.body?.patientId || '').trim();
    const startsAt = clinicDateTime(req.body?.startsAt);
    const reason = String(req.body?.reason || '').trim().slice(0, 500);
    if (!patientId || Number.isNaN(startsAt.getTime()) || !reason) return errorResponse(res, 400, 'VALIDATION_ERROR', 'Patient, appointment time, and reason are required.');
    if (startsAt.getTime() <= Date.now()) return errorResponse(res, 400, 'PAST_APPOINTMENT', 'Choose a future appointment time.');
    if (!(await canAccessPatient(req.user, patientId))) return errorResponse(res, 403, 'FORBIDDEN', 'You cannot book for this patient.');
    const settingsResult = await query('SELECT data FROM clinic_settings WHERE id=1');
    const schedule = appointmentSettings(settingsResult.rows[0]?.data || {});
    const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(startsAt);
    if (!generateAppointmentSlots(localDate, [], schedule).some((slot) => slot.startsAt === startsAt.toISOString())) return errorResponse(res, 400, 'OUTSIDE_CLINIC_HOURS', 'Choose an available weekday slot during clinic hours.');
    const id = crypto.randomUUID();
    try {
      await clinicDataTransaction(async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [startsAt.toISOString()]);
        const conflict = await client.query("SELECT 1 FROM appointments WHERE starts_at=$1 AND status NOT IN ('Cancelled','Rejected') LIMIT 1", [startsAt]);
        if (conflict.rowCount) {
          const error = new Error('That appointment time is no longer available.');
          error.status = 409;
          throw error;
        }
        const record = { id, patientId, startsAt: startsAt.toISOString(), reason, status: staffRoles.includes(req.user.role) ? 'Scheduled' : 'Requested' };
        await client.query(
          'INSERT INTO appointments(id,patient_id,starts_at,status,data,created_by) VALUES($1,$2,$3,$4,$5::jsonb,$6)',
          [id, patientId, startsAt, record.status, JSON.stringify(record), req.user.id],
        );
      });
    } catch (error) {
      if (error.status === 409) return errorResponse(res, 409, 'APPOINTMENT_CONFLICT', error.message);
      throw error;
    }
    await audit(req, 'APPOINTMENT_CREATED', { startsAt: startsAt.toISOString() }, 'appointment', id);
    await notifyLinkedUsers(patientId, {
      type: 'appointment',
      subject: 'Clinic appointment request received',
      body: `A clinic appointment request was recorded for ${formatAppointmentLabel(startsAt)}.`,
      dedupeKey: `appointment:${id}`,
    });
    return res.status(201).json({ data: { id } });
  });

  app.patch('/api/appointments/:id', requireRoles(...clinicalWriteRoles), async (req, res) => {
    const hasReschedule = req.body?.startsAt !== undefined;
    let updated;
    try {
      updated = await clinicDataTransaction(async (client) => {
        const current = await client.query('SELECT * FROM appointments WHERE id=$1 FOR UPDATE', [req.params.id]);
        if (!current.rowCount) {
          const error = new Error('Appointment not found.');
          error.status = 404;
          error.code = 'NOT_FOUND';
          throw error;
        }
        const row = current.rows[0];
        const currentStatus = normalizeAppointmentStatus(row.status);
        const status = normalizeAppointmentStatus(req.body?.status || currentStatus);
        if (!['Requested', 'Scheduled', 'Completed', 'Cancelled', 'Rejected'].includes(status)) {
          const error = new Error('Invalid appointment status.');
          error.status = 400;
          error.code = 'INVALID_STATUS';
          throw error;
        }
        if (!isAppointmentTransitionAllowed(currentStatus, status)) {
          const error = new Error(`An appointment cannot move from ${currentStatus} to ${status}.`);
          error.status = 409;
          error.code = 'INVALID_TRANSITION';
          throw error;
        }
        if (hasReschedule && !['Requested', 'Scheduled'].includes(currentStatus)) {
          const error = new Error('Completed, cancelled, and rejected appointments cannot be rescheduled.');
          error.status = 409;
          error.code = 'RESCHEDULE_NOT_ALLOWED';
          throw error;
        }
        const currentStartsAt = row.starts_at || row.data?.startsAt || (row.data?.date ? `${row.data.date}T${row.data.time || '00:00'}` : null);
        const startsAt = hasReschedule ? clinicDateTime(req.body.startsAt) : currentStartsAt ? clinicDateTime(currentStartsAt) : null;
        if (hasReschedule && (!startsAt || Number.isNaN(startsAt.getTime()))) {
          const error = new Error('A valid appointment date is required.');
          error.status = 400;
          error.code = 'INVALID_DATE';
          throw error;
        }
        if (hasReschedule && startsAt.getTime() <= Date.now()) {
          const error = new Error('Choose a future appointment time.');
          error.status = 400;
          error.code = 'PAST_APPOINTMENT';
          throw error;
        }
        if (hasReschedule) {
          const settingsResult = await client.query('SELECT data FROM clinic_settings WHERE id=1');
          const schedule = appointmentSettings(settingsResult.rows[0]?.data || {});
          const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(startsAt);
          if (!generateAppointmentSlots(localDate, [], schedule).some((slot) => slot.startsAt === startsAt.toISOString())) {
            const error = new Error('Choose an available weekday slot during clinic hours.');
            error.status = 400;
            error.code = 'OUTSIDE_CLINIC_HOURS';
            throw error;
          }
        }
        const record = { ...row.data, startsAt: startsAt?.toISOString() || null, status };
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [startsAt?.toISOString() || `appointment:${req.params.id}`]);
        if (!['Cancelled', 'Rejected'].includes(status)) {
          const conflict = await client.query(
            "SELECT 1 FROM appointments WHERE starts_at=$1 AND id<>$2 AND status NOT IN ('Cancelled','Rejected') LIMIT 1",
            [startsAt, req.params.id],
          );
          if (conflict.rowCount) {
            const error = new Error('That appointment time is no longer available.');
            error.status = 409;
            error.code = 'APPOINTMENT_CONFLICT';
            throw error;
          }
        }
        await client.query('UPDATE appointments SET starts_at=$1,status=$2,data=$3::jsonb,updated_at=NOW() WHERE id=$4', [startsAt, status, JSON.stringify(record), req.params.id]);
        await audit(req, 'APPOINTMENT_UPDATED', { status, startsAt: startsAt?.toISOString() || null }, 'appointment', req.params.id, client);
        return { appointment: record, patientId: row.patient_id, startsAt, status };
      });
    } catch (error) {
      if (error.status) return errorResponse(res, error.status, error.code || 'APPOINTMENT_UPDATE_FAILED', error.message);
      throw error;
    }
    await notifyLinkedUsers(updated.patientId, {
      type: 'appointment',
      subject: 'Clinic appointment updated',
      body: `Your clinic appointment is now ${updated.status.toLowerCase()}${updated.startsAt ? ` for ${updated.startsAt.toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}` : ''}.`,
      dedupeKey: `appointment-update:${req.params.id}:${updated.status}:${updated.startsAt?.toISOString() || 'no-time'}`,
    });
    return res.json({ data: { appointment: updated.appointment } });
  });

  app.post('/api/admin/notifications/reminders', requireRoles('system_administrator'), async (req, res) => {
    const result = await runClinicReminders({ req });
    return res.status(201).json({ data: result });
  });

  app.post('/api/admin/notifications/broadcast', requireRoles('system_administrator'), async (req, res) => {
    const validation = validateBroadcastPayload(req.body);
    if (!validation.valid) return errorResponse(res, 400, 'VALIDATION_ERROR', validation.message);
    const { type, subject, body, roles, requestId } = validation.value;
    const recipients = await query("SELECT id,email,name FROM users WHERE status='active' AND role=ANY($1::text[])", [roles]);
    const batchId = broadcastBatchId(req.user.id, requestId);
    await audit(req, 'NOTIFICATION_BROADCAST_STARTED', { type, roles, recipientCount: recipients.rowCount }, 'notification_batch', batchId);
    let inAppCreated = 0;
    let emailsSent = 0;
    let emailFailures = 0;
    let duplicateEmailNoticesSkipped = 0;
    for (const recipient of recipients.rows) {
      const inAppNotice = await createNotification({ userId: recipient.id, type, subject, body, dedupeKey: `broadcast:${batchId}:in-app:${recipient.id}` });
      if (inAppNotice) inAppCreated += 1;
      const emailDedupeKey = `broadcast:${batchId}:email:${recipient.id}`;
      const emailNotice = await createNotification({ userId: recipient.id, channel: 'email', type, subject, body, dedupeKey: emailDedupeKey });
      if (!emailNotice) {
        duplicateEmailNoticesSkipped += 1;
        const existing = await query('SELECT status FROM notifications WHERE dedupe_key=$1', [emailDedupeKey]);
        if (existing.rows[0]?.status === 'failed') emailFailures += 1;
        continue;
      }
      try {
        await sendEmail({ to: recipient.email, subject, text: body, html: `<p>Hello ${escapeHtml(recipient.name)},</p><p>${escapeHtml(body)}</p>` });
        await query("UPDATE notifications SET status='sent',sent_at=NOW() WHERE id=$1", [emailNotice.id]);
        emailsSent += 1;
      } catch {
        await query("UPDATE notifications SET status='failed' WHERE id=$1", [emailNotice.id]);
        emailFailures += 1;
      }
    }
    await audit(req, 'NOTIFICATION_BROADCAST_COMPLETED', { type, roles, recipientCount: recipients.rowCount, inAppCreated, emailsSent, emailFailures, duplicateEmailNoticesSkipped }, 'notification_batch', batchId);
    return res.status(201).json({ data: { batchId, recipientCount: recipients.rowCount, inAppCreated, emailsSent, emailFailures, duplicateEmailNoticesSkipped } });
  });

  app.post('/api/notifications/test', requireRoles('system_administrator'), async (req, res) => {
    const notification = await createNotification({ userId: req.user.id, type: 'system_test', subject: 'HealthMate+ notification test', body: 'In-app notifications are working.', dedupeKey: `system-test:${req.user.id}:${new Date().toISOString().slice(0, 13)}` });
    return res.status(notification ? 201 : 200).json({ data: { notification } });
  });

  if (existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get('/{*splat}', (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      return res.sendFile(join(distDir, 'index.html'));
    });
  }

  app.use((req, res) => errorResponse(res, 404, 'NOT_FOUND', 'The requested endpoint was not found.'));
  app.use((error, req, res, _next) => {
    console.error(error);
    const status = Number(error.status) || (error.code === 'DATABASE_NOT_CONFIGURED' ? 503 : 500);
    const code = error.code || (status === 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED');
    const message = status === 500 ? 'An unexpected server error occurred.' : error.message;
    if (req.path?.startsWith('/api/')) return errorResponse(res, status, code, message);
    return res.status(status).send(message);
  });

  return app;
}
