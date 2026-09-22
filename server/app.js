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
import { assessRisk, getDemonstrationRules } from './domain/risk.js';
import { buildClinicReport } from './domain/reporting.js';
import { summarizeEncounter } from './ai.js';
import { linkUserToPatient, listUsers, loadClinicData, saveClinicData } from './repository.js';

const currentDir = dirname(fileURLToPath(import.meta.url));
const distDir = join(currentDir, '..', 'dist');
const allowedRoles = new Set(['student', 'guardian', 'school_nurse', 'system_administrator']);
const staffRoles = ['school_nurse', 'system_administrator'];

function errorResponse(res, status, code, message, fields) {
  return res.status(status).json({ error: { code, message, ...(fields ? { fields } : {}) } });
}

function allowedOrigins() {
  return [process.env.APP_URL, process.env.DEV_APP_URL || 'http://localhost:5173'].filter(Boolean);
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

function newRecords(before = [], after = []) {
  const existing = new Set(before.map((record) => String(record.id)));
  return after.filter((record) => !existing.has(String(record.id)));
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
    return res.json({ data: { logs: result.rows } });
  });

  app.get('/api/data', requireAuth, async (req, res) => res.json({ data: await loadClinicData(req.user) }));

  app.put('/api/data', requireRoles(...staffRoles), async (req, res) => {
    const before = await loadClinicData(req.user);
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
        body: `A clinic appointment is ${appointment.status || 'pending'} for ${appointment.date || appointment.startsAt || 'the selected schedule'}.`,
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

  app.post('/api/risk/assess', requireRoles(...staffRoles), async (req, res) => {
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

  app.get('/api/risk/rules', requireRoles(...staffRoles), async (_req, res) => {
    const result = await query('SELECT id,version,name,status,rules,approved_by,approved_at,created_at FROM risk_rules ORDER BY version DESC');
    return res.json({ data: { rules: result.rows, demonstrationRules: getDemonstrationRules() } });
  });

  app.post('/api/risk/rules', requireRoles('system_administrator'), async (req, res) => {
    const version = Number(req.body?.version);
    const name = String(req.body?.name || '').trim();
    const rules = req.body?.rules;
    const status = req.body?.status === 'clinician_approved' ? 'clinician_approved' : 'draft';
    const approvedBy = String(req.body?.approvedBy || '').trim();
    if (!Number.isInteger(version) || version < 1 || !name || !rules || !Array.isArray(rules.indicators)) {
      return errorResponse(res, 400, 'VALIDATION_ERROR', 'Version, name, thresholds, and indicators are required.');
    }
    if (status === 'clinician_approved' && !approvedBy) return errorResponse(res, 400, 'CLINICIAN_APPROVAL_REQUIRED', 'Record the licensed clinician who approved these rules.');
    const id = crypto.randomUUID();
    try {
      await query(
        `INSERT INTO risk_rules(id,version,name,rules,status,approved_by,approved_at)
         VALUES($1,$2,$3,$4::jsonb,$5,$6,CASE WHEN $5='clinician_approved' THEN NOW() ELSE NULL END)`,
        [id, version, name, JSON.stringify(rules), status, approvedBy || null],
      );
    } catch (error) {
      if (error.code === '23505') return errorResponse(res, 409, 'VERSION_EXISTS', 'That risk-rule version already exists.');
      throw error;
    }
    await audit(req, 'RISK_RULE_CREATED', { version, status, approvedBy }, 'risk_rule', id);
    return res.status(201).json({ data: { id, version, status } });
  });

  app.patch('/api/risk/assessments/:id/acknowledge', requireRoles(...staffRoles), async (req, res) => {
    const reason = String(req.body?.overrideReason || '').trim();
    const result = await query('SELECT result FROM risk_assessments WHERE id=$1', [req.params.id]);
    if (!result.rowCount) return errorResponse(res, 404, 'NOT_FOUND', 'Risk assessment not found.');
    if (result.rows[0].result?.category === 'high' && !reason) return errorResponse(res, 400, 'OVERRIDE_REASON_REQUIRED', 'Document the acknowledgement or override reason for a high-risk result.');
    await query('UPDATE risk_assessments SET acknowledged_by=$1,acknowledged_at=NOW(),override_reason=$2 WHERE id=$3', [req.user.id, reason || null, req.params.id]);
    await audit(req, 'RISK_ASSESSMENT_ACKNOWLEDGED', { overrideReason: reason }, 'risk_assessment', req.params.id);
    return res.json({ data: { success: true } });
  });

  app.post('/api/visits/:id/summary', requireRoles(...staffRoles), async (req, res) => {
    const visitResult = await query('SELECT data FROM visits WHERE id=$1', [req.params.id]);
    if (!visitResult.rowCount) return errorResponse(res, 404, 'NOT_FOUND', 'Visit not found.');
    const summary = await summarizeEncounter(visitResult.rows[0].data);
    await audit(req, 'CONSULTATION_SUMMARY_DRAFTED', { provider: summary.provider }, 'visit', req.params.id);
    return res.json({ data: { ...summary, requiresNurseApproval: true } });
  });

  app.post('/api/summaries/draft', requireRoles(...staffRoles), async (req, res) => {
    const summary = await summarizeEncounter(req.body || {});
    await audit(req, 'CONSULTATION_SUMMARY_DRAFTED', { provider: summary.provider });
    return res.json({ data: { ...summary, requiresNurseApproval: true } });
  });

  app.get('/api/reports', requireRoles(...staffRoles), async (req, res) => {
    const end = String(req.query.end || new Date().toISOString().slice(0, 10));
    const start = String(req.query.start || end);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) return errorResponse(res, 400, 'INVALID_PERIOD', 'Provide a valid report date range.');
    return res.json({ data: buildClinicReport(await loadClinicData(req.user), start, end) });
  });

  app.post('/api/reports/snapshots', requireRoles(...staffRoles), async (req, res) => {
    const { start, end, type = 'custom' } = req.body || {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(start || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(end || '')) || start > end) {
      return errorResponse(res, 400, 'INVALID_PERIOD', 'Provide a valid report date range.');
    }
    if (!['daily', 'weekly', 'monthly', 'custom'].includes(type)) return errorResponse(res, 400, 'INVALID_REPORT_TYPE', 'Invalid report type.');
    const report = buildClinicReport(await loadClinicData(req.user), start, end);
    const id = crypto.randomUUID();
    await query(
      'INSERT INTO report_snapshots(id,report_type,period_start,period_end,data,created_by) VALUES($1,$2,$3,$4,$5::jsonb,$6)',
      [id, type, start, end, JSON.stringify(report), req.user.id],
    );
    await audit(req, 'REPORT_SNAPSHOT_CREATED', { type, start, end }, 'report', id);
    return res.status(201).json({ data: { id, ...report } });
  });

  app.get('/api/reports/snapshots', requireRoles(...staffRoles), async (_req, res) => {
    const result = await query('SELECT id,report_type,period_start,period_end,data,created_at FROM report_snapshots ORDER BY created_at DESC LIMIT 100');
    return res.json({ data: { snapshots: result.rows } });
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

  app.post('/api/appointments', requireAuth, async (req, res) => {
    const patientId = String(req.body?.patientId || '');
    const startsAt = new Date(req.body?.startsAt);
    const reason = String(req.body?.reason || '').trim().slice(0, 500);
    if (!patientId || Number.isNaN(startsAt.getTime()) || !reason) return errorResponse(res, 400, 'VALIDATION_ERROR', 'Patient, appointment time, and reason are required.');
    if (startsAt.getTime() <= Date.now()) return errorResponse(res, 400, 'PAST_APPOINTMENT', 'Choose a future appointment time.');
    if (!(await canAccessPatient(req.user, patientId))) return errorResponse(res, 403, 'FORBIDDEN', 'You cannot book for this patient.');
    const id = crypto.randomUUID();
    try {
      await transaction(async (client) => {
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
      body: `A clinic appointment request was recorded for ${startsAt.toLocaleString()}.`,
      dedupeKey: `appointment:${id}`,
    });
    return res.status(201).json({ data: { id } });
  });

  app.patch('/api/appointments/:id', requireRoles(...staffRoles), async (req, res) => {
    const current = await query('SELECT * FROM appointments WHERE id=$1', [req.params.id]);
    if (!current.rowCount) return errorResponse(res, 404, 'NOT_FOUND', 'Appointment not found.');
    const status = String(req.body?.status || current.rows[0].status);
    if (!['Requested', 'Scheduled', 'Completed', 'Cancelled', 'Rejected'].includes(status)) return errorResponse(res, 400, 'INVALID_STATUS', 'Invalid appointment status.');
    const startsAt = req.body?.startsAt ? new Date(req.body.startsAt) : new Date(current.rows[0].starts_at);
    if (Number.isNaN(startsAt.getTime())) return errorResponse(res, 400, 'INVALID_DATE', 'A valid appointment date is required.');
    if (req.body?.startsAt && startsAt.getTime() <= Date.now()) return errorResponse(res, 400, 'PAST_APPOINTMENT', 'Choose a future appointment time.');
    const record = { ...current.rows[0].data, startsAt: startsAt.toISOString(), status };
    try {
      await transaction(async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [startsAt.toISOString()]);
        if (!['Cancelled', 'Rejected'].includes(status)) {
          const conflict = await client.query(
            "SELECT 1 FROM appointments WHERE starts_at=$1 AND id<>$2 AND status NOT IN ('Cancelled','Rejected') LIMIT 1",
            [startsAt, req.params.id],
          );
          if (conflict.rowCount) {
            const error = new Error('That appointment time is no longer available.');
            error.status = 409;
            throw error;
          }
        }
        await client.query('UPDATE appointments SET starts_at=$1,status=$2,data=$3::jsonb,updated_at=NOW() WHERE id=$4', [startsAt, status, JSON.stringify(record), req.params.id]);
      });
    } catch (error) {
      if (error.status === 409) return errorResponse(res, 409, 'APPOINTMENT_CONFLICT', error.message);
      throw error;
    }
    await notifyLinkedUsers(current.rows[0].patient_id, {
      type: 'appointment',
      subject: 'Clinic appointment updated',
      body: `Your clinic appointment is now ${status.toLowerCase()} for ${startsAt.toLocaleString()}.`,
      dedupeKey: `appointment-update:${req.params.id}:${status}:${startsAt.toISOString()}`,
    });
    await audit(req, 'APPOINTMENT_UPDATED', { status, startsAt: startsAt.toISOString() }, 'appointment', req.params.id);
    return res.json({ data: { appointment: record } });
  });

  app.post('/api/admin/notifications/broadcast', requireRoles('system_administrator'), async (req, res) => {
    const subject = String(req.body?.subject || '').trim().slice(0, 160);
    const body = String(req.body?.body || '').trim().slice(0, 2000);
    const roles = Array.isArray(req.body?.roles) ? req.body.roles.filter((role) => allowedRoles.has(role)) : [...allowedRoles];
    const type = ['announcement', 'emergency', 'consent_reminder'].includes(req.body?.type) ? req.body.type : 'announcement';
    if (!subject || !body || !roles.length) return errorResponse(res, 400, 'VALIDATION_ERROR', 'Subject, message, and at least one role are required.');
    const recipients = await query("SELECT id,email,name FROM users WHERE status='active' AND role=ANY($1::text[])", [roles]);
    const batchId = crypto.randomUUID();
    for (const recipient of recipients.rows) {
      await createNotification({ userId: recipient.id, type, subject, body, dedupeKey: `broadcast:${batchId}:in-app:${recipient.id}` });
      const emailNotice = await createNotification({ userId: recipient.id, channel: 'email', type, subject, body, dedupeKey: `broadcast:${batchId}:email:${recipient.id}` });
      try {
        await sendEmail({ to: recipient.email, subject, text: body, html: `<p>Hello ${escapeHtml(recipient.name)},</p><p>${escapeHtml(body)}</p>` });
        await query("UPDATE notifications SET status='sent',sent_at=NOW() WHERE id=$1", [emailNotice.id]);
      } catch {
        await query("UPDATE notifications SET status='failed' WHERE id=$1", [emailNotice.id]);
      }
    }
    await audit(req, 'NOTIFICATION_BROADCAST', { type, roles, recipientCount: recipients.rowCount }, 'notification_batch', batchId);
    return res.status(201).json({ data: { batchId, recipientCount: recipients.rowCount } });
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
