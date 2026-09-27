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
  currentSessionTokenHash,
  findUser,
  hashPassword,
  hashSecret,
  issueSession,
  loginFailureKeyFor,
  listUserSessions,
  loadSession,
  normalizeIdentifier,
  publicUser,
  recordFailedLogin,
  revokeAllUserSessions,
  revokeUserSession,
  requireAuth,
  requireRoles,
  validEmail,
  validatePassword,
  verifyPassword,
} from './auth.js';
import { emailConfigured, escapeHtml, sendEmail } from './email.js';
import { activateRiskRuleForTesting, approveDraftRiskRule, assessRisk, disableRiskRuleTesting, ensureConservativeCandidateDraft, getConservativeCandidateRuleDraft, getDemonstrationRules, readTestRiskRuleActivation, riskAllowsAcknowledgedIncomplete, riskNeedsNurseAcknowledgement, selectRiskRules, validateRiskRules } from './domain/risk.js';
import { buildClinicReport, reportForRole, reportSnapshotForStorage } from './domain/reporting.js';
import { applyStockAdjustment, validateInventoryArchive, validateInventoryItem, validateStockAdjustment } from './domain/inventory.js';
import { persistVisitAndDispensations, resolveInventoryDispensations } from './domain/dispensing.js';
import { validateChangedClinicalRecords } from './domain/clinical-records.js';
import { sanitizeAuditLogs } from './domain/audit.js';
import { summarizeEncounter } from './ai.js';
import { clinicCalendarDate, validateVisitPayload, visitRiskInput } from './domain/visit.js';
import { appointmentSettings, clinicDateTime, generateAppointmentSlots, isAppointmentTransitionAllowed, isValidAppointmentDate, normalizeAppointmentStatus, rankAppointmentSlots } from './domain/scheduling.js';
import { clinicalWriteRoles, reportReadRoles } from './domain/authorization.js';
import { broadcastBatchId, validateBroadcastPayload, validateConsentUpdate } from './domain/communications.js';
import { clinicDataTransaction, linkUserToPatient, listUsers, loadClinicData, saveClinicData, validateVersionAfterAdvance } from './repository.js';
import { runClinicReminderSweep } from './reminders.js';
import { canRollbackImport, normalizeImportRows, selectedImportRows } from './domain/imports.js';
import { ensureSameOrigin, loginOtpRequired, rateLimit, requestOriginAllowed, trustProxyHops } from './security.js';
import { buildInvitationActivationUrl } from './invitationUrl.js';
import { recordNurseLicenseVerification, validateNurseLicenseUpdate } from './domain/nurseLicense.js';

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

function validUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

async function latestRules() {
  return selectRiskRules({ query });
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

async function inspectImportRows(type, rows, client = { query }) {
  const batch = normalizeImportRows(type, rows);
  if (!batch.validType || batch.invalidBatch) return batch;
  for (const row of batch.normalizedRows) {
    if (row.status !== 'ready') continue;
    if (type === 'students' || type === 'faculty') {
      const identifier = type === 'faculty' ? row.record.facultyId : row.record.studentId;
      const existing = await client.query(
        "SELECT id FROM patients WHERE LOWER(COALESCE(data->>'studentId',data->>'facultyId',''))=LOWER($1) LIMIT 1",
        [identifier],
      );
      if (existing.rowCount) {
        row.duplicate = true;
        row.duplicateReason = 'An existing patient already uses this ID.';
        row.status = 'duplicate';
        row.defaultAction = 'skip';
      }
      continue;
    }

    const patient = await client.query(
      "SELECT id FROM patients WHERE id=$1 OR LOWER(COALESCE(data->>'studentId',data->>'facultyId',''))=LOWER($1) LIMIT 1",
      [row.record.patientId],
    );
    if (!patient.rowCount) {
      row.errors.push('Patient ID was not found.');
      row.status = 'invalid';
      row.defaultAction = 'skip';
      continue;
    }
    row.patientId = patient.rows[0].id;
    const duplicate = await client.query(
      "SELECT 1 FROM visits WHERE patient_id=$1 AND data->>'date'=$2 AND LOWER(data->>'chiefComplaint')=LOWER($3) LIMIT 1",
      [row.patientId, row.record.date, row.record.chiefComplaint],
    );
    if (duplicate.rowCount) {
      row.duplicate = true;
      row.duplicateReason = 'A visit with this patient, date, and complaint already exists.';
      row.status = 'duplicate';
      row.defaultAction = 'skip';
    }
  }
  return batch;
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxyHops());
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(cors({ origin: (origin, callback) => callback(null, requestOriginAllowed(origin)), credentials: true }));
  app.use('/api/auth', express.json({ limit: '16kb' }));
  app.use(express.json({ limit: '5mb' }));
  app.use(ensureSameOrigin);

  const authIpLimiter = rateLimit({ limit: 300, windowMs: 15 * 60 * 1000 });
  const loginIdentityLimiter = rateLimit({
    limit: 20,
    windowMs: 15 * 60 * 1000,
    key: (req) => {
      const identifier = typeof (req.body?.identifier ?? req.body?.username) === 'string'
        ? (req.body.identifier ?? req.body.username).trim().toLowerCase().slice(0, 254)
        : '';
      return `${req.ip || req.socket?.remoteAddress || 'unknown'}:${identifier}`;
    },
  });
  const resetRequestLimiter = rateLimit({ limit: 60, windowMs: 60 * 60 * 1000 });
  const resetConfirmLimiter = rateLimit({ limit: 60, windowMs: 15 * 60 * 1000 });
  const otpVerifyLimiter = rateLimit({ limit: 120, windowMs: 15 * 60 * 1000 });
  const reauthLimiter = rateLimit({
    limit: 20,
    windowMs: 15 * 60 * 1000,
    key: (req) => `${req.ip || req.socket?.remoteAddress || 'unknown'}:${req.user?.id || 'unauthenticated'}`,
  });

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

  app.post('/api/auth/login', authIpLimiter, loginIdentityLimiter, async (req, res) => {
    const rawIdentifier = req.body?.identifier ?? req.body?.username;
    const password = req.body?.password;
    if (typeof rawIdentifier !== 'string' || rawIdentifier.length > 254 || typeof password !== 'string' || password.length > 1024) {
      return errorResponse(res, 400, 'VALIDATION_ERROR', 'Email/username or password is invalid.');
    }
    const identifier = normalizeIdentifier(rawIdentifier);
    if (!identifier || !password) return errorResponse(res, 400, 'VALIDATION_ERROR', 'Email/username and password are required.');
    const user = await findUser(identifier);
    const failureKey = loginFailureKeyFor(user, identifier);
    const lockedUntil = await checkLoginLock(failureKey, identifier);
    if (lockedUntil) return errorResponse(res, 429, 'ACCOUNT_LOCKED', 'Too many failed sign-in attempts. Try again later.');
    const valid = user ? await verifyPassword(password, user.password_hash) : false;
    if (!user || !valid) {
      const attemptsRemaining = await recordFailedLogin(failureKey);
      await audit(req, 'LOGIN_FAILED', { identifier, attemptsRemaining });
      return errorResponse(res, 401, 'INVALID_CREDENTIALS', 'Invalid credentials.');
    }
    await clearFailedLogin(failureKey, identifier);
    if (user.status !== 'active') return errorResponse(res, 403, 'ACCOUNT_INACTIVE', 'This account is not active. Contact an administrator.');
    const requireOtp = loginOtpRequired();
    if (requireOtp) {
      const challengeId = await createOtpChallenge(user, 'login', { remember: req.body?.remember === true });
      await audit(req, 'LOGIN_OTP_SENT', { userId: user.id });
      return res.status(202).json({ data: { mfaRequired: true, challengeId, username: user.username, message: 'A verification code was sent to your email.' } });
    }
    await issueSession(req, res, user, req.body?.remember === true);
    await query('UPDATE users SET last_login_at=NOW() WHERE id=$1', [user.id]);
    req.user = user;
    await audit(req, 'LOGIN_SUCCESS');
    return res.json({ data: { user: publicUser(user) } });
  });

  app.post('/api/auth/otp/verify', otpVerifyLimiter, async (req, res) => {
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

  app.get('/api/auth/sessions', requireAuth, async (req, res) => {
    const sessions = await listUserSessions(req.user.id, currentSessionTokenHash(req));
    return res.json({ data: { sessions } });
  });

  app.delete('/api/auth/sessions/:sessionId', requireAuth, async (req, res) => {
    const sessionId = req.params.sessionId;
    if (!/^[0-9a-f]{64}$/i.test(sessionId)) return errorResponse(res, 400, 'INVALID_SESSION', 'The session identifier is invalid.');
    const result = await revokeUserSession(req.user.id, sessionId);
    if (!result.rowCount) return errorResponse(res, 404, 'SESSION_NOT_FOUND', 'That session is no longer active.');
    const current = sessionId === currentSessionTokenHash(req);
    if (current) await clearSession(req, res);
    await audit(req, 'SESSION_REVOKED', { current }, 'session', sessionId);
    return res.json({ data: { success: true, current } });
  });

  app.post('/api/auth/sessions/logout-all', requireAuth, reauthLimiter, async (req, res) => {
    const currentPassword = req.body?.currentPassword;
    if (typeof currentPassword !== 'string' || currentPassword.length > 1024
      || !(await verifyPassword(currentPassword, req.user.password_hash))) {
      return errorResponse(res, 400, 'INVALID_CURRENT_PASSWORD', 'Current password is incorrect.');
    }
    await revokeAllUserSessions(req.user.id);
    await audit(req, 'SESSIONS_REVOKED_ALL', {}, 'user', req.user.id);
    await clearSession(req, res);
    return res.json({ data: { success: true, message: 'All sessions were signed out.' } });
  });

  app.post('/api/auth/logout', requireAuth, async (req, res) => {
    await audit(req, 'LOGOUT');
    await clearSession(req, res);
    return res.json({ data: { success: true } });
  });

  app.post('/api/auth/password/change', requireAuth, reauthLimiter, async (req, res) => {
    const passwordError = validatePassword(req.body?.newPassword);
    if (passwordError) return errorResponse(res, 400, 'WEAK_PASSWORD', passwordError);
    const currentPassword = req.body?.currentPassword;
    if (typeof currentPassword !== 'string' || currentPassword.length > 1024
      || !(await verifyPassword(currentPassword, req.user.password_hash))) {
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

  app.post('/api/auth/password-reset/request', resetRequestLimiter, async (req, res) => {
    const identifier = req.body?.identifier;
    if (typeof identifier !== 'string' || identifier.length > 254) {
      return errorResponse(res, 400, 'VALIDATION_ERROR', 'Email/username is invalid.');
    }
    const user = await findUser(identifier);
    let challengeId = crypto.randomUUID();
    if (user?.status === 'active') challengeId = await createOtpChallenge(user, 'password_reset');
    await audit(req, 'PASSWORD_RESET_REQUESTED', { accountFound: Boolean(user) });
    return res.json({ data: { challengeId, message: 'If the account exists, a reset code was sent.' } });
  });

  app.post('/api/auth/password-reset/confirm', resetConfirmLimiter, async (req, res) => {
    if (typeof req.body?.password !== 'string' || req.body.password.length > 1024) {
      return errorResponse(res, 400, 'VALIDATION_ERROR', 'Password is invalid.');
    }
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
    const activationUrl = buildInvitationActivationUrl(rawToken);
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

  app.patch('/api/admin/users/:id/prc-license', requireRoles('system_administrator'), async (req, res) => {
    if (!validUuid(req.params.id)) return errorResponse(res, 400, 'INVALID_USER_ID', 'A valid user id is required.');
    const validation = validateNurseLicenseUpdate(req.body);
    if (!validation.valid) return errorResponse(res, 400, validation.code, validation.message);
    try {
      const updated = await transaction(async (client) => {
        const account = await recordNurseLicenseVerification(client, req.params.id, validation, req.user.id);
        await audit(req, 'NURSE_PRC_LICENSE_VERIFICATION_UPDATED', { verified: account.verified, cleared: !account.verified }, 'user', account.id, client);
        return account;
      });
      return res.json({ data: { user: { id: updated.id, role: updated.role, status: updated.status, prcLicenseVerified: updated.verified } } });
    } catch (error) {
      if (error.status) return errorResponse(res, error.status, error.code || 'LICENSE_UPDATE_FAILED', error.message);
      throw error;
    }
  });

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
    const activationUrl = buildInvitationActivationUrl(rawToken);
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
    if (!clinicalValidation.valid) return errorResponse(res, clinicalValidation.status || 400, clinicalValidation.code || 'VALIDATION_ERROR', clinicalValidation.message);
    const version = await saveClinicData(req.body?.data, req.user, req.body?.version);
    const after = await loadClinicData(req.user);
    for (const visit of newRecords(before.visits, after.visits)) {
      await notifyLinkedUsers(visit.studentId || visit.patientId, {
        type: 'clinic_visit',
        subject: 'Clinic visit recorded',
        body: `A clinic visit was recorded on ${visit.date || 'the current date'}${visit.time ? ` at ${visit.time}` : ''}.`,
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

  app.post('/api/patients/faculty', requireRoles('school_nurse'), async (req, res) => {
    const batch = normalizeImportRows('faculty', [req.body || {}]);
    const row = batch.normalizedRows?.[0];
    if (!row || row.errors.length) return errorResponse(res, 400, 'VALIDATION_ERROR', 'Review the faculty record fields.', { fields: row?.errors || [batch.message] });
    const id = crypto.randomUUID();
    const record = { ...row.record, id };
    try {
      await clinicDataTransaction(async (client) => {
        const duplicate = await client.query(
          "SELECT id FROM patients WHERE LOWER(COALESCE(data->>'studentId',data->>'facultyId',''))=LOWER($1) LIMIT 1",
          [record.facultyId],
        );
        if (duplicate.rowCount) {
          const error = new Error('A patient record already uses this faculty ID.');
          error.status = 409;
          error.code = 'DUPLICATE_RECORD';
          throw error;
        }
        await client.query('INSERT INTO patients(id,patient_type,data) VALUES($1,\'faculty\',$2::jsonb)', [id, JSON.stringify(record)]);
        await audit(req, 'FACULTY_PATIENT_CREATED', {}, 'patient', id, client);
      });
    } catch (error) {
      if (error.status) return errorResponse(res, error.status, error.code, error.message);
      throw error;
    }
    return res.status(201).json({ data: { patient: record } });
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
    if (assessment.status === 'incomplete' && !riskAllowsAcknowledgedIncomplete(assessment)) {
      return errorResponse(res, 400, 'RISK_INPUT_INCOMPLETE', assessment.rationale, { missingFields: assessment.missingFields });
    }
    if (riskNeedsNurseAcknowledgement(assessment) && !input.riskAcknowledgement) {
      const isHighRisk = assessment.category === 'high';
      return errorResponse(
        res,
        400,
        isHighRisk ? 'HIGH_RISK_ACKNOWLEDGEMENT_REQUIRED' : 'RISK_REVIEW_ACKNOWLEDGEMENT_REQUIRED',
        isHighRisk ? 'Document the nurse acknowledgement before saving a high-risk visit.' : 'Document the nurse review and action before saving this assessment.',
        { riskAcknowledgement: isHighRisk ? 'Required for high-risk results.' : 'Required for incomplete or review-required results.' },
      );
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
              [crypto.randomUUID(), visitId, Number(assessment.ruleVersion || 0), JSON.stringify(assessment), riskNeedsNurseAcknowledgement(assessment) ? req.user.id : null, riskNeedsNurseAcknowledgement(assessment) && Boolean(input.riskAcknowledgement), riskNeedsNurseAcknowledgement(assessment) ? (input.riskAcknowledgement || null) : null],
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
        body: `A ${input.visitType.toLowerCase()} clinic visit was recorded on ${visit.date}${visit.time ? ` at ${visit.time}` : ''}.`,
        dedupeKey: `visit:${visitId}`,
      });
    } catch (error) {
      console.error('Visit notification failed:', error.message);
    }
    return res.status(201).json({ data: { visit, assessment, summaryPendingApproval: Boolean(input.summaryDraft && !input.summaryApproved) } });
  });

  app.get('/api/risk/rules', requireRoles(...reportReadRoles), async (req, res) => {
    const result = await query('SELECT id,version,name,status,rules,approved_by,approved_at,created_at FROM risk_rules ORDER BY version DESC');
    const testActivationAvailable = process.env.NODE_ENV === 'development';
    const testActivation = await readTestRiskRuleActivation({ query });
    const currentUserLicenseVerified = Boolean(req.user.prc_license_number?.trim() && req.user.prc_license_verified_at && req.user.prc_license_verified_by);
    return res.json({ data: { rules: result.rows, demonstrationRules: getDemonstrationRules(), candidateRuleDraft: getConservativeCandidateRuleDraft(), testActivationAvailable, testActivation, currentUserLicenseVerified } });
  });

  app.post('/api/risk/rules/conservative-candidate', requireRoles('system_administrator'), async (req, res) => {
    let candidate;
    try {
      candidate = await transaction((client) => ensureConservativeCandidateDraft(client));
    } catch (error) {
      if (error.code !== '23505') throw error;
      try {
        candidate = await transaction((client) => ensureConservativeCandidateDraft(client));
      } catch (retryError) {
        if (retryError.code === '23505') return errorResponse(res, 409, 'VERSION_EXISTS', 'A rule version was created at the same time. Try again to create the next version.');
        throw retryError;
      }
    }
    if (candidate.created) await audit(req, 'RISK_RULE_CREATED', { version: candidate.version, status: candidate.status, candidate: 'conservative_triage_v1' }, 'risk_rule', candidate.id);
    return res.status(candidate.created ? 201 : 200).json({ data: candidate });
  });

  app.post('/api/risk/rules', requireRoles('system_administrator'), async (req, res) => {
    const version = Number(req.body?.version);
    const name = String(req.body?.name || '').trim();
    const rules = req.body?.rules;
    const status = 'draft';
    if (!Number.isInteger(version) || version < 1 || !name || !rules || !Array.isArray(rules.indicators) || !validateRiskRules(rules).valid) {
      return errorResponse(res, 400, 'VALIDATION_ERROR', 'Version, name, and a supported rule definition are required.');
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

  app.put('/api/risk/rules/:id/test-activation', requireRoles('school_nurse', 'system_administrator'), async (req, res) => {
    if (process.env.NODE_ENV !== 'development') return errorResponse(res, 404, 'NOT_FOUND', 'Test rule activation is only available in development.');
    if (!validUuid(req.params.id)) return errorResponse(res, 400, 'INVALID_RULE_ID', 'A valid risk rule id is required.');
    try {
      const result = await transaction(async (client) => {
        const activation = await activateRiskRuleForTesting(client, req.params.id);
        if (activation.changed) {
          await audit(req, 'RISK_RULE_TEST_ACTIVATED', { version: activation.rule.version, mode: 'conservative_triage_v1' }, 'risk_rule', activation.rule.id, client);
        }
        return activation;
      });
      return res.json({ data: { testActivation: result.activation, changed: result.changed } });
    } catch (error) {
      if (error.status) return errorResponse(res, error.status, error.code || 'TEST_ACTIVATION_FAILED', error.message);
      throw error;
    }
  });

  app.delete('/api/risk/rules/test-activation', requireRoles('school_nurse', 'system_administrator'), async (req, res) => {
    if (process.env.NODE_ENV !== 'development') return errorResponse(res, 404, 'NOT_FOUND', 'Test rule activation is only available in development.');
    try {
      const result = await transaction(async (client) => {
        const disabled = await disableRiskRuleTesting(client);
        if (disabled.changed) {
          await audit(req, 'RISK_RULE_TEST_ACTIVATION_DISABLED', {}, 'risk_rule', disabled.ruleId, client);
        }
        return disabled;
      });
      return res.json({ data: { testActivation: null, changed: result.changed } });
    } catch (error) {
      if (error.status) return errorResponse(res, error.status, error.code || 'TEST_ACTIVATION_FAILED', error.message);
      throw error;
    }
  });

  app.patch('/api/risk/rules/:id/approve', requireRoles('school_nurse'), async (req, res) => {
    if (!String(req.user.prc_license_number || '').trim() || !req.user.prc_license_verified_at || !req.user.prc_license_verified_by) {
      return errorResponse(res, 403, 'LICENSE_REQUIRED', 'A school nurse with an administrator-recorded, verified PRC license is required to approve risk rules.');
    }
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
    if (riskNeedsNurseAcknowledgement(result.rows[0].result) && !reason) return errorResponse(res, 400, 'OVERRIDE_REASON_REQUIRED', 'Document the nurse review and action for this result.');
    await query('UPDATE risk_assessments SET acknowledged_by=$1,acknowledged_at=NOW(),override_reason=$2 WHERE id=$3', [req.user.id, reason || null, req.params.id]);
    await audit(req, 'RISK_ASSESSMENT_ACKNOWLEDGED', { overrideReason: reason }, 'risk_assessment', req.params.id);
    return res.json({ data: { success: true } });
  });

  app.all('/api/queue', (_req, res) => errorResponse(res, 410, 'FEATURE_REMOVED', 'The walk-in queue feature is no longer available. Begin a visit or use appointments.'));
  app.all('/api/queue/:id', (_req, res) => errorResponse(res, 410, 'FEATURE_REMOVED', 'The walk-in queue feature is no longer available. Begin a visit or use appointments.'));

  const previewImport = (type) => async (req, res) => {
    const preview = await inspectImportRows(type, req.body?.rows);
    if (!preview.validType) return errorResponse(res, 404, 'IMPORT_TYPE_UNSUPPORTED', preview.message);
    if (preview.invalidBatch) return errorResponse(res, 400, 'VALIDATION_ERROR', preview.message);
    return res.json({ data: { rows: preview.normalizedRows } });
  };

  const commitImport = (type) => async (req, res) => {
    const rows = req.body?.rows;
    const selectedIndices = req.body?.selectedIndices;
    let result;
    try {
      result = await clinicDataTransaction(async (client) => {
        const preview = await inspectImportRows(type, rows, client);
        if (!preview.validType || preview.invalidBatch) {
          const error = new Error(preview.message || 'The import batch is invalid.');
          error.status = 400;
          error.code = 'VALIDATION_ERROR';
          throw error;
        }
        const selection = selectedImportRows(preview.normalizedRows, selectedIndices);
        if (!selection.valid) {
          const error = new Error(selection.message);
          error.status = selection.code === 'DUPLICATE_RECORD' ? 409 : 400;
          error.code = selection.code || 'VALIDATION_ERROR';
          error.fields = { rows: selection.rows || [] };
          throw error;
        }

        const batchId = crypto.randomUUID();
        await client.query('INSERT INTO import_batches(id,import_type,created_by) VALUES($1,$2,$3)', [batchId, type, req.user.id]);
        for (const row of selection.selected) {
          const id = crypto.randomUUID();
          if (type === 'students' || type === 'faculty') {
            const record = { ...row.record, id };
            await client.query(
              'INSERT INTO patients(id,patient_type,data) VALUES($1,$2,$3::jsonb)',
              [id, type === 'faculty' ? 'faculty' : 'student', JSON.stringify(record)],
            );
            await client.query(
              `INSERT INTO import_batch_items(batch_id,entity_type,entity_id,original_data_hash)
               SELECT $1,'patient',$2,md5(data::text) FROM patients WHERE id=$2`,
              [batchId, id],
            );
          } else {
            const record = {
              ...row.record,
              id,
              studentId: row.patientId,
              patientId: row.patientId,
              historicalImport: true,
              riskAssessment: null,
            };
            await client.query(
              'INSERT INTO visits(id,patient_id,data,created_by) VALUES($1,$2,$3::jsonb,$4)',
              [id, row.patientId, JSON.stringify(record), req.user.id],
            );
            await client.query(
              `INSERT INTO import_batch_items(batch_id,entity_type,entity_id,original_data_hash)
               SELECT $1,'visit',$2,md5(data::text) FROM visits WHERE id=$2`,
              [batchId, id],
            );
          }
        }
        const imported = selection.selected.length;
        const action = type === 'visits' ? 'HISTORICAL_VISITS_IMPORTED' : `${type.toUpperCase()}_IMPORTED`;
        await audit(req, action, { batchId, imported, skipped: rows.length - imported }, `${type}_import`, batchId, client);
        return { batchId, imported, skipped: rows.length - imported };
      });
    } catch (error) {
      if (error.status) return errorResponse(res, error.status, error.code || 'IMPORT_FAILED', error.message, error.fields);
      throw error;
    }
    return res.status(201).json({ data: result });
  };

  app.post('/api/import/students/preview', requireRoles('system_administrator'), previewImport('students'));
  app.post('/api/import/students', requireRoles('system_administrator'), commitImport('students'));
  app.post('/api/import/faculty/preview', requireRoles('school_nurse', 'system_administrator'), previewImport('faculty'));
  app.post('/api/import/faculty', requireRoles('school_nurse', 'system_administrator'), commitImport('faculty'));
  app.post('/api/import/visits/preview', requireRoles(...clinicalWriteRoles), previewImport('visits'));
  app.post('/api/import/visits', requireRoles(...clinicalWriteRoles), commitImport('visits'));

  app.post('/api/import/batches/:id/rollback', requireRoles('school_nurse', 'system_administrator'), async (req, res) => {
    const batchId = String(req.params.id || '');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(batchId)) return errorResponse(res, 400, 'INVALID_BATCH_ID', 'A valid import batch ID is required.');
    let result;
    try {
      result = await clinicDataTransaction(async (client) => {
        const batch = await client.query('SELECT id,import_type,rolled_back_at FROM import_batches WHERE id=$1 FOR UPDATE', [batchId]);
        if (!batch.rowCount) {
          const error = new Error('Import batch not found.');
          error.status = 404;
          error.code = 'IMPORT_BATCH_NOT_FOUND';
          throw error;
        }
        const { import_type: type, rolled_back_at: rolledBackAt } = batch.rows[0];
        if (!canRollbackImport(req.user.role, type)) {
          const error = new Error('This account cannot roll back that import type.');
          error.status = 403;
          error.code = 'FORBIDDEN';
          throw error;
        }
        if (rolledBackAt) {
          const error = new Error('This import batch has already been rolled back.');
          error.status = 409;
          error.code = 'IMPORT_ALREADY_ROLLED_BACK';
          throw error;
        }
        const items = await client.query('SELECT entity_type,entity_id,original_data_hash FROM import_batch_items WHERE batch_id=$1 ORDER BY entity_type,entity_id', [batchId]);
        if (!items.rowCount) {
          const error = new Error('This import batch has no records to roll back.');
          error.status = 409;
          error.code = 'IMPORT_BATCH_EMPTY';
          throw error;
        }
        for (const item of items.rows) {
          if (item.entity_type === 'visit') {
            const visit = await client.query(
              `SELECT md5(data::text) AS current_hash,
                EXISTS(SELECT 1 FROM dispense_logs WHERE visit_id=visits.id) AS has_dispensations,
                EXISTS(SELECT 1 FROM risk_assessments WHERE visit_id=visits.id) AS has_risk_assessment
               FROM visits WHERE id=$1 FOR UPDATE`,
              [item.entity_id],
            );
            if (!visit.rowCount || visit.rows[0].current_hash !== item.original_data_hash || visit.rows[0].has_dispensations || visit.rows[0].has_risk_assessment) {
              const error = new Error('Rollback stopped because an imported visit was edited or linked clinic activity depends on it. No rows were removed.');
              error.status = 409;
              error.code = 'IMPORT_ROLLBACK_CONFLICT';
              throw error;
            }
          } else {
            const patient = await client.query(
              `SELECT md5(p.data::text) AS current_hash,
                p.user_id IS NOT NULL AS has_user,
                EXISTS(SELECT 1 FROM guardian_patient_links WHERE patient_id=p.id) AS has_guardians,
                EXISTS(SELECT 1 FROM invitations WHERE patient_id=p.id) AS has_invitations,
                EXISTS(SELECT 1 FROM visits WHERE patient_id=p.id)
                  OR EXISTS(SELECT 1 FROM screenings WHERE patient_id=p.id)
                  OR EXISTS(SELECT 1 FROM immunizations WHERE patient_id=p.id)
                  OR EXISTS(SELECT 1 FROM incidents WHERE patient_id=p.id)
                  OR EXISTS(SELECT 1 FROM appointments WHERE patient_id=p.id)
                  OR EXISTS(SELECT 1 FROM queue_entries WHERE patient_id=p.id) AS has_clinic_activity
               FROM patients p WHERE p.id=$1 FOR UPDATE`,
              [item.entity_id],
            );
            if (!patient.rowCount || patient.rows[0].current_hash !== item.original_data_hash || patient.rows[0].has_user || patient.rows[0].has_guardians || patient.rows[0].has_invitations || patient.rows[0].has_clinic_activity) {
              const error = new Error('Rollback stopped because an imported patient was edited, linked to an account, or has clinic activity. No rows were removed.');
              error.status = 409;
              error.code = 'IMPORT_ROLLBACK_CONFLICT';
              throw error;
            }
          }
        }
        const visits = items.rows.filter((item) => item.entity_type === 'visit');
        const patients = items.rows.filter((item) => item.entity_type === 'patient');
        for (const item of visits) await client.query('DELETE FROM visits WHERE id=$1', [item.entity_id]);
        for (const item of patients) await client.query('DELETE FROM patients WHERE id=$1', [item.entity_id]);
        await client.query('UPDATE import_batches SET rolled_back_at=NOW() WHERE id=$1', [batchId]);
        await audit(req, 'IMPORT_BATCH_ROLLED_BACK', { batchId, deleted: items.rowCount }, 'import_batch', batchId, client);
        return { batchId, deleted: items.rowCount };
      });
    } catch (error) {
      if (error.status) return errorResponse(res, error.status, error.code || 'IMPORT_ROLLBACK_FAILED', error.message);
      throw error;
    }
    return res.json({ data: result });
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
    return res.status(201).json({ data: { id, source: 'manual', ...visibleReport(report, req.user) } });
  });

  app.get('/api/reports/snapshots', requireRoles(...reportReadRoles), async (req, res) => {
    const result = await query('SELECT id,report_type,period_start,period_end,source,data,created_at FROM report_snapshots ORDER BY created_at DESC LIMIT 100');
    return res.json({ data: { snapshots: result.rows.map((snapshot) => ({ ...snapshot, data: visibleReport(reportSnapshotForStorage(snapshot.data || {}), req.user) })) } });
  });

  app.get('/api/notifications', requireAuth, async (req, res) => {
    const result = await query("SELECT * FROM notifications WHERE user_id=$1 AND type NOT IN ('immunization','immunization_reminder') ORDER BY created_at DESC LIMIT 100", [req.user.id]);
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
