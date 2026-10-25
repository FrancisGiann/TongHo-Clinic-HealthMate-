import { invitationEmail, notificationEmail } from './emailTemplates.js';
import crypto from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { indexingHeaders, serveApplicationHtml } from './seo.js';
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
  passwordResetChallenge,
  recordFailedLogin,
  revokeAllUserSessions,
  revokeUserSession,
  requireAuth,
  requireRoles,
  validEmail,
  validatePassword,
  verifyPassword,
} from './auth.js';
import { emailConfigured, sendEmail } from './email.js';
import { approveDraftRiskRule, assessRisk, createRiskRuleDraft, ensureConservativeCandidateDraft, getConservativeCandidateRuleDraft, getDemonstrationRules, riskAllowsAcknowledgedIncomplete, riskNeedsNurseAcknowledgement, selectRiskRules, validateRiskRules } from './domain/risk.js';
import { buildClinicReport, reportForRole, reportSnapshotForStorage } from './domain/reporting.js';
import { applyStockAdjustment, validateInventoryArchive, validateInventoryItem, validateStockAdjustment } from './domain/inventory.js';
import { persistVisitAndDispensations, resolveInventoryDispensations } from './domain/dispensing.js';
import { validateChangedClinicalRecords } from './domain/clinical-records.js';
import { assertCurrentBrandingVersion, BRANDING_SLOT_NAMES, projectBrandingAssets } from './domain/branding.js';
import { assertCurrentLandingContentVersion, projectAdminLandingContent, projectPublicLandingContent, validateLandingContent } from './domain/landingContent.js';
import { sanitizeAuditLogs } from './domain/audit.js';
import { summarizeEncounter } from './ai.js';
import { clinicCalendarDate, validateVisitPayload, visitRiskInput } from './domain/visit.js';
import { appointmentRowsOverlappingPeriod, appointmentSettings, clinicDateTime, generateAppointmentSlots, isAppointmentTransitionAllowed, isValidAppointmentDate, normalizeAppointmentStatus, rankAppointmentSlots, sortedManilaDayLockKeys, unavailablePeriodsForSlot, validateUnavailablePeriod } from './domain/scheduling.js';
import { clinicalWriteRoles, reportReadRoles } from './domain/authorization.js';
import { broadcastBatchId, validateBroadcastPayload, validateConsentUpdate } from './domain/communications.js';
import { clinicDataTransaction, linkUserToPatient, listUsers, loadClinicData, loadNurseDashboardData, saveClinicData, validateVersionAfterAdvance } from './repository.js';
import { runClinicReminderSweep } from './reminders.js';
import { canRollbackImport, normalizeImportRows, selectedImportRows } from './domain/imports.js';
import { patientRosterIdentitySql, rosterIdTrimCharacters } from './domain/roster.js';
import { ensureSameOrigin, loginOtpRequired, rateLimit, requestOriginAllowed, trustProxyHops } from './security.js';
import { buildInvitationActivationUrl, buildSignInUrl } from './invitationUrl.js';
import { recordNurseLicenseVerification, validateNurseLicenseUpdate } from './domain/nurseLicense.js';
import { acceptedProfileFields, normalizeDocumentReceiptStatus, normalizeHealthRecordAnswers, validatePaperSignatureForAcceptance } from './domain/health-records.js';
import { persistHealthRecordStatusNotifications } from './domain/healthRecordNotifications.js';
import { clinicArrivalNotice, clinicVisitCareSummary, notificationDeliveryCounts, recordClinicArrival, validateClinicArrivalPayload } from './domain/clinicArrivals.js';
import { listInAppNotifications, markInAppNotificationRead } from './domain/notifications.js';
import { createOrReplayVisitRequest, findVisitRequest, publicVisitRecord, validVisitRequestId, visitRequestFingerprint } from './domain/visitRequests.js';
import { activateInvitedAccount, changeAccountStatus, renewPendingInvitation } from './domain/account-access.js';
import { guardianSignupAcceptedResponse, resolveGuardianStudentMatch, validateGuardianSignup, validGuardianSignupMetadata } from './domain/guardianSignup.js';
import { buildAuditPageQuery, formatAuditPage, validateAuditPageQuery } from './domain/auditPagination.js';
import { normalizeDashboardPreferences, validateDashboardPreferences } from './domain/dashboardPreferences.js';
import { patientSummaryForRange, validateSummaryRange } from './domain/patientSummary.js';
import { guardianSignupDecisionEmail, publicGuardianSignupRequest, validateGuardianSignupDecisionReason, validateGuardianSignupPageQuery } from './domain/guardianSignupApproval.js';
import { validateBrandingSlot, validateRasterImageBase64 } from './domain/imageValidation.js';
import { INCIDENT_PHOTO_NOTICE_VERSION, incidentPhotoReadable, incidentPhotosEnabled, projectIncident, validateIncidentPayload, validateIncidentPhotoDecision } from './domain/incidents.js';
import { privateStorageFromEnvironment } from './storage/supabasePrivateStorage.js';

const currentDir = dirname(fileURLToPath(import.meta.url));
const distDir = join(currentDir, '..', 'dist');
const allowedRoles = new Set(['guardian', 'school_nurse', 'system_administrator']);
const staffRoles = reportReadRoles;

function errorResponse(res, status, code, message, fields) {
  return res.status(status).json({ error: { code, message, ...(fields ? { fields } : {}) } });
}

function setImageStreamSecurityHeaders(_req, res, next) {
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
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
  if (user.role !== 'guardian') return false;
  const result = await query(
    `SELECT 1 FROM guardian_patient_links l JOIN patients p ON p.id=l.patient_id
     WHERE l.guardian_user_id=$1 AND l.patient_id=$2 AND p.patient_type='student'`,
    [user.id, String(patientId)],
  );
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
     WHERE u.status='active' AND u.role='guardian'
       AND u.id IN (SELECT guardian_user_id FROM guardian_patient_links WHERE patient_id=$1)`,
    [String(patientId)],
  );
  const statuses = [];
  for (const user of users.rows) {
    await createNotification({ userId: user.id, type, subject, body, dedupeKey: `${dedupeKey}:in-app:${user.id}`, metadata: { patientId: String(patientId) } });
    const emailDedupeKey = `${dedupeKey}:email:${user.id}`;
    const emailNotification = await createNotification({ userId: user.id, channel: 'email', type, subject, body, dedupeKey: emailDedupeKey, metadata: { patientId: String(patientId) } });
    if (!emailNotification) {
      const existing = await query('SELECT status FROM notifications WHERE dedupe_key=$1', [emailDedupeKey]);
      statuses.push(existing.rows[0]?.status || 'unknown');
      continue;
    }
    try {
      await sendEmail({
        to: user.email,
        ...notificationEmail({ name: user.name, subject, body, authorizedDetails: true }),
      });
      statuses.push('sent');
      try {
        await query("UPDATE notifications SET status='sent',sent_at=NOW() WHERE id=$1", [emailNotification.id]);
      } catch (error) {
        console.error('Email status update failed:', error.message);
      }
    } catch (error) {
      statuses.push('failed');
      try {
        await query("UPDATE notifications SET status='failed' WHERE id=$1", [emailNotification.id]);
      } catch (statusError) {
        console.error('Email failure status update failed:', statusError.message);
      }
    }
  }
  return notificationDeliveryCounts(statuses, users.rows.length);
}

async function deliverHealthRecordStatusNotice(notification) {
  if (!notification) return;
  try {
    await notifyLinkedUsers(notification.patientId, {
      type: notification.type,
      subject: notification.subject,
      body: notification.body,
      dedupeKey: notification.dedupeKey,
    });
  } catch (error) {
    console.error('Health record notification delivery failed:', error.message);
  }
}

async function notificationDeliveryForDedupe(dedupeKey, patientId) {
  const result = await query(
    'SELECT user_id,channel,status FROM notifications WHERE dedupe_key LIKE $1',
    [`${dedupeKey}:%`],
  );
  const recipients = new Set(result.rows.filter((row) => row.channel === 'in_app').map((row) => String(row.user_id)));
  const emailRows = new Map(result.rows.filter((row) => row.channel === 'email').map((row) => [String(row.user_id), row.status]));
  for (const userId of emailRows.keys()) recipients.add(userId);
  if (!recipients.size) {
    const activeRecipients = await query(
      `SELECT COUNT(DISTINCT u.id)::int AS count FROM users u
       WHERE u.status='active' AND u.role='guardian'
         AND u.id IN (SELECT guardian_user_id FROM guardian_patient_links WHERE patient_id=$1)`,
      [String(patientId)],
    );
    const count = Number(activeRecipients.rows[0]?.count || 0);
    if (count > 0) return { recipientCount: count, emailSentCount: 0, emailFailedCount: 0, emailPendingCount: count, deliveryPending: true, deliveryUnavailable: true };
  }
  return notificationDeliveryCounts([...recipients].map((userId) => emailRows.get(userId) || 'unknown'), recipients.size);
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
        `SELECT id FROM patients WHERE LOWER(${patientRosterIdentitySql(2)})=LOWER(BTRIM($1,$2)) LIMIT 1`,
        [identifier, rosterIdTrimCharacters],
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

export function createApp({
  storage: storageAdapter = privateStorageFromEnvironment(),
  queryFn = query,
  transactionFn = transaction,
  clinicDataTransactionFn = clinicDataTransaction,
} = {}) {
  const app = express();
  const storage = storageAdapter;
  const query = queryFn;
  const transaction = transactionFn;
  const clinicDataTransaction = clinicDataTransactionFn;
  app.disable('x-powered-by');
  app.use(indexingHeaders);
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
  app.use('/api/admin/branding', express.json({ limit: '2mb' }));
  app.use('/api/admin/landing-content', express.json({ limit: '128kb' }));
  app.use('/api/incidents', express.json({ limit: '5mb' }));
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
  const guardianSignupRequestLimiter = rateLimit({ limit: 20, windowMs: 15 * 60 * 1000 });
  const guardianSignupVerifyLimiter = rateLimit({ limit: 60, windowMs: 15 * 60 * 1000 });
  const activationLimiter = rateLimit({ limit: 20, windowMs: 15 * 60 * 1000 });
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
    if (!user) {
      const pending = await query(
        `SELECT password_hash FROM guardian_signup_requests
         WHERE status='pending_review' AND (LOWER(email)=$1 OR LOWER(username)=$1) LIMIT 1`,
        [identifier],
      );
      if (pending.rowCount && await verifyPassword(password, pending.rows[0].password_hash)) {
        await clearFailedLogin(failureKey, identifier);
        return errorResponse(res, 403, 'GUARDIAN_REQUEST_PENDING', 'Your email is verified and your guardian account request is awaiting administrator review. You can sign in after approval.');
      }
    }
    if (!user || !valid) {
      const attemptsRemaining = await recordFailedLogin(failureKey);
      await audit(req, 'LOGIN_FAILED', { identifier, attemptsRemaining });
      return errorResponse(res, 401, 'INVALID_CREDENTIALS', 'Invalid credentials.');
    }
    await clearFailedLogin(failureKey, identifier);
    if (user.status !== 'active' || user.role === 'student') return errorResponse(res, 403, 'ACCOUNT_INACTIVE', 'This account is not active. Contact an administrator.');
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
    const result = await query("SELECT * FROM users WHERE id=$1 AND status='active' AND role<>'student'", [challenge.user_id]);
    const user = result.rows[0];
    if (!user) return errorResponse(res, 403, 'ACCOUNT_INACTIVE', 'This account is not active.');
    await issueSession(req, res, user, Boolean(challenge.metadata?.remember));
    await query('UPDATE users SET last_login_at=NOW() WHERE id=$1', [user.id]);
    req.user = user;
    await audit(req, 'LOGIN_SUCCESS', { mfa: true });
    return res.json({ data: { user: publicUser(user) } });
  });

  app.get('/api/auth/me', requireAuth, (req, res) => res.json({ data: { user: publicUser(req.user) } }));

  app.get('/api/landing-content', async (_req, res) => {
    try {
      const result = await query('SELECT published_content FROM branding_settings WHERE id=1');
      return res.json({ data: projectPublicLandingContent(result.rows[0]?.published_content, new Date()) });
    } catch {
      return errorResponse(res, 503, 'LANDING_CONTENT_UNAVAILABLE', 'Published landing-page content is temporarily unavailable.');
    }
  });

  app.get('/api/admin/landing-content', requireRoles('system_administrator'), async (_req, res) => {
    try {
      const result = await query('SELECT content_version,draft_content,published_content,draft_updated_at,published_at FROM branding_settings WHERE id=1');
      return res.json({ data: projectAdminLandingContent(result.rows[0]) });
    } catch {
      return errorResponse(res, 503, 'LANDING_CONTENT_UNAVAILABLE', 'Landing-page content could not be loaded.');
    }
  });

  app.put('/api/admin/landing-content/draft', requireRoles('system_administrator'), async (req, res) => {
    if (!Number.isSafeInteger(req.body?.version) || req.body.version < 1) {
      return errorResponse(res, 400, 'INVALID_VERSION', 'A current landing-page content version is required.');
    }
    const validation = validateLandingContent(req.body?.content);
    if (!validation.valid) {
      return errorResponse(res, 400, 'LANDING_CONTENT_INVALID', 'Review the landing-page content fields and try again.', validation.errors);
    }
    try {
      const row = await transaction(async (client) => {
        const current = await client.query('SELECT content_version FROM branding_settings WHERE id=1 FOR UPDATE');
        assertCurrentLandingContentVersion(current.rows[0]?.content_version || 1, req.body.version);
        const saved = await client.query(
          `UPDATE branding_settings
           SET draft_content=$1::jsonb,content_version=content_version+1,draft_updated_by=$2,draft_updated_at=NOW()
           WHERE id=1
           RETURNING content_version,draft_content,published_content,draft_updated_at,published_at`,
          [JSON.stringify(validation.value), req.user.id],
        );
        await audit(req, 'LANDING_CONTENT_DRAFT_SAVED', {
          announcementCount: validation.value.announcements.length,
          faqCount: validation.value.faqs.length,
          visibleSections: validation.value.sectionOrder.filter((section) => validation.value.sectionVisibility[section]),
        }, 'landing_page_content', 'draft', client);
        return saved.rows[0];
      });
      return res.json({ data: projectAdminLandingContent(row) });
    } catch (error) {
      if (error.status) return errorResponse(res, error.status, error.code || 'LANDING_CONTENT_SAVE_FAILED', error.message);
      throw error;
    }
  });

  app.post('/api/admin/landing-content/publish', requireRoles('system_administrator'), async (req, res) => {
    if (!Number.isSafeInteger(req.body?.version) || req.body.version < 1) {
      return errorResponse(res, 400, 'INVALID_VERSION', 'A current landing-page content version is required.');
    }
    try {
      const row = await transaction(async (client) => {
        const current = await client.query(
          'SELECT content_version,draft_content FROM branding_settings WHERE id=1 FOR UPDATE',
        );
        assertCurrentLandingContentVersion(current.rows[0]?.content_version || 1, req.body.version, 'publish');
        const validation = validateLandingContent(current.rows[0]?.draft_content);
        if (!validation.valid) {
          const error = new Error('Save a complete, valid draft before publishing.');
          error.status = 409;
          error.code = 'LANDING_DRAFT_INVALID';
          throw error;
        }
        const saved = await client.query(
          `UPDATE branding_settings
           SET published_content=$1::jsonb,content_version=content_version+1,published_by=$2,published_at=NOW()
           WHERE id=1
           RETURNING content_version,draft_content,published_content,draft_updated_at,published_at`,
          [JSON.stringify(validation.value), req.user.id],
        );
        await audit(req, 'LANDING_CONTENT_PUBLISHED', {
          announcementCount: validation.value.announcements.length,
          faqCount: validation.value.faqs.length,
          visibleSections: validation.value.sectionOrder.filter((section) => validation.value.sectionVisibility[section]),
        }, 'landing_page_content', 'published', client);
        return saved.rows[0];
      });
      return res.json({ data: projectAdminLandingContent(row) });
    } catch (error) {
      if (error.status) return errorResponse(res, error.status, error.code || 'LANDING_CONTENT_PUBLISH_FAILED', error.message);
      throw error;
    }
  });

  const readBrandingAssets = async () => {
    if (!databaseConfigured) return projectBrandingAssets([], 1);
    const [settings, assets] = await Promise.all([
      query('SELECT version FROM branding_settings WHERE id=1'),
      query('SELECT slot,asset_id FROM branding_assets WHERE slot=ANY($1::varchar[])', [BRANDING_SLOT_NAMES]),
    ]);
    return projectBrandingAssets(assets.rows, settings.rows[0]?.version || 1);
  };

  app.get('/api/branding', async (_req, res) => {
    try {
      return res.json({ data: { ...await readBrandingAssets(), storageConfigured: Boolean(storage?.isConfigured?.()) } });
    } catch {
      return res.json({ data: { ...projectBrandingAssets([], 1), storageConfigured: false } });
    }
  });

  app.get('/api/branding/assets/:slot', setImageStreamSecurityHeaders, async (req, res) => {
    if (!validateBrandingSlot(req.params.slot) || !databaseConfigured || !storage?.isConfigured?.()) return errorResponse(res, 404, 'BRANDING_ASSET_NOT_FOUND', 'Branding image not found.');
    const selected = await query('SELECT storage_key,content_type FROM branding_assets WHERE slot=$1', [req.params.slot]);
    if (!selected.rowCount) return errorResponse(res, 404, 'BRANDING_ASSET_NOT_FOUND', 'Branding image not found.');
    try {
      const bytes = await storage.download(process.env.SUPABASE_STORAGE_BUCKET, selected.rows[0].storage_key);
      if (!bytes) return errorResponse(res, 404, 'BRANDING_ASSET_NOT_FOUND', 'Branding image not found.');
      res.setHeader('Content-Type', selected.rows[0].content_type);
      res.setHeader('Content-Length', String(bytes.length));
      res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
      return res.status(200).send(bytes);
    } catch {
      return errorResponse(res, 503, 'BRANDING_STORAGE_UNAVAILABLE', 'Branding image is temporarily unavailable.');
    }
  });

  app.get('/api/admin/branding', requireRoles('system_administrator'), async (_req, res) => {
    return res.json({ data: { ...await readBrandingAssets(), storageConfigured: Boolean(storage?.isConfigured?.()) } });
  });

  app.put('/api/admin/branding/:slot', requireRoles('system_administrator'), async (req, res) => {
    if (!validateBrandingSlot(req.params.slot)) return errorResponse(res, 404, 'BRANDING_SLOT_NOT_FOUND', 'Branding slot not found.');
    if (!Number.isSafeInteger(req.body?.version) || req.body.version < 1) return errorResponse(res, 400, 'INVALID_VERSION', 'A current branding version is required.');
    if (!storage?.isConfigured?.() || !databaseConfigured) return errorResponse(res, 503, 'BRANDING_STORAGE_UNAVAILABLE', 'Private image storage is not configured. Contact the system administrator.');
    let image;
    try {
      image = validateRasterImageBase64(req.body?.dataBase64, { maxBytes: 1024 * 1024 });
    } catch (error) {
      return errorResponse(res, 400, error.code || 'INVALID_IMAGE', error.message);
    }
    if (req.body?.contentType !== image.contentType) return errorResponse(res, 400, 'INVALID_IMAGE_TYPE', 'The selected file type does not match the image data.');
    const assetId = crypto.randomUUID();
    const extension = image.contentType === 'image/jpeg' ? 'jpg' : image.contentType.split('/')[1];
    const storageKey = `branding/${req.params.slot}/${assetId}.${extension}`;
    try {
      await storage.upload(process.env.SUPABASE_STORAGE_BUCKET, storageKey, image.bytes, image.contentType);
    } catch {
      return errorResponse(res, 503, 'BRANDING_STORAGE_UNAVAILABLE', 'The branding image could not be saved. Check private storage configuration and retry.');
    }
    let updated;
    try {
      updated = await transaction(async (client) => {
        const version = await client.query('SELECT version FROM branding_settings WHERE id=1 FOR UPDATE');
        assertCurrentBrandingVersion(version.rows[0]?.version || 1, req.body.version);
        const previous = await client.query('SELECT storage_key FROM branding_assets WHERE slot=$1 FOR UPDATE', [req.params.slot]);
        await client.query(
          `INSERT INTO branding_assets(slot,asset_id,storage_key,content_type,size_bytes,width,height,updated_by,updated_at)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,NOW())
           ON CONFLICT(slot) DO UPDATE SET asset_id=EXCLUDED.asset_id,storage_key=EXCLUDED.storage_key,content_type=EXCLUDED.content_type,size_bytes=EXCLUDED.size_bytes,width=EXCLUDED.width,height=EXCLUDED.height,updated_by=EXCLUDED.updated_by,updated_at=NOW()`,
          [req.params.slot, assetId, storageKey, image.contentType, image.sizeBytes, image.width, image.height, req.user.id],
        );
        const savedVersion = await client.query('UPDATE branding_settings SET version=version+1,updated_by=$1,updated_at=NOW() WHERE id=1 RETURNING version', [req.user.id]);
        await audit(req, 'BRANDING_UPDATED', { slot: req.params.slot, reset: false }, 'branding_asset', assetId, client);
        return { version: savedVersion.rows[0].version, oldKey: previous.rows[0]?.storage_key || null };
      });
    } catch (error) {
      try { await storage.remove(process.env.SUPABASE_STORAGE_BUCKET, storageKey); } catch { /* unreachable orphan is cleaned operationally */ }
      if (error.status) return errorResponse(res, error.status, error.code || 'BRANDING_SAVE_FAILED', error.message);
      if (error.code === '23505') return errorResponse(res, 409, 'BRANDING_VERSION_CONFLICT', 'Branding changed in another session. Reload before saving.');
      throw error;
    }
    if (updated.oldKey) {
      try { await storage.remove(process.env.SUPABASE_STORAGE_BUCKET, updated.oldKey); } catch { /* old object is no longer reachable from the allowlisted slot */ }
    }
    return res.json({ data: { version: updated.version, slot: req.params.slot, assetId, url: `/api/branding/assets/${req.params.slot}?v=${encodeURIComponent(assetId)}`, contentType: image.contentType, width: image.width, height: image.height, sizeBytes: image.sizeBytes } });
  });

  app.delete('/api/admin/branding/:slot', requireRoles('system_administrator'), async (req, res) => {
    if (!validateBrandingSlot(req.params.slot)) return errorResponse(res, 404, 'BRANDING_SLOT_NOT_FOUND', 'Branding slot not found.');
    if (!Number.isSafeInteger(req.body?.version) || req.body.version < 1) return errorResponse(res, 400, 'INVALID_VERSION', 'A current branding version is required.');
    try {
      const result = await transaction(async (client) => {
        const setting = await client.query('SELECT version FROM branding_settings WHERE id=1 FOR UPDATE');
        assertCurrentBrandingVersion(setting.rows[0]?.version || 1, req.body.version, 'reset');
        const previous = await client.query('DELETE FROM branding_assets WHERE slot=$1 RETURNING storage_key', [req.params.slot]);
        const saved = await client.query('UPDATE branding_settings SET version=version+1,updated_by=$1,updated_at=NOW() WHERE id=1 RETURNING version', [req.user.id]);
        await audit(req, 'BRANDING_UPDATED', { slot: req.params.slot, reset: true }, 'branding_asset', req.params.slot, client);
        return { version: saved.rows[0].version, oldKey: previous.rows[0]?.storage_key || null };
      });
      if (result.oldKey && storage?.isConfigured?.()) {
        try { await storage.remove(process.env.SUPABASE_STORAGE_BUCKET, result.oldKey); } catch { /* reset removes the public reference even if storage cleanup is deferred */ }
      }
      return res.json({ data: { version: result.version, slot: req.params.slot, assetId: null, url: null } });
    } catch (error) {
      if (error.status) return errorResponse(res, error.status, error.code || 'BRANDING_RESET_FAILED', error.message);
      throw error;
    }
  });

  app.post('/api/auth/guardian-signup/request', authIpLimiter, guardianSignupRequestLimiter, async (req, res) => {
    const validation = validateGuardianSignup(req.body || {}, { validEmail, validatePassword });
    if (!validation.valid) return errorResponse(res, 400, 'VALIDATION_ERROR', 'Review the guardian account details and try again.', validation.errors);
    const signup = validation.value;
    const passwordHash = await hashPassword(signup.password);
    const metadata = {
      name: signup.name,
      username: signup.username,
      passwordHash,
      studentId: signup.studentId,
      relationship: signup.relationship,
    };
    try {
      const acceptWithoutDelivery = async () => {
        const challengeId = await createOtpChallenge({ id: null, email: signup.email }, 'guardian_signup', {}, { sendEmail: async () => {}, deferDelivery: true });
        await audit(req, 'GUARDIAN_SIGNUP_REQUESTED', { eligible: false });
        return res.status(202).json({ data: guardianSignupAcceptedResponse(challengeId) });
      };
      const [existing, invitation, pending] = await Promise.all([
        query('SELECT id FROM users WHERE LOWER(email)=$1 OR LOWER(username)=$2 LIMIT 1', [signup.email, signup.username]),
        query("SELECT 1 FROM invitations WHERE LOWER(email)=$1 AND accepted_at IS NULL AND expires_at>NOW() LIMIT 1", [signup.email]),
        query("SELECT 1 FROM guardian_signup_requests WHERE status='pending_review' AND (LOWER(email)=$1 OR LOWER(username)=$2) LIMIT 1", [signup.email, signup.username]),
      ]);
      if (existing.rowCount || invitation.rowCount || pending.rowCount) return await acceptWithoutDelivery();
      const challengeId = await createOtpChallenge({ id: null, email: signup.email }, 'guardian_signup', metadata, { deferDelivery: true });
      await audit(req, 'GUARDIAN_SIGNUP_REQUESTED', { eligible: true });
      return res.status(202).json({ data: guardianSignupAcceptedResponse(challengeId) });
    } catch (error) {
      if (error.code === 'OTP_COOLDOWN') return errorResponse(res, 429, error.code, error.message);
      throw error;
    }
  });

  app.post('/api/auth/guardian-signup/verify', authIpLimiter, guardianSignupVerifyLimiter, async (req, res) => {
    const challengeId = req.body?.challengeId;
    const code = req.body?.code;
    if (typeof challengeId !== 'string' || typeof code !== 'string') {
      return errorResponse(res, 400, 'INVALID_OTP', 'The verification code is invalid or expired.');
    }
    let signupRequest;
    try {
      signupRequest = await consumeOtp(challengeId, code, 'guardian_signup', {
        onConsume: async (challenge, client) => {
          const metadata = challenge.metadata || {};
          if (!validGuardianSignupMetadata(metadata) || !validEmail(challenge.destination)) {
            const error = new Error('The verification request is invalid or expired.');
            error.status = 400;
            error.code = 'INVALID_OTP';
            throw error;
          }
          const identityLocks = [
            `guardian-signup:email:${normalizeIdentifier(challenge.destination)}`,
            `guardian-signup:username:${normalizeIdentifier(metadata.username)}`,
          ].sort();
          for (const key of identityLocks) await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key]);
          const accountConflict = await client.query(
            'SELECT id FROM users WHERE LOWER(email)=$1 OR LOWER(username)=$2 FOR UPDATE',
            [normalizeIdentifier(challenge.destination), normalizeIdentifier(metadata.username)],
          );
          const invitationConflict = await client.query(
            "SELECT 1 FROM invitations WHERE LOWER(email)=$1 AND accepted_at IS NULL AND expires_at>NOW() LIMIT 1",
            [normalizeIdentifier(challenge.destination)],
          );
          const pendingConflict = await client.query(
            "SELECT id FROM guardian_signup_requests WHERE status='pending_review' AND (LOWER(email)=$1 OR LOWER(username)=$2) FOR UPDATE",
            [normalizeIdentifier(challenge.destination), normalizeIdentifier(metadata.username)],
          );
          if (accountConflict.rowCount || invitationConflict.rowCount || pendingConflict.rowCount) return null;
          const matches = await client.query(
            `SELECT id,patient_type,data->>'studentId' AS student_id FROM patients
             WHERE patient_type='student' AND LOWER(${patientRosterIdentitySql(2)})=$1
             ORDER BY id FOR UPDATE`,
            [normalizeIdentifier(metadata.studentId), rosterIdTrimCharacters],
          );
          const studentMatch = resolveGuardianStudentMatch(matches.rows, metadata.studentId);
          if (!studentMatch.valid) {
            const error = new Error('The student ID could not be matched to exactly one student record. Check the ID with the school clinic and try again.');
            error.status = 400;
            error.code = 'STUDENT_ID_NOT_VERIFIED';
            throw error;
          }
          const id = crypto.randomUUID();
          await client.query(
            `INSERT INTO guardian_signup_requests(id,name,email,username,password_hash,student_id,relationship)
             VALUES($1,$2,$3,$4,$5,$6,$7)`,
            [id, metadata.name, normalizeIdentifier(challenge.destination), normalizeIdentifier(metadata.username), metadata.passwordHash, metadata.studentId.trim(), metadata.relationship],
          );
          await client.query('UPDATE otp_challenges SET metadata=\'{}\'::jsonb WHERE id=$1', [challenge.id]);
          await audit(req, 'GUARDIAN_SIGNUP_EMAIL_VERIFIED', {}, 'guardian_signup_request', id, client);
          return { id };
        },
      });
    } catch (error) {
      if (error.code === '23505') return errorResponse(res, 409, 'SIGNUP_NOT_AVAILABLE', 'This signup request could not be submitted. Sign in or use the invitation already sent to your email.');
      if (error.status) return errorResponse(res, error.status, error.code || 'SIGNUP_FAILED', error.message);
      throw error;
    }
    if (!signupRequest) return errorResponse(res, 400, 'INVALID_OTP', 'The verification code is invalid or expired.');
    return res.json({ data: { pendingReview: true, message: 'Your email is verified. Your guardian account request is awaiting administrator review. You can sign in after approval.' } });
  });

  app.get('/api/me/dashboard-preferences', requireRoles('school_nurse', 'system_administrator'), async (req, res) => {
    const result = await query('SELECT dashboard,updated_at FROM user_preferences WHERE user_id=$1', [req.user.id]);
    const dashboard = normalizeDashboardPreferences(req.user.role, result.rows[0]?.dashboard);
    return res.json({ data: { dashboard, updatedAt: result.rows[0]?.updated_at || null } });
  });

  app.put('/api/me/dashboard-preferences', requireRoles('school_nurse', 'system_administrator'), async (req, res) => {
    const validation = validateDashboardPreferences(req.user.role, req.body?.dashboard);
    if (!validation.valid) return errorResponse(res, 400, 'INVALID_DASHBOARD_PREFERENCES', validation.message);
    let saved;
    await transaction(async (client) => {
      const result = await client.query(
        `INSERT INTO user_preferences(user_id,dashboard,updated_at)
         VALUES($1,$2::jsonb,NOW())
         ON CONFLICT(user_id) DO UPDATE SET dashboard=EXCLUDED.dashboard,updated_at=NOW()
         RETURNING dashboard,updated_at`,
        [req.user.id, JSON.stringify(validation.value)],
      );
      saved = result.rows[0];
      await audit(req, 'DASHBOARD_PREFERENCES_UPDATED', { visibleCount: validation.value.widgets.filter((widget) => widget.visible).length }, 'user', req.user.id, client);
    });
    return res.json({ data: { dashboard: saved.dashboard, updatedAt: saved.updated_at } });
  });

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
    const challengeId = await passwordResetChallenge(user);
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
    const account = await query("SELECT id FROM users WHERE id=$1 AND status='active' AND role<>'student'", [challenge.user_id]);
    if (!account.rowCount) return errorResponse(res, 403, 'ACCOUNT_INACTIVE', 'This account cannot use password reset. Contact an administrator.');
    const passwordChanged = await transaction(async (client) => {
      const updated = await client.query("UPDATE users SET password_hash=$1,updated_at=NOW() WHERE id=$2 AND status='active' AND role<>'student'", [await hashPassword(req.body.password), challenge.user_id]);
      if (!updated.rowCount) return false;
      await client.query('DELETE FROM sessions WHERE user_id=$1', [challenge.user_id]);
      return true;
    });
    if (!passwordChanged) return errorResponse(res, 403, 'ACCOUNT_INACTIVE', 'This account cannot use password reset. Contact an administrator.');
    await audit(req, 'PASSWORD_RESET_COMPLETED', {}, 'user', challenge.user_id);
    return res.json({ data: { success: true, message: 'Password reset successfully.' } });
  });

  app.post('/api/auth/activate', activationLimiter, async (req, res) => {
    if (typeof req.body?.token !== 'string' || !req.body.token || req.body.token.length > 512) {
      return errorResponse(res, 400, 'INVALID_INVITATION', 'The invitation is invalid, expired, or no longer active.');
    }
    const tokenHash = hashSecret(req.body.token);
    const passwordError = validatePassword(req.body?.password);
    if (passwordError) return errorResponse(res, 400, 'WEAK_PASSWORD', passwordError);
    const username = normalizeIdentifier(req.body?.username).replace(/\s+/g, '.');
    if (!/^[a-z0-9._-]{3,80}$/.test(username)) return errorResponse(res, 400, 'INVALID_USERNAME', 'Use 3–80 letters, numbers, dots, underscores, or dashes. Spaces become dots.');
    try {
      const passwordHash = await hashPassword(req.body.password);
      await transaction((client) => activateInvitedAccount(client, { tokenHash, username, passwordHash }));
    } catch (error) {
      if (error.code === '23505') return errorResponse(res, 409, 'USERNAME_TAKEN', 'That username or email is already in use.');
      if (error.status) return errorResponse(res, error.status, error.code, error.message);
      throw error;
    }
    return res.json({ data: { success: true, message: 'Account activated. You can now sign in.' } });
  });

  app.post('/api/admin/users/invite', requireRoles('system_administrator'), async (req, res) => {
    const email = normalizeIdentifier(req.body?.email);
    const name = String(req.body?.name || '').trim();
    const role = String(req.body?.role || '');
    if (!validEmail(email) || !name || !allowedRoles.has(role)) return errorResponse(res, 400, 'VALIDATION_ERROR', 'A valid name, email, and role are required.');
    if (role === 'guardian') {
      const patient = await query("SELECT 1 FROM patients WHERE id=$1 AND patient_type='student'", [String(req.body?.patientId || '')]);
      if (!patient.rowCount) return errorResponse(res, 400, 'PATIENT_LINK_REQUIRED', 'Select an existing student patient record for the guardian account.');
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
        ...invitationEmail(name, activationUrl, buildSignInUrl()),
      });
    } catch (error) {
      await audit(req, 'INVITATION_EMAIL_FAILED', { email, reason: error.code || 'delivery_error' }, 'user', userId);
      return res.status(201).json({ data: { userId, emailSent: false, message: 'Account created, but the invitation email could not be delivered.' } });
    }
    await audit(req, 'USER_INVITED', { role, email }, 'user', userId);
    return res.status(201).json({ data: { userId, emailSent: true } });
  });

  app.get('/api/admin/users', requireRoles('system_administrator'), async (_req, res) => res.json({ data: { users: await listUsers() } }));

  const sendGuardianSignupDecisionEmail = async (requestId, actorUserId) => {
    const claim = await query(
      `UPDATE guardian_signup_requests
       SET decision_email_attempted_at=NOW()
       WHERE id=$1 AND decision_email_status='queued'
         AND (decision_email_attempted_at IS NULL OR decision_email_attempted_at<NOW()-INTERVAL '5 minutes')
       RETURNING email,name,status`,
      [requestId],
    );
    if (!claim.rowCount) {
      const current = await query('SELECT decision_email_status FROM guardian_signup_requests WHERE id=$1', [requestId]);
      return current.rows[0]?.decision_email_status || 'not_sent';
    }
    const recipient = claim.rows[0];
    const message = guardianSignupDecisionEmail(recipient.status, recipient.name, buildSignInUrl());
    try {
      await sendEmail({ to: recipient.email, ...message });
      await query("UPDATE guardian_signup_requests SET decision_email_status='sent',decision_email_error_code=NULL,updated_at=NOW() WHERE id=$1", [requestId]);
      await query("INSERT INTO audit_logs(actor_user_id,event,subject_type,subject_id,details) VALUES($1,'GUARDIAN_SIGNUP_DECISION_EMAIL', 'guardian_signup_request',$2,$3::jsonb)", [actorUserId, requestId, JSON.stringify({ status: 'sent' })]);
      return 'sent';
    } catch (error) {
      const errorCode = /^[A-Z0-9_-]{1,60}$/.test(String(error?.code || '')) ? String(error.code) : 'delivery_error';
      await query("UPDATE guardian_signup_requests SET decision_email_status='failed',decision_email_error_code=$2,updated_at=NOW() WHERE id=$1", [requestId, errorCode]);
      await query("INSERT INTO audit_logs(actor_user_id,event,subject_type,subject_id,details) VALUES($1,'GUARDIAN_SIGNUP_DECISION_EMAIL', 'guardian_signup_request',$2,$3::jsonb)", [actorUserId, requestId, JSON.stringify({ status: 'failed' })]);
      return 'failed';
    }
  };

  app.get('/api/admin/guardian-signup-requests', requireRoles('system_administrator'), async (req, res) => {
    const validation = validateGuardianSignupPageQuery(req.query);
    if (!validation.valid) return errorResponse(res, 400, 'INVALID_REQUEST_FILTER', validation.message);
    const { status, order, limit, page, search } = validation.value;
    const where = [];
    const values = [];
    if (status !== 'all') { values.push(status); where.push(`status=$${values.length}`); }
    if (search) {
      values.push(`%${search}%`);
      where.push(`(name ILIKE $${values.length} OR email ILIKE $${values.length} OR username ILIKE $${values.length} OR student_id ILIKE $${values.length})`);
    }
    const filterSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const count = await query(`SELECT COUNT(*)::int AS total FROM guardian_signup_requests ${filterSql}`, values);
    const total = count.rows[0]?.total || 0;
    const direction = order === 'oldest' ? 'ASC' : 'DESC';
    const resultValues = [...values, limit, (page - 1) * limit];
    const requests = await query(
      `SELECT id,name,email,username,student_id,relationship,status,decision_reason,decision_email_status,created_at,decided_at
       FROM guardian_signup_requests ${filterSql}
       ORDER BY created_at ${direction},id ${direction} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      resultValues,
    );
    return res.json({ data: {
      requests: requests.rows.map(publicGuardianSignupRequest),
      page, pageSize: limit, total, pageCount: Math.max(1, Math.ceil(total / limit)),
    } });
  });

  app.patch('/api/admin/guardian-signup-requests/:id/approve', requireRoles('system_administrator'), async (req, res) => {
    if (!validUuid(req.params.id)) return errorResponse(res, 400, 'INVALID_REQUEST_ID', 'A valid signup request id is required.');
    if (req.body?.verifiedRelationship !== true) return errorResponse(res, 400, 'RELATIONSHIP_VERIFICATION_REQUIRED', 'Confirm that you verified the relationship against school records.');
    let request;
    try {
      request = await transaction(async (client) => {
        const selected = await client.query('SELECT * FROM guardian_signup_requests WHERE id=$1 FOR UPDATE', [req.params.id]);
        if (!selected.rowCount) {
          const error = new Error('Guardian signup request not found.');
          error.status = 404;
          error.code = 'NOT_FOUND';
          throw error;
        }
        const row = selected.rows[0];
        if (row.status === 'approved') return { id: row.id, status: row.status, email: row.email, name: row.name };
        if (row.status !== 'pending_review' || !row.password_hash) {
          const error = new Error('This signup request is no longer awaiting review.');
          error.status = 409;
          error.code = 'REQUEST_ALREADY_DECIDED';
          throw error;
        }
        const locks = [
          `guardian-signup:email:${normalizeIdentifier(row.email)}`,
          `guardian-signup:username:${normalizeIdentifier(row.username)}`,
          `guardian-signup:student:${normalizeIdentifier(row.student_id)}`,
        ].sort();
        for (const key of locks) await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key]);
        const accounts = await client.query('SELECT id FROM users WHERE LOWER(email)=$1 OR LOWER(username)=$2 FOR UPDATE', [normalizeIdentifier(row.email), normalizeIdentifier(row.username)]);
        const invitations = await client.query("SELECT id FROM invitations WHERE LOWER(email)=$1 AND accepted_at IS NULL AND expires_at>NOW() FOR UPDATE", [normalizeIdentifier(row.email)]);
        if (accounts.rowCount || invitations.rowCount) {
          const error = new Error('An account or administrator invitation now uses this email or username. Resolve that account before approving this request.');
          error.status = 409;
          error.code = 'ACCOUNT_CONFLICT';
          throw error;
        }
        const students = await client.query(
          `SELECT id,patient_type,data->>'studentId' AS student_id FROM patients
           WHERE patient_type='student' AND LOWER(${patientRosterIdentitySql(2)})=$1 ORDER BY id FOR UPDATE`,
          [normalizeIdentifier(row.student_id), rosterIdTrimCharacters],
        );
        const match = resolveGuardianStudentMatch(students.rows, row.student_id);
        if (!match.valid) {
          const error = new Error('The submitted student ID no longer matches exactly one student record. Reject this request with a reason so the applicant can correct it.');
          error.status = 409;
          error.code = 'STUDENT_MATCH_REQUIRED';
          throw error;
        }
        const userId = crypto.randomUUID();
        await client.query(
          `INSERT INTO users(id,username,email,password_hash,name,role,status,mfa_enabled)
           VALUES($1,$2,$3,$4,$5,'guardian','active',TRUE)`,
          [userId, normalizeIdentifier(row.username), normalizeIdentifier(row.email), row.password_hash, row.name],
        );
        await client.query('INSERT INTO guardian_patient_links(guardian_user_id,patient_id,relationship) VALUES($1,$2,$3)', [userId, match.patient.id, row.relationship]);
        await client.query(
          `UPDATE guardian_signup_requests
           SET status='approved',password_hash=NULL,relationship_verified=TRUE,decision_by=$2,decided_at=NOW(),decision_reason='',decision_email_status='queued',decision_email_attempted_at=NULL,decision_email_error_code=NULL,updated_at=NOW()
           WHERE id=$1`,
          [row.id, req.user.id],
        );
        await audit(req, 'GUARDIAN_SIGNUP_APPROVED', {}, 'guardian_signup_request', row.id, client);
        return { id: row.id, status: 'approved', email: row.email, name: row.name, createdUserId: userId };
      });
    } catch (error) {
      if (error.code === '23505') return errorResponse(res, 409, 'ACCOUNT_CONFLICT', 'An account now uses this email or username. Resolve that account before approving this request.');
      if (error.status) return errorResponse(res, error.status, error.code || 'REQUEST_APPROVAL_FAILED', error.message);
      throw error;
    }
    const decisionEmailStatus = await sendGuardianSignupDecisionEmail(request.id, req.user.id);
    return res.json({ data: { request: { id: request.id, status: request.status, decisionEmailStatus } } });
  });

  app.patch('/api/admin/guardian-signup-requests/:id/reject', requireRoles('system_administrator'), async (req, res) => {
    if (!validUuid(req.params.id)) return errorResponse(res, 400, 'INVALID_REQUEST_ID', 'A valid signup request id is required.');
    const reason = validateGuardianSignupDecisionReason(req.body?.reason);
    if (!reason.valid) return errorResponse(res, 400, 'INVALID_REASON', 'Enter a rejection reason from 1 to 500 characters.');
    let request;
    try {
      request = await transaction(async (client) => {
        const selected = await client.query('SELECT * FROM guardian_signup_requests WHERE id=$1 FOR UPDATE', [req.params.id]);
        if (!selected.rowCount) {
          const error = new Error('Guardian signup request not found.');
          error.status = 404;
          error.code = 'NOT_FOUND';
          throw error;
        }
        const row = selected.rows[0];
        if (row.status === 'rejected') return { id: row.id, status: row.status };
        if (row.status !== 'pending_review') {
          const error = new Error('This signup request is no longer awaiting review.');
          error.status = 409;
          error.code = 'REQUEST_ALREADY_DECIDED';
          throw error;
        }
        await client.query(
          `UPDATE guardian_signup_requests
           SET status='rejected',password_hash=NULL,relationship_verified=FALSE,decision_by=$2,decided_at=NOW(),decision_reason=$3,decision_email_status='queued',decision_email_attempted_at=NULL,decision_email_error_code=NULL,updated_at=NOW()
           WHERE id=$1`,
          [row.id, req.user.id, reason.value],
        );
        await audit(req, 'GUARDIAN_SIGNUP_REJECTED', {}, 'guardian_signup_request', row.id, client);
        return { id: row.id, status: 'rejected' };
      });
    } catch (error) {
      if (error.status) return errorResponse(res, error.status, error.code || 'REQUEST_REJECTION_FAILED', error.message);
      throw error;
    }
    const decisionEmailStatus = await sendGuardianSignupDecisionEmail(request.id, req.user.id);
    return res.json({ data: { request: { id: request.id, status: request.status, decisionEmailStatus } } });
  });

  app.post('/api/admin/guardian-signup-requests/:id/retry-notification', requireRoles('system_administrator'), async (req, res) => {
    if (!validUuid(req.params.id)) return errorResponse(res, 400, 'INVALID_REQUEST_ID', 'A valid signup request id is required.');
    const request = await query("SELECT id,status,decision_email_status FROM guardian_signup_requests WHERE id=$1", [req.params.id]);
    if (!request.rowCount) return errorResponse(res, 404, 'NOT_FOUND', 'Guardian signup request not found.');
    if (!['approved', 'rejected'].includes(request.rows[0].status)) return errorResponse(res, 409, 'REQUEST_PENDING', 'Decide this request before sending a notification.');
    if (request.rows[0].decision_email_status === 'sent') return errorResponse(res, 409, 'ALREADY_SENT', 'The decision notification was already sent.');
    await query("UPDATE guardian_signup_requests SET decision_email_status='queued',decision_email_attempted_at=NULL,decision_email_error_code=NULL,updated_at=NOW() WHERE id=$1", [req.params.id]);
    const decisionEmailStatus = await sendGuardianSignupDecisionEmail(req.params.id, req.user.id);
    return res.json({ data: { id: req.params.id, decisionEmailStatus } });
  });

  app.patch('/api/admin/users/:id/patient-link', requireRoles('system_administrator'), async (req, res) => {
    if (!validUuid(req.params.id)) return errorResponse(res, 400, 'INVALID_USER_ID', 'A valid user id is required.');
    const patientId = String(req.body?.patientId || '').trim();
    const relationship = String(req.body?.relationship || '').trim();
    if (!patientId || patientId.length > 120 || !relationship || relationship.length > 80) return errorResponse(res, 400, 'VALIDATION_ERROR', 'A student record and guardian relationship are required.');
    try {
      await transaction(async (client) => {
        const account = await client.query('SELECT id,role,status FROM users WHERE id=$1 FOR UPDATE', [req.params.id]);
        if (!account.rowCount) {
          const error = new Error('User not found.');
          error.status = 404;
          error.code = 'NOT_FOUND';
          throw error;
        }
        if (account.rows[0].role !== 'guardian') {
          const error = new Error('Only guardian accounts can be linked to a student.');
          error.status = 409;
          error.code = 'GUARDIAN_ACCOUNT_REQUIRED';
          throw error;
        }
        const patient = await client.query("SELECT id FROM patients WHERE id=$1 AND patient_type='student'", [patientId]);
        if (!patient.rowCount) {
          const error = new Error('Student patient record not found.');
          error.status = 404;
          error.code = 'PATIENT_NOT_FOUND';
          throw error;
        }
        await client.query(
          `INSERT INTO guardian_patient_links(guardian_user_id,patient_id,relationship) VALUES($1,$2,$3)
           ON CONFLICT(guardian_user_id,patient_id) DO UPDATE SET relationship=EXCLUDED.relationship`,
          [req.params.id, patientId, relationship],
        );
        await audit(req, 'GUARDIAN_STUDENT_LINK_UPDATED', { relationship, accountStatus: account.rows[0].status }, 'user', req.params.id, client);
      });
      return res.json({ data: { success: true } });
    } catch (error) {
      if (error.status) return errorResponse(res, error.status, error.code, error.message);
      throw error;
    }
  });

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
    const rawToken = createRawToken();
    let account;
    try {
      account = await transaction((client) => renewPendingInvitation(client, {
        userId: req.params.id,
        invitationId: crypto.randomUUID(),
        tokenHash: hashSecret(rawToken),
        invitedBy: req.user.id,
      }));
    } catch (error) {
      if (error.status) return errorResponse(res, error.status, error.code, error.message);
      throw error;
    }
    const activationUrl = buildInvitationActivationUrl(rawToken);
    try {
      await sendEmail({
        to: account.email,
        ...invitationEmail(account.name, activationUrl, buildSignInUrl()),
      });
    } catch (error) {
      await audit(req, 'INVITATION_EMAIL_FAILED', { email: account.email, reason: error.code || 'delivery_error' }, 'user', account.id);
      return errorResponse(res, 502, 'EMAIL_DELIVERY_FAILED', 'The invitation was renewed, but the email could not be delivered. Check Resend configuration and delivery status before retrying.');
    }
    await audit(req, 'INVITATION_RESENT', { email: account.email }, 'user', account.id);
    return res.json({ data: { success: true, message: 'Invitation resent.' } });
  });

  app.patch('/api/admin/users/:id/status', requireRoles('system_administrator'), async (req, res) => {
    const status = String(req.body?.status || '');
    let updatedUser;
    try {
      updatedUser = await transaction((client) => changeAccountStatus(client, {
        userId: req.params.id,
        status,
        actorId: req.user.id,
      }));
    } catch (error) {
      if (error.status) return errorResponse(res, error.status, error.code, error.message);
      throw error;
    }
    await audit(req, 'ACCOUNT_STATUS_CHANGED', { status }, 'user', req.params.id);
    return res.json({ data: { user: publicUser(updatedUser) } });
  });

  app.get('/api/admin/audit-logs', requireRoles('system_administrator'), async (req, res) => {
    const validation = validateAuditPageQuery(req.query);
    if (!validation.valid) return errorResponse(res, 400, 'INVALID_AUDIT_QUERY', validation.message);
    const pageQuery = buildAuditPageQuery(validation.value);
    const result = await query(pageQuery.sql, pageQuery.params);
    const page = formatAuditPage(result.rows, { ...validation.value, reverse: pageQuery.reverse });
    const logs = sanitizeAuditLogs(page.logs.map(({ cursor_created_at, ...entry }) => entry));
    return res.json({ data: { ...page, logs } });
  });

  app.get('/api/data', requireAuth, async (req, res) => res.json({ data: await loadClinicData(req.user) }));

  app.get('/api/nurse/dashboard', requireRoles('school_nurse'), async (req, res) => {
    return res.json({ data: await loadNurseDashboardData() });
  });

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
      const patientId = visit.studentId || visit.patientId;
      const patient = after.students.find((student) => String(student.id) === String(patientId));
      if (patient?.patientType !== 'student') continue;
      const notice = clinicVisitCareSummary({ studentName: patient.name, visit });
      try {
        await notifyLinkedUsers(patientId, { ...notice, dedupeKey: `visit:${visit.id}` });
      } catch (error) {
        console.error('Legacy visit notification failed:', error.message);
      }
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

  app.get('/api/guardian/health-records', requireRoles('guardian'), async (req, res) => {
    const [settingsResult, patientResult] = await Promise.all([
      query('SELECT data FROM clinic_settings WHERE id=1'),
      query(
        `SELECT p.id,p.data,d.payload AS draft_payload,d.version AS draft_version,d.updated_at AS draft_updated_at
         FROM guardian_patient_links l
         JOIN patients p ON p.id=l.patient_id AND p.patient_type='student'
         LEFT JOIN guardian_health_record_drafts d
           ON d.patient_id=p.id AND d.guardian_user_id=l.guardian_user_id
          AND d.school_year=COALESCE((SELECT data->>'schoolYear' FROM clinic_settings WHERE id=1),'')
         WHERE l.guardian_user_id=$1 ORDER BY p.created_at`,
        [req.user.id],
      ),
    ]);
    const schoolYear = String(settingsResult.rows[0]?.data?.schoolYear || '');
    const patientIds = patientResult.rows.map((row) => row.id);
    const submissionResult = patientIds.length
      ? await query(
        `SELECT id,patient_id,school_year,revision,source,status,payload,version,guardian_attested_at,
                paper_signature_presence,nurse_notes,nurse_reviewed_at,created_at,updated_at
         FROM health_record_submissions
         WHERE patient_id=ANY($1::text[])
         ORDER BY created_at DESC`,
        [patientIds],
      )
      : { rows: [] };
    const submissionsByPatient = new Map();
    for (const row of submissionResult.rows) {
      const key = String(row.patient_id);
      submissionsByPatient.set(key, [...(submissionsByPatient.get(key) || []), row]);
    }
    const identityFields = ['studentId', 'name', 'gradeLevel', 'section', 'adviser'];
    const currentAnswerFields = ['birthDate', 'gender', 'motherName', 'fatherName', 'guardianName', 'guardianPhone', 'guardianRelation', 'bloodType', 'allergies', 'allergiesStatus', 'conditions', 'conditionsStatus', 'medications', 'medicationsStatus', 'pastIllness', 'presentIllness', 'hospitalizationHistory', 'hospitalizationDetails', 'g6pdDeficiency', 'medicationAtHome', 'takingRegularMedication', 'regularMedicationName', 'onTherapy', 'lastTreatmentDate', 'therapistName', 'therapyInterventions', 'hasConcerns', 'concernsDetails', 'documentsSubmitted', 'documentsReceived'];
    const records = patientResult.rows.map((row) => {
      const profile = row.data || {};
      const currentAnswers = Object.fromEntries(currentAnswerFields.filter((field) => profile[field] !== undefined).map((field) => [field, profile[field]]));
      return {
        patient: { id: row.id, ...Object.fromEntries(identityFields.filter((field) => profile[field] !== undefined).map((field) => [field, profile[field]])) },
        currentAnswers,
        draft: row.draft_payload ? { payload: row.draft_payload, version: row.draft_version, updatedAt: row.draft_updated_at } : null,
        submissions: submissionsByPatient.get(String(row.id)) || [],
      };
    });
    return res.json({ data: { schoolYear, records } });
  });

  app.put('/api/guardian/health-records/:patientId/draft', requireRoles('guardian'), async (req, res) => {
    const patientId = String(req.params.patientId || '').trim();
    const expectedVersion = Number(req.body?.version);
    if (!patientId || patientId.length > 120 || !Number.isInteger(expectedVersion) || expectedVersion < 0) {
      return errorResponse(res, 400, 'VALIDATION_ERROR', 'A valid patient and draft version are required.');
    }
    const validation = normalizeHealthRecordAnswers(req.body?.payload);
    if (!validation.valid) return errorResponse(res, 400, 'VALIDATION_ERROR', 'Review the health record fields.', validation.errors);
    try {
      const draft = await transaction(async (client) => {
        const patient = await client.query(
          `SELECT p.id FROM patients p JOIN guardian_patient_links l ON l.patient_id=p.id
           WHERE p.id=$1 AND p.patient_type='student' AND l.guardian_user_id=$2 FOR UPDATE OF p`,
          [patientId, req.user.id],
        );
        if (!patient.rowCount) {
          const error = new Error('This student is not linked to your account.');
          error.status = 404;
          error.code = 'PATIENT_NOT_LINKED';
          throw error;
        }
        const settings = await client.query('SELECT data->>\'schoolYear\' AS school_year FROM clinic_settings WHERE id=1');
        const schoolYear = String(settings.rows[0]?.school_year || '');
        if (!schoolYear) {
          const error = new Error('The current school year is not configured. Contact the school clinic.');
          error.status = 409;
          error.code = 'SCHOOL_YEAR_UNAVAILABLE';
          throw error;
        }
        const current = await client.query(
          'SELECT id,version FROM guardian_health_record_drafts WHERE patient_id=$1 AND guardian_user_id=$2 AND school_year=$3 FOR UPDATE',
          [patientId, req.user.id, schoolYear],
        );
        if ((current.rowCount && Number(current.rows[0].version) !== expectedVersion)
          || (!current.rowCount && expectedVersion !== 0)) {
          const error = new Error('This draft changed in another session. Reload the form and try again.');
          error.status = 409;
          error.code = 'VERSION_CONFLICT';
          throw error;
        }
        const result = current.rowCount
          ? await client.query(
            `UPDATE guardian_health_record_drafts SET payload=$1::jsonb,version=version+1,updated_at=NOW()
             WHERE id=$2 RETURNING id,payload,version,updated_at`,
            [JSON.stringify(validation.value), current.rows[0].id],
          )
          : await client.query(
            `INSERT INTO guardian_health_record_drafts(id,patient_id,guardian_user_id,school_year,payload,version)
             VALUES($1,$2,$3,$4,$5::jsonb,1) RETURNING id,payload,version,updated_at`,
            [crypto.randomUUID(), patientId, req.user.id, schoolYear, JSON.stringify(validation.value)],
          );
        await audit(req, 'GUARDIAN_HEALTH_RECORD_DRAFT_SAVED', { schoolYear, version: result.rows[0].version }, 'patient', patientId, client);
        return result.rows[0];
      });
      return res.json({ data: { draft } });
    } catch (error) {
      if (error.status) return errorResponse(res, error.status, error.code, error.message);
      throw error;
    }
  });

  app.post('/api/guardian/health-records/:patientId/submit', requireRoles('guardian'), async (req, res) => {
    const patientId = String(req.params.patientId || '').trim();
    const expectedVersion = Number(req.body?.version);
    if (!patientId || patientId.length > 120 || !Number.isInteger(expectedVersion) || expectedVersion < 1 || req.body?.attest !== true) {
      return errorResponse(res, 400, 'ATTESTATION_REQUIRED', 'Save the draft and confirm the guardian attestation before submitting.');
    }
    try {
      const submitted = await transaction(async (client) => {
        const patient = await client.query(
          `SELECT p.id FROM patients p JOIN guardian_patient_links l ON l.patient_id=p.id
           WHERE p.id=$1 AND p.patient_type='student' AND l.guardian_user_id=$2 FOR UPDATE OF p`,
          [patientId, req.user.id],
        );
        if (!patient.rowCount) {
          const error = new Error('This student is not linked to your account.');
          error.status = 404;
          error.code = 'PATIENT_NOT_LINKED';
          throw error;
        }
        const settings = await client.query('SELECT data->>\'schoolYear\' AS school_year FROM clinic_settings WHERE id=1');
        const schoolYear = String(settings.rows[0]?.school_year || '');
        const draftResult = await client.query(
          'SELECT payload,version FROM guardian_health_record_drafts WHERE patient_id=$1 AND guardian_user_id=$2 AND school_year=$3 FOR UPDATE',
          [patientId, req.user.id, schoolYear],
        );
        if (!draftResult.rowCount) {
          const error = new Error('Save a draft before submitting the health record.');
          error.status = 409;
          error.code = 'DRAFT_REQUIRED';
          throw error;
        }
        if (Number(draftResult.rows[0].version) !== expectedVersion) {
          const error = new Error('This draft changed in another session. Reload the form and try again.');
          error.status = 409;
          error.code = 'VERSION_CONFLICT';
          throw error;
        }
        const duplicateSubmission = await client.query(
          `SELECT id,patient_id,school_year,revision,source,status,payload,version,guardian_attested_at,created_at,updated_at
           FROM health_record_submissions
           WHERE patient_id=$1 AND guardian_user_id=$2 AND school_year=$3 AND draft_version=$4`,
          [patientId, req.user.id, schoolYear, expectedVersion],
        );
        if (duplicateSubmission.rowCount) return { submission: duplicateSubmission.rows[0], notification: null };
        await client.query(
          `UPDATE health_record_submissions SET status='superseded',version=version+1,updated_at=NOW()
           WHERE patient_id=$1 AND guardian_user_id=$2 AND school_year=$3 AND status='changes_requested'`,
          [patientId, req.user.id, schoolYear],
        );
        const revisionResult = await client.query(
          'SELECT COALESCE(MAX(revision),0)+1 AS revision FROM health_record_submissions WHERE patient_id=$1 AND school_year=$2',
          [patientId, schoolYear],
        );
        const id = crypto.randomUUID();
        const result = await client.query(
          `INSERT INTO health_record_submissions(id,patient_id,guardian_user_id,school_year,revision,source,status,payload,draft_version,guardian_attested_at,attestation_text)
           VALUES($1,$2,$3,$4,$5,'guardian','pending_review',$6::jsonb,$7,NOW(),$8)
           RETURNING id,patient_id,school_year,revision,source,status,payload,version,guardian_attested_at,created_at,updated_at`,
          [id, patientId, req.user.id, schoolYear, revisionResult.rows[0].revision, JSON.stringify(draftResult.rows[0].payload), expectedVersion, 'I am this student’s parent or legal guardian. The information I provided is accurate to the best of my knowledge. I authorize the school nurse to review it for school health support. I understand that the nurse reviews submissions before they update the student health profile.'],
        );
        const notification = await persistHealthRecordStatusNotifications(client, result.rows[0], { includeNurses: true });
        await audit(req, 'GUARDIAN_HEALTH_RECORD_SUBMITTED', { schoolYear, revision: result.rows[0].revision }, 'health_record_submission', id, client);
        return { submission: result.rows[0], notification };
      });
      await deliverHealthRecordStatusNotice(submitted.notification);
      return res.status(201).json({ data: { submission: submitted.submission } });
    } catch (error) {
      if (error.status) return errorResponse(res, error.status, error.code, error.message);
      throw error;
    }
  });

  app.get('/api/nurse/health-record-submissions', requireRoles('school_nurse'), async (req, res) => {
    const history = req.query.history === 'true';
    const parsedOffset = Number.parseInt(String(req.query.offset || '0'), 10);
    const offset = Number.isInteger(parsedOffset) && parsedOffset > 0 ? Math.min(parsedOffset, 100000) : 0;
    const pageSize = 100;
    const result = await query(
      `SELECT s.id,s.patient_id,s.guardian_user_id,s.school_year,s.revision,s.source,s.status,s.payload,s.version,
              s.guardian_attested_at,s.paper_signature_presence,s.documents_received,s.nurse_notes,s.nurse_reviewed_at,s.created_at,
              p.data->>'name' AS patient_name,p.data->>'studentId' AS student_id,p.data->>'gradeLevel' AS grade_level,
              u.name AS guardian_name
       FROM health_record_submissions s JOIN patients p ON p.id=s.patient_id
       LEFT JOIN users u ON u.id=s.guardian_user_id
       WHERE ($1::boolean AND s.status IN ('accepted','superseded'))
          OR (NOT $1::boolean AND s.status IN ('pending_review','changes_requested'))
       ORDER BY s.created_at DESC,s.id DESC LIMIT $2 OFFSET $3`,
      [history, pageSize + 1, offset],
    );
    const hasMore = result.rows.length > pageSize;
    return res.json({ data: { submissions: result.rows.slice(0, pageSize), nextOffset: hasMore ? offset + pageSize : null } });
  });

  app.post('/api/nurse/health-records/:patientId/transcribe', requireRoles('school_nurse'), async (req, res) => {
    const patientId = String(req.params.patientId || '').trim();
    const schoolYear = String(req.body?.schoolYear || '').trim();
    const signatures = req.body?.paperSignaturePresence;
    const validation = normalizeHealthRecordAnswers(req.body?.payload);
    if (!patientId || patientId.length > 120 || !schoolYear || schoolYear.length > 40
      || !signatures || typeof signatures.guardianPresent !== 'boolean' || typeof signatures.studentPresent !== 'boolean') {
      return errorResponse(res, 400, 'VALIDATION_ERROR', 'Patient, school year, answers, and paper signature presence are required.');
    }
    if (!validation.valid) return errorResponse(res, 400, 'VALIDATION_ERROR', 'Review the transcribed health record fields.', validation.errors);
    try {
      const transcribed = await transaction(async (client) => {
        const patient = await client.query("SELECT id FROM patients WHERE id=$1 AND patient_type='student' FOR UPDATE", [patientId]);
        if (!patient.rowCount) {
          const error = new Error('Student patient record not found.');
          error.status = 404;
          error.code = 'PATIENT_NOT_FOUND';
          throw error;
        }
        const guardian = await client.query('SELECT guardian_user_id FROM guardian_patient_links WHERE patient_id=$1 ORDER BY created_at LIMIT 1', [patientId]);
        const revision = await client.query(
          'SELECT COALESCE(MAX(revision),0)+1 AS revision FROM health_record_submissions WHERE patient_id=$1 AND school_year=$2',
          [patientId, schoolYear],
        );
        const id = crypto.randomUUID();
        const result = await client.query(
          `INSERT INTO health_record_submissions(id,patient_id,guardian_user_id,school_year,revision,source,status,payload,paper_signature_presence)
           VALUES($1,$2,$3,$4,$5,'paper','pending_review',$6::jsonb,$7::jsonb)
           RETURNING id,patient_id,school_year,revision,source,status,payload,version,paper_signature_presence,created_at`,
          [id, patientId, guardian.rows[0]?.guardian_user_id || null, schoolYear, revision.rows[0].revision, JSON.stringify(validation.value), JSON.stringify(signatures)],
        );
        const notification = await persistHealthRecordStatusNotifications(client, result.rows[0], { includeNurses: true });
        await audit(req, 'PAPER_HEALTH_RECORD_TRANSCRIBED', { schoolYear, revision: result.rows[0].revision, paperSignaturePresence: signatures }, 'health_record_submission', id, client);
        return { submission: result.rows[0], notification };
      });
      await deliverHealthRecordStatusNotice(transcribed.notification);
      return res.status(201).json({ data: { submission: transcribed.submission } });
    } catch (error) {
      if (error.status) return errorResponse(res, error.status, error.code, error.message);
      throw error;
    }
  });

  app.post('/api/nurse/health-record-submissions/:id/review', requireRoles('school_nurse'), async (req, res) => {
    const submissionId = String(req.params.id || '');
    const expectedVersion = Number(req.body?.version);
    const action = String(req.body?.action || '');
    const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim() : '';
    const receiptValidation = normalizeDocumentReceiptStatus(req.body?.documentsReceived);
    if (!validUuid(submissionId) || !Number.isInteger(expectedVersion) || expectedVersion < 1
      || !['accept', 'request_changes'].includes(action) || notes.length > 2000 || !receiptValidation.valid) {
      return errorResponse(res, 400, 'VALIDATION_ERROR', 'Provide a valid review action, version, and notes.');
    }
    try {
      const reviewResult = await transaction(async (client) => {
        const locked = await client.query('SELECT * FROM health_record_submissions WHERE id=$1 FOR UPDATE', [submissionId]);
        if (!locked.rowCount) {
          const error = new Error('Health record submission not found.');
          error.status = 404;
          error.code = 'NOT_FOUND';
          throw error;
        }
        const submission = locked.rows[0];
        if (Number(submission.version) !== expectedVersion) {
          const error = new Error('This submission changed in another session. Reload it before reviewing.');
          error.status = 409;
          error.code = 'VERSION_CONFLICT';
          throw error;
        }
        if (!['pending_review', 'changes_requested'].includes(submission.status)) {
          const error = new Error('This submission is no longer awaiting review.');
          error.status = 409;
          error.code = 'SUBMISSION_ALREADY_REVIEWED';
          throw error;
        }
        const paperSignatureValidation = action === 'accept' ? validatePaperSignatureForAcceptance(submission) : { valid: true };
        if (!paperSignatureValidation.valid) {
          const error = new Error(paperSignatureValidation.message);
          error.status = paperSignatureValidation.status;
          error.code = paperSignatureValidation.code;
          throw error;
        }
        let lockedPatient = null;
        if (action === 'accept') {
          lockedPatient = await client.query("SELECT data FROM patients WHERE id=$1 AND patient_type='student' FOR UPDATE", [submission.patient_id]);
          if (!lockedPatient.rowCount) {
            const error = new Error('Student patient record not found.');
            error.status = 404;
            error.code = 'PATIENT_NOT_FOUND';
            throw error;
          }
          const newer = await client.query(
            `SELECT id FROM health_record_submissions
             WHERE patient_id=$1 AND id<>$2
               AND ((school_year=$3 AND revision>$4 AND status IN ('pending_review','changes_requested','accepted'))
                 OR (status='accepted' AND created_at>$5)) LIMIT 1`,
            [submission.patient_id, submission.id, submission.school_year, submission.revision, submission.created_at],
          );
          if (newer.rowCount) {
            const error = new Error('A newer revision exists. Review the most recent submission before accepting this one.');
            error.status = 409;
            error.code = 'STALE_SUBMISSION';
            throw error;
          }
        }
        const currentPayload = normalizeHealthRecordAnswers(submission.payload);
        if (!currentPayload.valid) {
          const error = new Error('The stored submission failed validation and cannot be accepted.');
          error.status = 409;
          error.code = 'SUBMISSION_INVALID';
          throw error;
        }
        if (action === 'accept') {
          const acceptedAnswers = acceptedProfileFields(currentPayload.value, lockedPatient.rows[0].data || {});
          const receiptStatus = receiptValidation.value || submission.documents_received || {};
          const nextProfile = { ...(lockedPatient.rows[0].data || {}), ...acceptedAnswers, documentsReceived: receiptStatus, guardianHealthRecord: acceptedAnswers };
          await client.query('UPDATE patients SET data=$1::jsonb,updated_at=NOW() WHERE id=$2', [JSON.stringify(nextProfile), submission.patient_id]);
        }
        const status = action === 'accept' ? 'accepted' : 'changes_requested';
        if (action === 'accept') {
          await client.query(
            `UPDATE health_record_submissions SET status='superseded',version=version+1,updated_at=NOW()
             WHERE patient_id=$1 AND school_year=$2 AND id<>$3 AND revision<$4
               AND status IN ('pending_review','changes_requested')`,
            [submission.patient_id, submission.school_year, submissionId, submission.revision],
          );
        }
        const result = await client.query(
          `UPDATE health_record_submissions
           SET status=$1,nurse_reviewed_by=$2,nurse_reviewed_at=NOW(),nurse_notes=$3,
               documents_received=COALESCE($4::jsonb,documents_received),version=version+1,updated_at=NOW()
           WHERE id=$5 RETURNING id,patient_id,school_year,revision,source,status,version,nurse_notes,nurse_reviewed_at,documents_received`,
          [status, req.user.id, notes, receiptValidation.value ? JSON.stringify(receiptValidation.value) : null, submissionId],
        );
        const notification = await persistHealthRecordStatusNotifications(client, result.rows[0]);
        await audit(req, action === 'accept' ? 'HEALTH_RECORD_SUBMISSION_ACCEPTED' : 'HEALTH_RECORD_CHANGES_REQUESTED', { schoolYear: submission.school_year, revision: submission.revision, documentsReceived: receiptValidation.value ? Object.keys(receiptValidation.value).filter((key) => receiptValidation.value[key]) : undefined }, 'health_record_submission', submissionId, client);
        return { submission: result.rows[0], notification };
      });
      await deliverHealthRecordStatusNotice(reviewResult.notification);
      return res.json({ data: { submission: reviewResult.submission } });
    } catch (error) {
      if (error.status) return errorResponse(res, error.status, error.code, error.message);
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
          `SELECT id FROM patients WHERE LOWER(${patientRosterIdentitySql(2)})=LOWER(BTRIM($1,$2)) LIMIT 1`,
          [record.facultyId, rosterIdTrimCharacters],
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

  app.post('/api/visits/arrivals', requireRoles('school_nurse'), async (req, res) => {
    const validation = validateClinicArrivalPayload(req.body || {});
    if (!validation.valid) return errorResponse(res, 400, 'VALIDATION_ERROR', 'Select a student and try again.', validation.fields);
    const { patientId, eventId } = validation.value;
    const recorded = await recordClinicArrival({ transaction, patientId, eventId, userId: req.user.id });
    if (recorded.status === 'not_found') return errorResponse(res, 404, 'PATIENT_NOT_FOUND', 'The selected student was not found.');
    if (recorded.status === 'not_student') return errorResponse(res, 400, 'STUDENT_REQUIRED', 'Arrival notifications are available for student patients only.');
    if (recorded.status === 'conflict') return errorResponse(res, 409, 'ARRIVAL_IDEMPOTENCY_CONFLICT', 'This arrival request id is already associated with a different student.');

    const dedupeKey = `clinic-arrival:${eventId}`;
    if (recorded.status === 'existing') {
      let notification;
      try {
        notification = await notificationDeliveryForDedupe(dedupeKey, patientId);
      } catch (error) {
        console.error('Arrival notification status lookup failed:', error.message);
        notification = { recipientCount: 0, emailSentCount: 0, emailFailedCount: 0, deliveryUnavailable: true };
      }
      return res.json({ data: {
        arrival: { id: recorded.arrival.id, patientId: recorded.arrival.patient_id, occurredAt: recorded.arrival.occurred_at },
        alreadyRecorded: true,
        notification,
      } });
    }

    let notification;
    let clinicName = 'Campus Clinic';
    try {
      const settings = await query('SELECT data FROM clinic_settings WHERE id=1');
      clinicName = settings.rows[0]?.data?.clinicName || clinicName;
    } catch (error) {
      console.error('Arrival clinic-name lookup failed:', error.message);
    }
    try {
      const notice = clinicArrivalNotice({
        studentName: recorded.patient.data?.name,
        clinicName,
        occurredAt: recorded.arrival.occurred_at,
      });
      notification = await notifyLinkedUsers(patientId, { ...notice, dedupeKey });
    } catch (error) {
      console.error('Arrival notification failed:', error.message);
      notification = { recipientCount: 0, emailSentCount: 0, emailFailedCount: 0, deliveryUnavailable: true };
    }
    return res.status(201).json({ data: {
      arrival: { id: recorded.arrival.id, patientId: recorded.arrival.patient_id, occurredAt: recorded.arrival.occurred_at },
      alreadyRecorded: false,
      notification,
    } });
  });

  app.post('/api/visits', requireRoles(...clinicalWriteRoles), async (req, res) => {
    const validation = validateVisitPayload(req.body || {});
    if (!validation.valid) return errorResponse(res, 400, 'VALIDATION_ERROR', 'Review the visit fields and try again.', validation.fields);
    const input = validation.value;
    const requestId = req.body?.requestId === undefined ? null : req.body.requestId;
    if (requestId !== null && !validVisitRequestId(requestId)) return errorResponse(res, 400, 'INVALID_VISIT_REQUEST_ID', 'A valid visit request id is required.');
    const requestFingerprint = requestId ? visitRequestFingerprint(input) : null;
    if (input.summaryApproved && req.user.role !== 'school_nurse') {
      return errorResponse(res, 403, 'NURSE_APPROVAL_REQUIRED', 'Only a school nurse can approve a consultation summary.');
    }
    let visit;
    let assessment;
    let patientName = '';
    let patientType = '';
    let replayed = false;
    const visitId = requestId || crypto.randomUUID();

    if (requestId) {
      const existing = await findVisitRequest(query, requestId, req.user.id, requestFingerprint);
      if (existing?.kind === 'conflict') return errorResponse(res, 409, 'VISIT_REQUEST_CONFLICT', 'This visit request cannot be matched safely. Check the patient visit history before starting another visit.');
      if (existing?.kind === 'replay') {
        visit = existing.visit;
        assessment = existing.assessment;
        patientType = existing.patientType;
        patientName = existing.patientName;
        replayed = true;
      }
    }

    if (!replayed) {
      const rules = await latestRules();
      const recent = await query('SELECT COUNT(*)::int AS count FROM visits WHERE patient_id=$1', [input.patientId]);
      assessment = assessRisk(visitRiskInput(input, recent.rows[0]?.count || 0), rules);
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

      try {
        const outcome = await clinicDataTransaction((client) => createOrReplayVisitRequest(client, {
          requestId,
          userId: req.user.id,
          fingerprint: requestFingerprint,
          create: async () => {
            const patient = await client.query('SELECT id,patient_type,data FROM patients WHERE id=$1 FOR SHARE', [input.patientId]);
            if (!patient.rowCount) {
              const error = new Error('The selected patient was not found.');
              error.status = 404;
              error.code = 'PATIENT_NOT_FOUND';
              throw error;
            }
            patientType = patient.rows[0].patient_type;
            patientName = patient.rows[0].data?.name || '';
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
              ...(requestId ? { _requestFingerprint: requestFingerprint } : {}),
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
            return { visit, assessment, patientName, patientType };
          },
        }));
        if (outcome.kind === 'conflict') return errorResponse(res, 409, 'VISIT_REQUEST_CONFLICT', 'This visit request cannot be matched safely. Check the patient visit history before starting another visit.');
        const saved = outcome.kind === 'replay' ? outcome : outcome.value;
        ({ visit, assessment, patientName, patientType } = saved);
        replayed = outcome.kind === 'replay';
      } catch (error) {
        if (error.status) return errorResponse(res, error.status, error.code || 'VISIT_SAVE_FAILED', error.message);
        throw error;
      }
    }
    let guardianNotification = { recipientCount: 0, emailSentCount: 0, emailFailedCount: 0, skipped: patientType !== 'student' };
    if (patientType === 'student') {
      try {
        const notice = clinicVisitCareSummary({ studentName: patientName, visit });
        guardianNotification = replayed
          ? await notificationDeliveryForDedupe(`visit:${visit.id}`, input.patientId)
          : await notifyLinkedUsers(input.patientId, { ...notice, dedupeKey: `visit:${visit.id}` });
      } catch (error) {
        console.error('Visit notification failed:', error.message);
        guardianNotification = { recipientCount: 0, emailSentCount: 0, emailFailedCount: 0, deliveryUnavailable: true };
      }
    }
    return res.status(replayed ? 200 : 201).json({ data: { visit: publicVisitRecord(visit), assessment, replayed, summaryPendingApproval: Boolean(input.summaryDraft && !input.summaryApproved), guardianNotification } });
  });

  app.get('/api/risk/rules', requireRoles(...reportReadRoles), async (req, res) => {
    const result = await query('SELECT id,version,name,status,rules,approved_by,approved_at,created_at FROM risk_rules ORDER BY version DESC');
    const currentUserLicenseVerified = Boolean(req.user.prc_license_number?.trim() && req.user.prc_license_verified_at && req.user.prc_license_verified_by);
    return res.json({ data: { rules: result.rows, demonstrationRules: getDemonstrationRules(), candidateRuleDraft: getConservativeCandidateRuleDraft(), currentUserLicenseVerified } });
  });

  app.post('/api/risk/rules/conservative-candidate', requireRoles('school_nurse', 'system_administrator'), async (req, res) => {
    let candidate;
    try {
      candidate = await transaction((client) => ensureConservativeCandidateDraft(client));
    } catch (error) {
      if (error.status) return errorResponse(res, error.status, error.code || 'RISK_RULE_CREATE_FAILED', error.message);
      if (error.code !== '23505') throw error;
      try {
        candidate = await transaction((client) => ensureConservativeCandidateDraft(client));
      } catch (retryError) {
        if (retryError.status) return errorResponse(res, retryError.status, retryError.code || 'RISK_RULE_CREATE_FAILED', retryError.message);
        if (retryError.code === '23505') return errorResponse(res, 409, 'VERSION_EXISTS', 'A rule version was created at the same time. Try again to create the next version.');
        throw retryError;
      }
    }
    if (candidate.created) await audit(req, 'RISK_RULE_CREATED', { version: candidate.version, status: candidate.status, candidate: 'conservative_triage_v1' }, 'risk_rule', candidate.id);
    return res.status(candidate.created ? 201 : 200).json({ data: candidate });
  });

  app.post('/api/risk/rules', requireRoles('school_nurse', 'system_administrator'), async (req, res) => {
    const hasRequestedVersion = Boolean(req.body && Object.hasOwn(req.body, 'version'));
    const rawVersion = req.body?.version;
    const requestedVersion = !hasRequestedVersion ? undefined
      : typeof rawVersion === 'number' ? rawVersion
        : typeof rawVersion === 'string' && rawVersion.trim() ? Number(rawVersion) : Number.NaN;
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const rules = req.body?.rules;
    if (hasRequestedVersion && (!Number.isSafeInteger(requestedVersion) || requestedVersion < 1 || requestedVersion > 2147483647)) return errorResponse(res, 400, 'VALIDATION_ERROR', 'If supplied, version must be a positive whole number within the supported range.');
    if (!name || name.length > 120) return errorResponse(res, 400, 'VALIDATION_ERROR', 'Enter a rule name from 1 to 120 characters.');
    const validation = validateRiskRules(rules);
    if (!validation.valid) return errorResponse(res, 400, 'VALIDATION_ERROR', validation.message);
    let draft;
    try {
      draft = await transaction(async (client) => {
        const created = await createRiskRuleDraft(client, { name, rules, version: requestedVersion });
        await audit(req, 'RISK_RULE_CREATED', { version: created.version, status: created.status }, 'risk_rule', created.id, client);
        return created;
      });
    } catch (error) {
      if (error.status) return errorResponse(res, error.status, error.code || 'RISK_RULE_CREATE_FAILED', error.message);
      if (error.code === '23505') return errorResponse(res, 409, 'VERSION_EXISTS', 'That risk-rule version already exists.');
      throw error;
    }
    return res.status(201).json({ data: draft });
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
                  OR EXISTS(SELECT 1 FROM student_incidents WHERE patient_id=p.id)
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
    if (!isValidAppointmentDate(start) || !isValidAppointmentDate(end) || start > end || (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) > 366 * 86400000) return errorResponse(res, 400, 'INVALID_PERIOD', 'Provide a valid report date range of one year or less.');
    return res.json({ data: visibleReport(buildClinicReport(await loadClinicData(req.user, { includeClinical: true }), start, end), req.user) });
  });

  app.get('/api/reports/patients/:patientId/summary', requireRoles('school_nurse'), async (req, res) => {
    const { start, end } = req.query;
    const range = validateSummaryRange(String(start || ''), String(end || ''));
    if (!range.valid) return errorResponse(res, 400, 'INVALID_PERIOD', 'Provide a valid report date range of one year or less.');
    const patientResult = await query('SELECT id,patient_type,data FROM patients WHERE id=$1', [String(req.params.patientId || '')]);
    const patient = patientResult.rows[0];
    if (!patient) return errorResponse(res, 404, 'PATIENT_NOT_FOUND', 'The selected patient record is unavailable.');
    const visitsResult = await query(
      `SELECT v.id,
         jsonb_build_object(
           'date',COALESCE(NULLIF(v.data->>'date',''),NULLIF(LEFT(v.data->>'createdAt',10),'')),
           'time',v.data->'time','type',v.data->'type','chiefComplaint',v.data->'chiefComplaint',
           'treatment',v.data->'treatment','disposition',v.data->'disposition',
           'followUp',v.data->'followUp','followUpDate',v.data->'followUpDate',
           'nurseName',COALESCE(NULLIF(v.data->>'nurseName',''),u.name),
           'summaryApprovedBy',CASE WHEN NULLIF(v.data->>'summaryApprovedBy','') IS NOT NULL THEN 'approved' ELSE NULL END,
           'consultationSummary',CASE WHEN NULLIF(v.data->>'summaryApprovedBy','') IS NOT NULL THEN v.data->'consultationSummary' ELSE NULL END
         ) AS data
       FROM visits v LEFT JOIN users u ON u.id=v.created_by
       WHERE v.patient_id=$1
         AND COALESCE(NULLIF(v.data->>'date',''),NULLIF(LEFT(v.data->>'createdAt',10),'')) >= $2
         AND COALESCE(NULLIF(v.data->>'date',''),NULLIF(LEFT(v.data->>'createdAt',10),'')) <= $3
       ORDER BY COALESCE(NULLIF(v.data->>'date',''),NULLIF(LEFT(v.data->>'createdAt',10),'')) DESC,
         COALESCE(NULLIF(v.data->>'time',''),'') DESC,v.id DESC`,
      [patient.id, range.start, range.end],
    );
    const summary = patientSummaryForRange({ patient, visits: visitsResult.rows, start: range.start, end: range.end });
    return res.json({ data: summary });
  });

  app.get('/api/appointments/slots', requireAuth, async (req, res) => {
    const date = String(req.query.date || '');
    if (!isValidAppointmentDate(date)) return errorResponse(res, 400, 'INVALID_DATE', 'Provide a real date in YYYY-MM-DD format.');
    const [settingsResult, existing, blocked, visits] = await Promise.all([
      query('SELECT data FROM clinic_settings WHERE id=1'),
      query("SELECT starts_at FROM appointments WHERE (starts_at AT TIME ZONE 'Asia/Manila')::date=$1::date AND status NOT IN ('Cancelled','Rejected')", [date]),
      query('SELECT starts_at,ends_at,reason FROM appointment_unavailable_periods WHERE clinic_date=$1::date', [date]),
      query("SELECT created_at FROM visits WHERE created_at >= NOW()-INTERVAL '90 days' AND created_at < NOW() AND data->>'historicalImport' IS DISTINCT FROM 'true'"),
    ]);
    const schedule = appointmentSettings(settingsResult.rows[0]?.data || {});
    const now = new Date();
    const freeSlots = generateAppointmentSlots(date, existing.rows.map((row) => row.starts_at), { ...schedule, now })
      .filter((slot) => !unavailablePeriodsForSlot(slot.startsAt, schedule.durationMinutes, blocked.rows));
    const suggestions = rankAppointmentSlots(date, freeSlots, visits.rows.map((row) => row.created_at), schedule);
    const slots = suggestions.slots.map(({ local, startsAt, suggestionRank }) => ({ local, startsAt, suggestionRank }));
    const traffic = {
      historyAvailable: Boolean(suggestions.traffic.historyAvailable),
      lookbackDays: suggestions.traffic.lookbackDays,
    };
    return res.json({ data: { date, slots, traffic, schedule } });
  });

  app.get('/api/nurse/appointment-unavailable-periods', requireRoles(...clinicalWriteRoles), async (req, res) => {
    const start = String(req.query.start || '');
    const end = String(req.query.end || '');
    if ((start && !isValidAppointmentDate(start)) || (end && !isValidAppointmentDate(end)) || (start && end && start > end)) {
      return errorResponse(res, 400, 'INVALID_PERIOD', 'Provide a valid Manila date range.');
    }
    const result = await query(
      `SELECT id,to_char(clinic_date,'YYYY-MM-DD') AS date,starts_at,ends_at,reason,created_at
       FROM appointment_unavailable_periods
       WHERE ($1::date IS NULL OR clinic_date >= $1::date) AND ($2::date IS NULL OR clinic_date <= $2::date)
       ORDER BY clinic_date,starts_at,id LIMIT 500`,
      [start || null, end || null],
    );
    return res.json({ data: { periods: result.rows } });
  });

  app.post('/api/nurse/appointment-unavailable-periods', requireRoles(...clinicalWriteRoles), async (req, res) => {
    const validation = validateUnavailablePeriod(req.body);
    if (!validation.valid) return errorResponse(res, 400, validation.code, validation.message);
    const { date, startsAt, endsAt, reason } = validation.value;
    const id = crypto.randomUUID();
    try {
      const conflicts = await transaction(async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`appointment-day:${date}`]);
        const [appointments, settingsResult] = await Promise.all([
          client.query(
            `SELECT a.id,a.patient_id,a.starts_at,a.status,p.data->>'name' AS patient_name,
                    p.data->>'studentId' AS student_id,p.data->>'facultyId' AS faculty_id
             FROM appointments a JOIN patients p ON p.id=a.patient_id
             WHERE (a.starts_at AT TIME ZONE 'Asia/Manila')::date=$1::date
               AND a.status NOT IN ('Cancelled','Rejected')`, [date],
          ),
          client.query('SELECT data FROM clinic_settings WHERE id=1'),
        ]);
        const duration = appointmentSettings(settingsResult.rows[0]?.data || {}).durationMinutes;
        const overlaps = appointmentRowsOverlappingPeriod(appointments.rows, startsAt, endsAt, duration);
        if (overlaps.length) return overlaps.map((row) => ({ id: row.id, patientId: row.patient_id, patientName: row.patient_name || '', studentId: row.student_id || row.faculty_id || '', startsAt: row.starts_at, status: normalizeAppointmentStatus(row.status) }));
        await client.query(
          'INSERT INTO appointment_unavailable_periods(id,clinic_date,starts_at,ends_at,reason,created_by) VALUES($1,$2::date,$3,$4,$5,$6)',
          [id, date, startsAt, endsAt, reason, req.user.id],
        );
        await audit(req, 'APPOINTMENT_UNAVAILABLE_PERIOD_CREATED', { date, fullDay: validation.value.fullDay }, 'appointment_unavailable_period', id, client);
        return [];
      });
      if (conflicts.length) return res.status(409).json({ error: { code: 'APPOINTMENT_CONFLICT', message: 'Resolve these appointments before blocking the selected time.', conflicts } });
    } catch (error) {
      if (error.code === '23505') return errorResponse(res, 409, 'PERIOD_CONFLICT', 'An unavailable period already exists for this request.');
      throw error;
    }
    return res.status(201).json({ data: { id, date, startsAt, endsAt, reason } });
  });

  app.delete('/api/nurse/appointment-unavailable-periods/:id', requireRoles(...clinicalWriteRoles), async (req, res) => {
    if (!validUuid(req.params.id)) return errorResponse(res, 400, 'INVALID_PERIOD', 'The unavailable period identifier is invalid.');
    const deleted = await transaction(async (client) => {
      const selected = await client.query('SELECT id,clinic_date FROM appointment_unavailable_periods WHERE id=$1 FOR UPDATE', [req.params.id]);
      if (!selected.rowCount) return null;
      const date = selected.rows[0].clinic_date.toISOString?.().slice(0, 10) || String(selected.rows[0].clinic_date).slice(0, 10);
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`appointment-day:${date}`]);
      const result = await client.query('DELETE FROM appointment_unavailable_periods WHERE id=$1 RETURNING id', [req.params.id]);
      await audit(req, 'APPOINTMENT_UNAVAILABLE_PERIOD_REMOVED', { date }, 'appointment_unavailable_period', req.params.id, client);
      return result.rows[0] || null;
    });
    if (!deleted) return errorResponse(res, 404, 'NOT_FOUND', 'Unavailable period not found.');
    return res.json({ data: { success: true } });
  });

  app.post('/api/reports/snapshots', requireRoles(...reportReadRoles), async (req, res) => {
    const { start, end, type = 'custom' } = req.body || {};
    if (!isValidAppointmentDate(start) || !isValidAppointmentDate(end) || start > end || (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) > 366 * 86400000) {
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
    const result = await query("SELECT id,report_type,to_char(period_start, 'YYYY-MM-DD') AS period_start,to_char(period_end, 'YYYY-MM-DD') AS period_end,source,data,created_at FROM report_snapshots ORDER BY created_at DESC LIMIT 100");
    return res.json({ data: { snapshots: result.rows.map((snapshot) => ({ ...snapshot, data: visibleReport(reportSnapshotForStorage(snapshot.data || {}), req.user) })) } });
  });

  app.get('/api/notifications', requireAuth, async (req, res) => {
    const result = await listInAppNotifications(req.user.id, query);
    return res.json({ data: { notifications: result.rows } });
  });

  app.patch('/api/notifications/:id/read', requireAuth, async (req, res) => {
    const result = await markInAppNotificationRead(req.params.id, req.user.id, query);
    if (!result.rowCount) return errorResponse(res, 404, 'NOT_FOUND', 'Notification not found.');
    return res.json({ data: { notification: result.rows[0] } });
  });

  app.post('/api/appointments', requireRoles('guardian', ...clinicalWriteRoles), async (req, res) => {
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
        for (const key of sortedManilaDayLockKeys(localDate)) await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key]);
        const [appointments, periods] = await Promise.all([
          client.query("SELECT starts_at,status FROM appointments WHERE (starts_at AT TIME ZONE 'Asia/Manila')::date=$1::date AND status NOT IN ('Cancelled','Rejected')", [localDate]),
          client.query('SELECT starts_at,ends_at FROM appointment_unavailable_periods WHERE clinic_date=$1::date', [localDate]),
        ]);
        const overlaps = appointmentRowsOverlappingPeriod(appointments.rows, startsAt, new Date(startsAt.getTime() + schedule.durationMinutes * 60_000), schedule.durationMinutes);
        if (overlaps.length || unavailablePeriodsForSlot(startsAt, schedule.durationMinutes, periods.rows)) {
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
        const settingsResult = await client.query('SELECT data FROM clinic_settings WHERE id=1');
        const schedule = appointmentSettings(settingsResult.rows[0]?.data || {});
        const localDate = startsAt ? clinicCalendarDate(startsAt) : '';
        const oldLocalDate = currentStartsAt ? clinicCalendarDate(clinicDateTime(currentStartsAt)) : '';
        if (hasReschedule) {
          if (!generateAppointmentSlots(localDate, [], schedule).some((slot) => slot.startsAt === startsAt.toISOString())) {
            const error = new Error('Choose an available weekday slot during clinic hours.');
            error.status = 400;
            error.code = 'OUTSIDE_CLINIC_HOURS';
            throw error;
          }
        }
        for (const key of sortedManilaDayLockKeys(oldLocalDate, localDate)) await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key]);
        const decisionReason = String(req.body?.decisionReason || '').trim();
        if (['Cancelled', 'Rejected'].includes(status) && status !== currentStatus && (!decisionReason || decisionReason.length > 500)) {
          const error = new Error('Enter a decision reason from 1 to 500 characters.');
          error.status = 400;
          error.code = 'DECISION_REASON_REQUIRED';
          throw error;
        }
        const record = { ...row.data, startsAt: startsAt?.toISOString() || null, status };
        if (['Cancelled', 'Rejected'].includes(status) && decisionReason) record.decisionReason = decisionReason;
        if (!['Cancelled', 'Rejected'].includes(status)) {
          const [appointments, periods] = await Promise.all([
            client.query("SELECT starts_at,status FROM appointments WHERE (starts_at AT TIME ZONE 'Asia/Manila')::date=$1::date AND id<>$2 AND status NOT IN ('Cancelled','Rejected')", [localDate, req.params.id]),
            client.query('SELECT starts_at,ends_at FROM appointment_unavailable_periods WHERE clinic_date=$1::date', [localDate]),
          ]);
          const overlaps = appointmentRowsOverlappingPeriod(appointments.rows, startsAt, new Date(startsAt.getTime() + schedule.durationMinutes * 60_000), schedule.durationMinutes);
          if (overlaps.length || unavailablePeriodsForSlot(startsAt, schedule.durationMinutes, periods.rows)) {
            const error = new Error('That appointment time is no longer available.');
            error.status = 409;
            error.code = 'APPOINTMENT_CONFLICT';
            throw error;
          }
        }
        await client.query(
          `UPDATE appointments SET starts_at=$1,status=$2,data=$3::jsonb,updated_at=NOW(),
             decision_reason=CASE WHEN $4 THEN $5 ELSE decision_reason END,
             decided_by=CASE WHEN $4 THEN $6 ELSE decided_by END,
             decided_at=CASE WHEN $4 THEN NOW() ELSE decided_at END
           WHERE id=$7`,
          [startsAt, status, JSON.stringify(record), ['Cancelled', 'Rejected'].includes(status) && status !== currentStatus, decisionReason, req.user.id, req.params.id],
        );
        await audit(req, 'APPOINTMENT_UPDATED', { status, startsAt: startsAt?.toISOString() || null }, 'appointment', req.params.id, client);
        return { appointment: record, patientId: row.patient_id, startsAt, status, decisionReason: record.decisionReason || '' };
      });
    } catch (error) {
      if (error.status) return errorResponse(res, error.status, error.code || 'APPOINTMENT_UPDATE_FAILED', error.message);
      throw error;
    }
    await notifyLinkedUsers(updated.patientId, {
      type: 'appointment',
      subject: 'Clinic appointment updated',
      body: `Your clinic appointment is now ${updated.status.toLowerCase()}${updated.startsAt ? ` for ${updated.startsAt.toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}` : ''}.${updated.decisionReason ? ` Reason: ${updated.decisionReason}` : ''}`,
      dedupeKey: `appointment-update:${req.params.id}:${updated.status}:${updated.startsAt?.toISOString() || 'no-time'}`,
    });
    return res.json({ data: { appointment: updated.appointment } });
  });

  app.get('/api/incidents', requireRoles('guardian', ...clinicalWriteRoles), async (req, res) => {
    const start = String(req.query.start || '');
    const end = String(req.query.end || '');
    if ((start && !isValidAppointmentDate(start)) || (end && !isValidAppointmentDate(end)) || (start && end && start > end)) return errorResponse(res, 400, 'INVALID_PERIOD', 'Provide a valid incident date range.');
    const result = await query(
      `SELECT i.*,to_char(i.incident_date,'YYYY-MM-DD') AS display_date,
         to_char(i.incident_time,'HH24:MI') AS display_time,p.data->>'name' AS patient_name,
         COALESCE(p.data->>'studentId',p.data->>'facultyId','') AS school_id,
         c.guardian_user_id,c.status AS consent_status,c.notice_version,c.updated_at AS consent_updated_at,
         CASE WHEN c.guardian_user_id=$2 THEN true ELSE false END AS is_consent_owner
       FROM student_incidents i JOIN patients p ON p.id=i.patient_id
       LEFT JOIN incident_photo_consents c ON c.incident_id=i.id
       WHERE p.patient_type='student'
         AND ($1='school_nurse' OR EXISTS(SELECT 1 FROM guardian_patient_links l WHERE l.patient_id=i.patient_id AND l.guardian_user_id=$2))
         AND ($3::date IS NULL OR i.incident_date >= $3::date) AND ($4::date IS NULL OR i.incident_date <= $4::date)
       ORDER BY i.incident_date DESC,i.incident_time DESC,i.id DESC LIMIT 200`,
      [req.user.role, req.user.id, start || null, end || null],
    );
    const photosEnabled = incidentPhotosEnabled();
    const incidents = [];
    for (const row of result.rows) {
      const consent = row.consent_status ? { status: row.consent_status, guardian_user_id: row.guardian_user_id, notice_version: row.notice_version, updated_at: row.consent_updated_at, granted_event_id: null } : null;
      let photos = [];
      if (photosEnabled && consent?.status === 'granted' && (req.user.role === 'school_nurse' || row.is_consent_owner)) {
        const photoRows = await query(
          `SELECT p.id,p.content_type,p.size_bytes,p.width,p.height,p.created_at,p.expires_at,p.consent_event_id,
             p.deletion_requested_at,p.deleted_at,c.granted_event_id,c.status AS consent_status
           FROM incident_photos p JOIN incident_photo_consents c ON c.incident_id=p.incident_id
           WHERE p.incident_id=$1 AND c.status='granted' AND p.consent_event_id=c.granted_event_id
             AND p.deletion_requested_at IS NULL AND p.deleted_at IS NULL AND p.expires_at>NOW()
           ORDER BY p.created_at,p.id`, [row.id],
        );
        photos = photoRows.rows.filter((photo) => incidentPhotoReadable({ enabled: photosEnabled, consent: { status: photo.consent_status, granted_event_id: photo.granted_event_id }, photo })).map((photo) => ({ id: photo.id, contentType: photo.content_type, sizeBytes: Number(photo.size_bytes), createdAt: photo.created_at, expiresAt: photo.expires_at }));
      }
      const incident = projectIncident({ ...row, incident_date: row.display_date, incident_time: row.display_time }, { consent: row.is_consent_owner || req.user.role === 'school_nurse' ? consent : null, photos });
      incidents.push({ ...incident, patientName: row.patient_name || 'Student', schoolId: row.school_id });
    }
    return res.json({ data: { incidents, photosEnabled, storageConfigured: Boolean(storageAdapter?.isConfigured?.()) } });
  });

  app.get('/api/incidents/:id', requireRoles('guardian', ...clinicalWriteRoles), async (req, res) => {
    if (!validUuid(req.params.id)) return errorResponse(res, 404, 'NOT_FOUND', 'Incident not found.');
    const result = await query(
      `SELECT i.*,to_char(i.incident_date,'YYYY-MM-DD') AS display_date,to_char(i.incident_time,'HH24:MI') AS display_time,
         p.data->>'name' AS patient_name,COALESCE(p.data->>'studentId',p.data->>'facultyId','') AS school_id,
         c.guardian_user_id,c.status AS consent_status,c.notice_version,c.updated_at AS consent_updated_at,
         CASE WHEN c.guardian_user_id=$3 THEN true ELSE false END AS is_consent_owner
       FROM student_incidents i JOIN patients p ON p.id=i.patient_id LEFT JOIN incident_photo_consents c ON c.incident_id=i.id
       WHERE i.id=$1 AND p.patient_type='student'
         AND ($2='school_nurse' OR EXISTS(SELECT 1 FROM guardian_patient_links l WHERE l.patient_id=i.patient_id AND l.guardian_user_id=$3))`,
      [req.params.id, req.user.role, req.user.id],
    );
    const row = result.rows[0];
    if (!row) return errorResponse(res, 404, 'NOT_FOUND', 'Incident not found.');
    const photosEnabled = incidentPhotosEnabled();
    let photos = [];
    if (photosEnabled && row.consent_status === 'granted' && (req.user.role === 'school_nurse' || row.is_consent_owner)) {
      const rows = await query(
        `SELECT p.id,p.content_type,p.size_bytes,p.width,p.height,p.created_at,p.expires_at,p.consent_event_id,p.deletion_requested_at,p.deleted_at,c.granted_event_id,c.status AS consent_status
         FROM incident_photos p JOIN incident_photo_consents c ON c.incident_id=p.incident_id
         WHERE p.incident_id=$1 AND c.status='granted' AND p.consent_event_id=c.granted_event_id
           AND p.deletion_requested_at IS NULL AND p.deleted_at IS NULL AND p.expires_at>NOW()
         ORDER BY p.created_at,p.id`, [row.id],
      );
      photos = rows.rows.filter((photo) => incidentPhotoReadable({ enabled: photosEnabled, consent: { status: photo.consent_status, granted_event_id: photo.granted_event_id }, photo })).map((photo) => ({ id: photo.id, contentType: photo.content_type, sizeBytes: Number(photo.size_bytes), createdAt: photo.created_at, expiresAt: photo.expires_at }));
    }
    const consent = row.consent_status && (row.is_consent_owner || req.user.role === 'school_nurse')
      ? { status: row.consent_status, guardian_user_id: row.guardian_user_id, notice_version: row.notice_version, updated_at: row.consent_updated_at }
      : null;
    return res.json({ data: { incident: { ...projectIncident({ ...row, incident_date: row.display_date, incident_time: row.display_time }, { consent, photos }), patientName: row.patient_name || 'Student', schoolId: row.school_id }, photosEnabled, storageConfigured: Boolean(storageAdapter?.isConfigured?.()) } });
  });

  app.post('/api/incidents', requireRoles(...clinicalWriteRoles), async (req, res) => {
    const allowed = new Set(['patientId', 'date', 'time', 'location', 'description', 'actionTaken', 'visitId']);
    if (Object.keys(req.body || {}).some((key) => !allowed.has(key))) return errorResponse(res, 400, 'INVALID_FIELDS', 'The incident contains unsupported fields.');
    const validation = validateIncidentPayload(req.body);
    if (!validation.valid) return errorResponse(res, 400, validation.code, validation.message);
    const input = validation.value;
    const id = crypto.randomUUID();
    await transaction(async (client) => {
      const patient = await client.query("SELECT id FROM patients WHERE id=$1 AND patient_type='student'", [input.patientId]);
      if (!patient.rowCount) {
        const error = new Error('Student record not found.'); error.status = 404; error.code = 'PATIENT_NOT_FOUND'; throw error;
      }
      if (input.visitId) {
        const visit = await client.query('SELECT 1 FROM visits WHERE id=$1 AND patient_id=$2', [input.visitId, input.patientId]);
        if (!visit.rowCount) { const error = new Error('Choose a clinic visit for the same student.'); error.status = 400; error.code = 'INVALID_VISIT'; throw error; }
      }
      await client.query(
        `INSERT INTO student_incidents(id,patient_id,incident_date,incident_time,location,description,action_taken,visit_id,created_by,updated_by)
         VALUES($1,$2,$3::date,$4::time,$5,$6,$7,$8,$9,$9)`,
        [id, input.patientId, input.incidentDate, input.incidentTime, input.location, input.description, input.actionTaken, input.visitId, req.user.id],
      );
      await audit(req, 'STUDENT_INCIDENT_CREATED', {}, 'student_incident', id, client);
    }).catch((error) => { throw error; });
    const guardians = await query("SELECT DISTINCT guardian_user_id FROM guardian_patient_links WHERE patient_id=$1", [input.patientId]);
    for (const guardian of guardians.rows) await createNotification({ userId: guardian.guardian_user_id, type: 'incident', subject: 'A student incident report is available', body: 'A school nurse added an incident report for a linked student. Sign in to view it.', dedupeKey: `student-incident:${id}:${guardian.guardian_user_id}` });
    return res.status(201).json({ data: { id } });
  });

  app.patch('/api/incidents/:id', requireRoles(...clinicalWriteRoles), async (req, res) => {
    if (!validUuid(req.params.id)) return errorResponse(res, 404, 'NOT_FOUND', 'Incident not found.');
    const allowed = new Set(['patientId', 'date', 'time', 'location', 'description', 'actionTaken', 'visitId']);
    if (Object.keys(req.body || {}).some((key) => !allowed.has(key))) return errorResponse(res, 400, 'INVALID_FIELDS', 'The incident contains unsupported fields.');
    const validation = validateIncidentPayload(req.body);
    if (!validation.valid) return errorResponse(res, 400, validation.code, validation.message);
    const input = validation.value;
    const result = await transaction(async (client) => {
      const current = await client.query('SELECT patient_id FROM student_incidents WHERE id=$1 FOR UPDATE', [req.params.id]);
      if (!current.rowCount) return null;
      if (String(current.rows[0].patient_id) !== input.patientId) { const error = new Error('An incident cannot be moved to another student.'); error.status = 400; error.code = 'PATIENT_MISMATCH'; throw error; }
      if (input.visitId) {
        const visit = await client.query('SELECT 1 FROM visits WHERE id=$1 AND patient_id=$2', [input.visitId, input.patientId]);
        if (!visit.rowCount) { const error = new Error('Choose a clinic visit for the same student.'); error.status = 400; error.code = 'INVALID_VISIT'; throw error; }
      }
      await client.query(
        `UPDATE student_incidents SET incident_date=$1::date,incident_time=$2::time,location=$3,description=$4,action_taken=$5,visit_id=$6,updated_by=$7,updated_at=NOW() WHERE id=$8`,
        [input.incidentDate, input.incidentTime, input.location, input.description, input.actionTaken, input.visitId, req.user.id, req.params.id],
      );
      await audit(req, 'STUDENT_INCIDENT_UPDATED', {}, 'student_incident', req.params.id, client);
      return { patientId: input.patientId };
    });
    if (!result) return errorResponse(res, 404, 'NOT_FOUND', 'Incident not found.');
    return res.json({ data: { success: true } });
  });

  app.get('/api/incidents/:id/eligible-guardians', requireRoles(...clinicalWriteRoles), async (req, res) => {
    if (!incidentPhotosEnabled()) return errorResponse(res, 404, 'NOT_FOUND', 'Photo consent is unavailable.');
    if (!validUuid(req.params.id)) return errorResponse(res, 404, 'NOT_FOUND', 'Incident not found.');
    const result = await query(
      `SELECT u.id,u.name,COALESCE(NULLIF(u.username,''),u.email) AS account_label
       FROM student_incidents i JOIN patients p ON p.id=i.patient_id
       JOIN guardian_patient_links l ON l.patient_id=i.patient_id
       JOIN users u ON u.id=l.guardian_user_id
       WHERE i.id=$1 AND p.patient_type='student' AND u.role='guardian' AND u.status='active'
       ORDER BY LOWER(u.name),u.id`, [req.params.id],
    );
    return res.json({ data: { guardians: result.rows } });
  });

  app.post('/api/incidents/:id/photo-consent/request', requireRoles(...clinicalWriteRoles), async (req, res) => {
    if (!incidentPhotosEnabled()) return errorResponse(res, 404, 'NOT_FOUND', 'Photo consent is unavailable.');
    if (Object.keys(req.body || {}).some((key) => key !== 'guardianUserId')) return errorResponse(res, 400, 'INVALID_REQUEST', 'The photo request is invalid.');
    if (!validUuid(req.params.id) || !validUuid(req.body?.guardianUserId)) return errorResponse(res, 400, 'INVALID_REQUEST', 'Choose a linked guardian account.');
    const incidentId = req.params.id;
    const guardianUserId = req.body.guardianUserId;
    const result = await transaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`incident-photo-consent:${incidentId}`]);
      const incident = await client.query("SELECT i.patient_id FROM student_incidents i JOIN patients p ON p.id=i.patient_id WHERE i.id=$1 AND p.patient_type='student'", [incidentId]);
      if (!incident.rowCount) return { error: 'NOT_FOUND' };
      const guardian = await client.query(
        "SELECT u.id,u.name FROM users u JOIN guardian_patient_links l ON l.guardian_user_id=u.id WHERE u.id=$1 AND u.role='guardian' AND u.status='active' AND l.patient_id=$2",
        [guardianUserId, incident.rows[0].patient_id],
      );
      if (!guardian.rowCount) return { error: 'GUARDIAN_NOT_LINKED' };
      const prior = await client.query('SELECT * FROM incident_photo_consents WHERE incident_id=$1 FOR UPDATE', [incidentId]);
      if (prior.rowCount && String(prior.rows[0].guardian_user_id) !== guardianUserId) return { error: 'CONSENT_OWNER_EXISTS' };
      if (prior.rowCount && ['pending', 'granted'].includes(prior.rows[0].status)) return { error: 'CONSENT_ALREADY_ACTIVE' };
      const eventId = crypto.randomUUID();
      await client.query(
        `INSERT INTO incident_photo_consent_events(id,incident_id,guardian_user_id,event_type,notice_version,actor_user_id)
         VALUES($1,$2,$3,'requested',$4,$5)`, [eventId, incidentId, guardianUserId, INCIDENT_PHOTO_NOTICE_VERSION, req.user.id],
      );
      if (prior.rowCount) {
        await client.query(
          `UPDATE incident_photo_consents SET status='pending',notice_version=$2,granted_event_id=NULL,last_event_id=$3,updated_by=$4,updated_at=NOW()
           WHERE incident_id=$1`, [incidentId, INCIDENT_PHOTO_NOTICE_VERSION, eventId, req.user.id],
        );
      } else {
        await client.query(
          `INSERT INTO incident_photo_consents(incident_id,guardian_user_id,status,notice_version,granted_event_id,last_event_id,updated_by)
           VALUES($1,$2,'pending',$3,NULL,$4,$5)`, [incidentId, guardianUserId, INCIDENT_PHOTO_NOTICE_VERSION, eventId, req.user.id],
        );
      }
      await client.query(
        `UPDATE incident_photos SET deletion_requested_at=COALESCE(deletion_requested_at,NOW()) WHERE incident_id=$1 AND deleted_at IS NULL`, [incidentId],
      );
      await client.query(
        `INSERT INTO incident_photo_deletion_tasks(id,photo_id,storage_key,reason,available_at)
         SELECT gen_random_uuid(),p.id,p.storage_key,'revoked',NOW() FROM incident_photos p WHERE p.incident_id=$1 AND p.deleted_at IS NULL
         ON CONFLICT(storage_key) DO UPDATE SET available_at=LEAST(incident_photo_deletion_tasks.available_at,EXCLUDED.available_at),reason='revoked'`, [incidentId],
      );
      await audit(req, 'INCIDENT_PHOTO_CONSENT_REQUESTED', { noticeVersion: INCIDENT_PHOTO_NOTICE_VERSION }, 'student_incident', incidentId, client);
      return { guardian: guardian.rows[0] };
    });
    if (result.error === 'NOT_FOUND') return errorResponse(res, 404, 'NOT_FOUND', 'Incident not found.');
    if (result.error) return errorResponse(res, 409, result.error, result.error === 'GUARDIAN_NOT_LINKED' ? 'Choose an active guardian linked to this student.' : 'A photo request for this incident already belongs to another active review.');
    await createNotification({ userId: guardianUserId, type: 'incident_photo_consent', subject: 'Photo consent requested', body: 'A school nurse has requested your decision about photos for a linked student incident. Review the request after signing in.', dedupeKey: `incident-photo-consent:${incidentId}:requested:${Date.now()}` });
    return res.status(201).json({ data: { status: 'pending', guardianName: result.guardian.name } });
  });

  app.patch('/api/incidents/:id/photo-consent', requireRoles('guardian'), async (req, res) => {
    if (!incidentPhotosEnabled()) return errorResponse(res, 404, 'NOT_FOUND', 'Photo consent is unavailable.');
    if (!validUuid(req.params.id) || Object.keys(req.body || {}).some((key) => !['decision', 'noticeVersion'].includes(key))) return errorResponse(res, 400, 'INVALID_REQUEST', 'The photo-consent response is invalid.');
    const result = await transaction(async (client) => {
      const incident = await client.query(
        `SELECT i.patient_id FROM student_incidents i JOIN patients p ON p.id=i.patient_id
         JOIN guardian_patient_links l ON l.patient_id=i.patient_id AND l.guardian_user_id=$2
         WHERE i.id=$1 AND p.patient_type='student'`, [req.params.id, req.user.id],
      );
      if (!incident.rowCount) return { error: 'NOT_FOUND' };
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`incident-photo-consent:${req.params.id}`]);
      const current = await client.query('SELECT * FROM incident_photo_consents WHERE incident_id=$1 FOR UPDATE', [req.params.id]);
      if (!current.rowCount || String(current.rows[0].guardian_user_id) !== String(req.user.id)) return { error: 'NOT_FOUND' };
      const validation = validateIncidentPhotoDecision(req.body, current.rows[0]);
      if (!validation.valid) return { error: validation.code, message: validation.message };
      const { decision, noticeVersion } = validation.value;
      const eventId = crypto.randomUUID();
      await client.query(
        `INSERT INTO incident_photo_consent_events(id,incident_id,guardian_user_id,event_type,notice_version,actor_user_id)
         VALUES($1,$2,$3,$4,$5,$3)`, [eventId, req.params.id, req.user.id, decision, noticeVersion],
      );
      await client.query(
        `UPDATE incident_photo_consents SET status=$2,notice_version=$3,granted_event_id=$4,last_event_id=$5,updated_by=$6,updated_at=NOW()
         WHERE incident_id=$1`, [req.params.id, decision, noticeVersion, decision === 'granted' ? eventId : null, eventId, req.user.id],
      );
      if (decision === 'revoked' || decision === 'declined') {
        await client.query('UPDATE incident_photos SET deletion_requested_at=COALESCE(deletion_requested_at,NOW()) WHERE incident_id=$1 AND deleted_at IS NULL', [req.params.id]);
        await client.query(
          `INSERT INTO incident_photo_deletion_tasks(id,photo_id,storage_key,reason,available_at)
           SELECT gen_random_uuid(),p.id,p.storage_key,'revoked',NOW() FROM incident_photos p WHERE p.incident_id=$1 AND p.deleted_at IS NULL
           ON CONFLICT(storage_key) DO UPDATE SET available_at=LEAST(incident_photo_deletion_tasks.available_at,EXCLUDED.available_at),reason='revoked'`, [req.params.id],
        );
      }
      await audit(req, 'INCIDENT_PHOTO_CONSENT_DECIDED', { decision, noticeVersion }, 'student_incident', req.params.id, client);
      return { status: decision };
    });
    if (result.error === 'NOT_FOUND') return errorResponse(res, 404, 'NOT_FOUND', 'Photo request not found.');
    if (result.error) return errorResponse(res, 400, result.error, result.message);
    return res.json({ data: { status: result.status } });
  });

  app.post('/api/incidents/:id/photos', requireRoles(...clinicalWriteRoles), async (req, res) => {
    if (!incidentPhotosEnabled()) return errorResponse(res, 404, 'NOT_FOUND', 'Incident photos are disabled.');
    if (!validUuid(req.params.id) || Object.keys(req.body || {}).some((key) => !['contentType', 'dataBase64'].includes(key))) return errorResponse(res, 400, 'INVALID_REQUEST', 'The photo upload is invalid.');
    if (!storageAdapter?.isConfigured?.() || !storageAdapter?.bucket) return errorResponse(res, 503, 'PHOTO_STORAGE_UNAVAILABLE', 'Private incident photo storage is not configured.');
    let image;
    try { image = validateRasterImageBase64(req.body?.dataBase64, { maxBytes: 2 * 1024 * 1024 }); }
    catch { return errorResponse(res, 400, 'INVALID_IMAGE', 'Upload a valid PNG, JPEG, or WebP image no larger than 2 MiB.'); }
    if (String(req.body?.contentType || '') !== image.contentType) return errorResponse(res, 400, 'CONTENT_TYPE_MISMATCH', 'The image type does not match its file contents.');
    const photoId = crypto.randomUUID();
    const extension = image.contentType === 'image/jpeg' ? 'jpg' : image.contentType.slice('image/'.length);
    const storageKey = `incidents/${req.params.id}/${photoId}.${extension}`;
    const taskId = crypto.randomUUID();
    const preflight = await query(
      `SELECT c.granted_event_id FROM student_incidents i JOIN patients p ON p.id=i.patient_id
       JOIN incident_photo_consents c ON c.incident_id=i.id
       WHERE i.id=$1 AND p.patient_type='student' AND c.status='granted'`, [req.params.id],
    );
    if (!preflight.rowCount) return errorResponse(res, 409, 'PHOTO_CONSENT_REQUIRED', 'Current guardian photo consent is required before upload.');
    const grantedEventId = preflight.rows[0].granted_event_id;
    await transaction(async (client) => {
      await client.query(
        `INSERT INTO incident_photo_deletion_tasks(id,photo_id,storage_key,reason,available_at,leased_at)
         VALUES($1,NULL,$2,'orphan_upload',NOW()+INTERVAL '1 day',NOW())`, [taskId, storageKey],
      );
    });
    try {
      await storageAdapter.upload(storageAdapter.bucket, storageKey, image.bytes, image.contentType);
    } catch (storageError) {
      try { await query('UPDATE incident_photo_deletion_tasks SET available_at=NOW(),leased_at=NULL,last_error_code=$2 WHERE id=$1', [taskId, String(storageError.code || 'STORAGE_WRITE_FAILED').slice(0, 60)]); } catch { /* durable quarantine record remains delayed for cleanup retry */ }
      return errorResponse(res, 503, 'PHOTO_STORAGE_UNAVAILABLE', 'The photo could not be stored. Try again later.');
    }
    try {
      await transaction(async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`incident-photo-consent:${req.params.id}`]);
        const consent = await client.query('SELECT status,granted_event_id FROM incident_photo_consents WHERE incident_id=$1 FOR UPDATE', [req.params.id]);
        if (!incidentPhotosEnabled() || !consent.rowCount || consent.rows[0].status !== 'granted' || String(consent.rows[0].granted_event_id) !== String(grantedEventId)) {
          const error = new Error('Photo consent changed during upload.'); error.status = 409; error.code = 'CONSENT_CHANGED'; throw error;
        }
        const count = await client.query('SELECT COUNT(*)::int AS total FROM incident_photos WHERE incident_id=$1 AND deleted_at IS NULL AND deletion_requested_at IS NULL AND expires_at>NOW()', [req.params.id]);
        if (count.rows[0].total >= 3) { const error = new Error('An incident can have up to three photos.'); error.status = 409; error.code = 'PHOTO_LIMIT_REACHED'; throw error; }
        await client.query(
          `INSERT INTO incident_photos(id,incident_id,consent_event_id,storage_key,content_type,size_bytes,width,height,created_by)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [photoId, req.params.id, grantedEventId, storageKey, image.contentType, image.sizeBytes, image.width, image.height, req.user.id],
        );
        await client.query('DELETE FROM incident_photo_deletion_tasks WHERE id=$1', [taskId]);
        await audit(req, 'INCIDENT_PHOTO_UPLOADED', { contentType: image.contentType, sizeBytes: image.sizeBytes }, 'student_incident', req.params.id, client);
      });
    } catch (error) {
      try { await query('UPDATE incident_photo_deletion_tasks SET available_at=NOW(),leased_at=NULL,last_error_code=$2 WHERE id=$1', [taskId, String(error.code || 'UPLOAD_FINALIZE_FAILED').slice(0, 60)]); } catch { /* keep the durable orphan task */ }
      return errorResponse(res, error.status || 503, error.code || 'PHOTO_UPLOAD_FAILED', error.status ? error.message : 'The photo could not be attached. Cleanup will retry safely.');
    }
    return res.status(201).json({ data: { id: photoId, contentType: image.contentType, sizeBytes: image.sizeBytes, width: image.width, height: image.height } });
  });

  app.get('/api/incidents/:id/photos/:photoId', setImageStreamSecurityHeaders, requireRoles('guardian', ...clinicalWriteRoles), async (req, res) => {
    if (!incidentPhotosEnabled()) return errorResponse(res, 404, 'NOT_FOUND', 'Incident photo not found.');
    if (!validUuid(req.params.id) || !validUuid(req.params.photoId)) return errorResponse(res, 404, 'NOT_FOUND', 'Incident photo not found.');
    const access = await query(
      `SELECT p.id,p.incident_id,p.storage_key,p.content_type,p.consent_event_id,p.expires_at,p.deletion_requested_at,p.deleted_at,
         c.status AS consent_status,c.granted_event_id,i.patient_id
       FROM incident_photos p JOIN student_incidents i ON i.id=p.incident_id JOIN patients pt ON pt.id=i.patient_id
       JOIN incident_photo_consents c ON c.incident_id=i.id
       WHERE p.id=$1 AND p.incident_id=$2 AND pt.patient_type='student'
         AND ($3='school_nurse' OR EXISTS(SELECT 1 FROM guardian_patient_links l WHERE l.patient_id=i.patient_id AND l.guardian_user_id=$4 AND c.guardian_user_id=$4))`,
      [req.params.photoId, req.params.id, req.user.role, req.user.id],
    );
    const photo = access.rows[0];
    if (!photo || !incidentPhotoReadable({ enabled: true, consent: { status: photo.consent_status, granted_event_id: photo.granted_event_id }, photo })) return errorResponse(res, 404, 'NOT_FOUND', 'Incident photo not found.');
    if (!storageAdapter?.isConfigured?.() || !storageAdapter?.bucket) return errorResponse(res, 503, 'PHOTO_STORAGE_UNAVAILABLE', 'Private incident photo storage is not configured.');
    let bytes;
    try { bytes = await storageAdapter.download(storageAdapter.bucket, photo.storage_key); }
    catch { return errorResponse(res, 503, 'PHOTO_STORAGE_UNAVAILABLE', 'The incident photo could not be loaded.'); }
    if (!bytes) return errorResponse(res, 404, 'NOT_FOUND', 'Incident photo not found.');
    // Hold the consent/photo rows while beginning the response so a concurrent revocation
    // serializes either before this read (denied) or after the authorized response begins.
    const delivered = await transaction(async (client) => {
      const stillAllowed = await client.query(
      `SELECT p.id FROM incident_photos p JOIN incident_photo_consents c ON c.incident_id=p.incident_id
       JOIN student_incidents i ON i.id=p.incident_id JOIN patients pt ON pt.id=i.patient_id
       WHERE p.id=$1 AND p.incident_id=$2 AND pt.patient_type='student' AND c.status='granted' AND p.consent_event_id=c.granted_event_id
         AND p.deletion_requested_at IS NULL AND p.deleted_at IS NULL AND p.expires_at>NOW()
         AND ($3='school_nurse' OR (c.guardian_user_id=$4 AND EXISTS(SELECT 1 FROM guardian_patient_links l WHERE l.patient_id=i.patient_id AND l.guardian_user_id=$4)))
       FOR UPDATE OF p,c`,
      [req.params.photoId, req.params.id, req.user.role, req.user.id],
      );
      if (!stillAllowed.rowCount || !incidentPhotosEnabled()) return false;
      await audit(req, 'INCIDENT_PHOTO_READ', {}, 'student_incident', req.params.id, client);
      res.setHeader('Content-Type', photo.content_type);
      res.setHeader('Content-Length', String(bytes.length));
      res.setHeader('Cache-Control', 'private, no-store, max-age=0');
      res.setHeader('Content-Disposition', 'inline');
      res.send(bytes);
      return true;
    });
    if (!delivered) return errorResponse(res, 404, 'NOT_FOUND', 'Incident photo not found.');
    return res;
  });

  app.delete('/api/incidents/:id/photos/:photoId', requireRoles(...clinicalWriteRoles), async (req, res) => {
    if (!validUuid(req.params.id) || !validUuid(req.params.photoId)) return errorResponse(res, 404, 'NOT_FOUND', 'Incident photo not found.');
    const result = await transaction(async (client) => {
      const photo = await client.query('SELECT id,storage_key FROM incident_photos WHERE id=$1 AND incident_id=$2 FOR UPDATE', [req.params.photoId, req.params.id]);
      if (!photo.rowCount) return null;
      await client.query('UPDATE incident_photos SET deletion_requested_at=COALESCE(deletion_requested_at,NOW()) WHERE id=$1', [req.params.photoId]);
      await client.query(
        `INSERT INTO incident_photo_deletion_tasks(id,photo_id,storage_key,reason,available_at)
         VALUES($1,$2,$3,'nurse_removed',NOW()) ON CONFLICT(storage_key) DO UPDATE
         SET available_at=LEAST(incident_photo_deletion_tasks.available_at,EXCLUDED.available_at),reason='nurse_removed'`, [crypto.randomUUID(), req.params.photoId, photo.rows[0].storage_key],
      );
      await audit(req, 'INCIDENT_PHOTO_DELETION_QUEUED', { reason: 'nurse_removed' }, 'student_incident', req.params.id, client);
      return { id: req.params.photoId };
    });
    if (!result) return errorResponse(res, 404, 'NOT_FOUND', 'Incident photo not found.');
    return res.status(202).json({ data: { deletionQueued: true } });
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
        await sendEmail({ to: recipient.email, ...notificationEmail({ name: recipient.name, subject, body }) });
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
    const sendApplicationHtml = serveApplicationHtml(readFileSync(join(distDir, 'index.html'), 'utf8'));
    app.get('/', sendApplicationHtml);
    app.get('/index.html', sendApplicationHtml);
    app.use(express.static(distDir, { index: false }));
    app.get('/{*splat}', (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      return sendApplicationHtml(req, res);
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
