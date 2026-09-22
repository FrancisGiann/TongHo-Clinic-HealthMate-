import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { query, transaction } from './db.js';
import { sendOtpEmail } from './email.js';

const SESSION_COOKIE = 'healthmate_session';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

export function normalizeIdentifier(value) {
  return String(value || '').trim().toLowerCase();
}

export function validEmail(value) {
  const email = normalizeIdentifier(value);
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 12) return 'Password must be at least 12 characters long.';
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    return 'Password must include uppercase, lowercase, number, and special characters.';
  }
  return null;
}

export function hashSecret(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    mfaEnabled: Boolean(user.mfa_enabled),
    schoolId: user.school_id || '',
    prcLicenseNumber: user.prc_license_number || '',
    contactNumber: user.contact_number || '',
    schoolName: user.school_name || '',
    lastLogin: user.last_login_at || null,
  };
}

function parseCookies(header = '') {
  return Object.fromEntries(
    header.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
      const separator = part.indexOf('=');
      return separator < 0 ? [part, ''] : [part.slice(0, separator), decodeURIComponent(part.slice(separator + 1))];
    }),
  );
}

function requestIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim().slice(0, 64);
}

export async function audit(req, event, details = {}, subjectType = null, subjectId = null, client = null) {
  const db = client || { query };
  await db.query(
    `INSERT INTO audit_logs(actor_user_id,event,subject_type,subject_id,details,ip_address,user_agent)
     VALUES($1,$2,$3,$4,$5::jsonb,$6,$7)`,
    [req.user?.id || null, event, subjectType, subjectId ? String(subjectId) : null, JSON.stringify(details), requestIp(req), String(req.headers['user-agent'] || '').slice(0, 1000)],
  );
}

export async function issueSession(req, res, user, remember = true) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + (remember ? 30 * SESSION_TTL_MS : SESSION_TTL_MS));
  await query(
    'INSERT INTO sessions(token_hash,user_id,expires_at,ip_address,user_agent) VALUES($1,$2,$3,$4,$5)',
    [hashSecret(token), user.id, expiresAt, requestIp(req), String(req.headers['user-agent'] || '').slice(0, 1000)],
  );
  const secure = process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === 'true';
  const attributes = [`${SESSION_COOKIE}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.floor((expiresAt.getTime() - Date.now()) / 1000)}`];
  if (secure) attributes.push('Secure');
  res.setHeader('Set-Cookie', attributes.join('; '));
}

export async function clearSession(req, res) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (token) await query('DELETE FROM sessions WHERE token_hash=$1', [hashSecret(token)]);
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export async function loadSession(req, _res, next) {
  try {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (!token) return next();
    const result = await query(
      `SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id
       WHERE s.token_hash=$1 AND s.expires_at>NOW() AND u.status='active'`,
      [hashSecret(token)],
    );
    if (result.rows[0]) {
      req.user = result.rows[0];
      await query('UPDATE sessions SET last_seen_at=NOW() WHERE token_hash=$1', [hashSecret(token)]);
    }
    next();
  } catch (error) {
    next(error);
  }
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in is required.' } });
  next();
}

export function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in is required.' } });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You do not have permission to perform this action.' } });
    next();
  };
}

export async function findUser(identifier) {
  const clean = normalizeIdentifier(identifier);
  const result = await query('SELECT * FROM users WHERE LOWER(username)=$1 OR LOWER(email)=$1 LIMIT 1', [clean]);
  return result.rows[0] || null;
}

export async function checkLoginLock(identifier) {
  const clean = normalizeIdentifier(identifier);
  const result = await query('SELECT * FROM login_attempts WHERE identifier=$1', [clean]);
  const row = result.rows[0];
  if (row?.locked_until && new Date(row.locked_until).getTime() > Date.now()) return row.locked_until;
  if (row?.locked_until) await query('DELETE FROM login_attempts WHERE identifier=$1', [clean]);
  return null;
}

export async function recordFailedLogin(identifier) {
  const clean = normalizeIdentifier(identifier);
  const result = await query(
    `INSERT INTO login_attempts(identifier,attempt_count,last_attempt_at)
     VALUES($1,1,NOW()) ON CONFLICT(identifier) DO UPDATE
     SET attempt_count=login_attempts.attempt_count+1,last_attempt_at=NOW()
     RETURNING attempt_count`,
    [clean],
  );
  const count = result.rows[0].attempt_count;
  if (count >= 5) await query("UPDATE login_attempts SET locked_until=NOW()+INTERVAL '15 minutes' WHERE identifier=$1", [clean]);
  return Math.max(0, 5 - count);
}

export async function clearFailedLogin(identifier) {
  await query('DELETE FROM login_attempts WHERE identifier=$1', [normalizeIdentifier(identifier)]);
}

export async function createOtpChallenge(user, purpose, metadata = {}) {
  const destination = normalizeIdentifier(user.email);
  const recent = await query(
    `SELECT created_at FROM otp_challenges WHERE destination=$1 AND purpose=$2
     AND created_at>NOW()-INTERVAL '60 seconds' ORDER BY created_at DESC LIMIT 1`,
    [destination, purpose],
  );
  if (recent.rowCount) {
    const error = new Error('Please wait before requesting another verification code.');
    error.code = 'OTP_COOLDOWN';
    error.status = 429;
    throw error;
  }
  const code = String(crypto.randomInt(100000, 1000000));
  const id = crypto.randomUUID();
  await query(
    `INSERT INTO otp_challenges(id,user_id,destination,purpose,code_hash,max_attempts,expires_at,metadata)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
    [id, user.id || null, destination, purpose, hashSecret(`${id}:${destination}:${code}`), OTP_MAX_ATTEMPTS, new Date(Date.now() + OTP_TTL_MS), JSON.stringify(metadata)],
  );
  try {
    await sendOtpEmail(destination, code, purpose.replaceAll('_', ' '));
  } catch (error) {
    await query('DELETE FROM otp_challenges WHERE id=$1', [id]);
    throw error;
  }
  return id;
}

export async function consumeOtp(challengeId, code, purpose) {
  return transaction(async (client) => {
    const result = await client.query('SELECT * FROM otp_challenges WHERE id=$1 FOR UPDATE', [challengeId]);
    const challenge = result.rows[0];
    if (!challenge || challenge.purpose !== purpose || challenge.consumed_at || new Date(challenge.expires_at).getTime() <= Date.now()) return null;
    if (challenge.attempts >= challenge.max_attempts) return null;
    const expected = Buffer.from(challenge.code_hash, 'hex');
    const actual = Buffer.from(hashSecret(`${challenge.id}:${challenge.destination}:${String(code || '').trim()}`), 'hex');
    const valid = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
    if (!valid) {
      await client.query('UPDATE otp_challenges SET attempts=attempts+1 WHERE id=$1', [challenge.id]);
      return null;
    }
    await client.query('UPDATE otp_challenges SET consumed_at=NOW() WHERE id=$1', [challenge.id]);
    return challenge;
  });
}

export async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export function createRawToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export { SESSION_COOKIE };
