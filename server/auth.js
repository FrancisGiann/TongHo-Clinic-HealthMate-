import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { query, transaction } from './db.js';
import { sendOtpEmail } from './email.js';
import {
  MAX_CONCURRENT_SESSIONS,
  SESSION_ABSOLUTE_TTL_MS,
  SESSION_IDLE_TTL_MS,
  sessionCookieMaxAgeSeconds,
} from './sessionPolicy.js';

const SESSION_COOKIE = 'healthmate_session';
const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
export const LOGIN_FAILURE_LIMIT = 5;
const LOGIN_FAILURE_LOCK_MS = 15 * 60 * 1000;

export function normalizeIdentifier(value) {
  return String(value || '').trim().toLowerCase();
}

export function validEmail(value) {
  const email = normalizeIdentifier(value);
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 12) return 'Password must be at least 12 characters long.';
  if (password.length > 1024) return 'Password must be 1,024 characters or fewer.';
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    return 'Password must include uppercase, lowercase, number, and special characters.';
  }
  return null;
}

export function hashSecret(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export function accountLoginAttemptKey(identifier) {
  return normalizeIdentifier(identifier);
}

export function loginFailureKeyFor(user, identifier) {
  return user?.id ? `user:${String(user.id).toLowerCase()}` : accountLoginAttemptKey(identifier);
}

export function loginAttemptsRemaining(attemptCount) {
  return Math.max(0, LOGIN_FAILURE_LIMIT - Number(attemptCount || 0));
}

export function loginAttemptsShouldLock(attemptCount, limit = LOGIN_FAILURE_LIMIT) {
  return Number(attemptCount) >= limit;
}

export function loginLockActive(lockedUntil, now = Date.now()) {
  return Boolean(lockedUntil) && new Date(lockedUntil).getTime() > now;
}

export function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    schoolId: user.school_id || '',
    prcLicenseNumber: user.prc_license_number || '',
    prcLicenseVerified: Boolean(user.prc_license_number?.trim() && user.prc_license_verified_at && user.prc_license_verified_by),
    contactNumber: user.contact_number || '',
    schoolName: user.school_name || '',
    lastLogin: user.last_login_at || null,
  };
}

function parseCookies(header = '') {
  const cookies = {};
  for (const part of header.split(';').map((value) => value.trim()).filter(Boolean)) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const name = part.slice(0, separator);
    try {
      cookies[name] = decodeURIComponent(part.slice(separator + 1));
    } catch {
      cookies[name] = '';
    }
  }
  return cookies;
}

function requestIp(req) {
  return String(req.ip || req.socket?.remoteAddress || '').trim().slice(0, 64);
}

export async function audit(req, event, details = {}, subjectType = null, subjectId = null, client = null) {
  const db = client || { query };
  await db.query(
    `INSERT INTO audit_logs(actor_user_id,event,subject_type,subject_id,details,ip_address,user_agent)
     VALUES($1,$2,$3,$4,$5::jsonb,$6,$7)`,
    [req.user?.id || null, event, subjectType, subjectId ? String(subjectId) : null, JSON.stringify(details), requestIp(req), String(req.headers['user-agent'] || '').slice(0, 1000)],
  );
}

export async function issueSession(req, res, user, remember = false, { transactionFn = transaction } = {}) {
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashSecret(token);
  const expiresAt = new Date(Date.now() + SESSION_ABSOLUTE_TTL_MS);
  await transactionFn(async (client) => {
    // Serializing issuance on the user row makes the per-account cap safe under concurrent logins.
    await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [user.id]);
    await client.query(
      `DELETE FROM sessions WHERE user_id=$1
       AND (expires_at<=NOW() OR last_seen_at<=NOW()-($2::double precision * INTERVAL '1 millisecond'))`,
      [user.id, SESSION_IDLE_TTL_MS],
    );
    await client.query(
      `INSERT INTO sessions(token_hash,user_id,expires_at,ip_address,user_agent,created_at,last_seen_at)
       VALUES($1,$2,$3,$4,$5,clock_timestamp(),clock_timestamp())`,
      [tokenHash, user.id, expiresAt, requestIp(req), String(req.headers['user-agent'] || '').slice(0, 1000)],
    );
    await client.query(
      `DELETE FROM sessions WHERE token_hash IN (
         SELECT token_hash FROM (
           SELECT token_hash,ROW_NUMBER() OVER (ORDER BY created_at DESC,token_hash DESC) AS session_rank
           FROM sessions WHERE user_id=$1
         ) ranked WHERE session_rank>$2
       )`,
      [user.id, MAX_CONCURRENT_SESSIONS],
    );
  });
  const secure = process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === 'true';
  const attributes = [`${SESSION_COOKIE}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  const cookieMaxAge = sessionCookieMaxAgeSeconds(remember, expiresAt);
  if (cookieMaxAge !== null) attributes.push(`Max-Age=${cookieMaxAge}`);
  if (secure) attributes.push('Secure');
  res.setHeader('Set-Cookie', attributes.join('; '));
}

export async function clearSession(req, res, queryFn = query) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (token) await queryFn('DELETE FROM sessions WHERE token_hash=$1', [hashSecret(token)]);
  const secure = process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === 'true';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`);
}

export function currentSessionTokenHash(req) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  return token ? hashSecret(token) : null;
}

export async function loadSession(req, _res, next, queryFn = query) {
  try {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (!token) return next();
    const result = await queryFn(
      `UPDATE sessions s SET last_seen_at=NOW() FROM users u
       WHERE s.user_id=u.id AND s.token_hash=$1 AND s.expires_at>NOW()
         AND s.last_seen_at>NOW()-($2::double precision * INTERVAL '1 millisecond') AND u.status='active' AND u.role<>'student'
       RETURNING u.*`,
      [hashSecret(token), SESSION_IDLE_TTL_MS],
    );
    if (result.rows[0]) {
      req.user = result.rows[0];
    } else {
      await queryFn('DELETE FROM sessions WHERE token_hash=$1', [hashSecret(token)]);
    }
    next();
  } catch (error) {
    next(error);
  }
}

export async function listUserSessions(userId, currentTokenHash, queryFn = query) {
  const result = await queryFn(
    `SELECT token_hash,created_at,last_seen_at,expires_at,user_agent
     FROM sessions WHERE user_id=$1 AND expires_at>NOW()
       AND last_seen_at>NOW()-($2::double precision * INTERVAL '1 millisecond')
     ORDER BY created_at DESC,token_hash DESC`,
    [userId, SESSION_IDLE_TTL_MS],
  );
  return result.rows.map((session) => ({
    sessionId: session.token_hash,
    createdAt: session.created_at,
    lastSeenAt: session.last_seen_at,
    expiresAt: session.expires_at,
    userAgent: String(session.user_agent || '').slice(0, 300),
    current: session.token_hash === currentTokenHash,
  }));
}

export async function revokeUserSession(userId, sessionId, queryFn = query) {
  return queryFn(
    'DELETE FROM sessions WHERE token_hash=$1 AND user_id=$2 RETURNING token_hash',
    [sessionId, userId],
  );
}

export async function revokeAllUserSessions(userId, queryFn = query) {
  return queryFn('DELETE FROM sessions WHERE user_id=$1', [userId]);
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

export async function checkLoginLock(failureKey, identifier = failureKey) {
  const keys = [...new Set([accountLoginAttemptKey(failureKey), accountLoginAttemptKey(identifier)])];
  const result = await query('SELECT identifier,locked_until FROM login_attempts WHERE identifier=ANY($1::varchar[])', [keys]);
  const activeLock = result.rows
    .map((row) => row.locked_until)
    .filter((lockedUntil) => loginLockActive(lockedUntil))
    .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0];
  if (activeLock) return activeLock;
  if (result.rows.some((row) => row.locked_until)) await query('DELETE FROM login_attempts WHERE identifier=ANY($1::varchar[])', [keys]);
  return null;
}

export async function recordFailedLogin(failureKey) {
  const accountKey = accountLoginAttemptKey(failureKey);
  const result = await query(
    `INSERT INTO login_attempts(identifier,attempt_count,last_attempt_at)
     VALUES($1,1,NOW()) ON CONFLICT(identifier) DO UPDATE
     SET attempt_count=login_attempts.attempt_count+1,last_attempt_at=NOW()
     RETURNING attempt_count`,
    [accountKey],
  );
  const count = result.rows[0].attempt_count;
  if (loginAttemptsShouldLock(count)) {
    await query(
      "UPDATE login_attempts SET locked_until=NOW()+($2::double precision * INTERVAL '1 millisecond') WHERE identifier=$1",
      [accountKey, LOGIN_FAILURE_LOCK_MS],
    );
  }
  return loginAttemptsRemaining(count);
}

export async function clearFailedLogin(failureKey, identifier = failureKey) {
  const keys = [...new Set([accountLoginAttemptKey(failureKey), accountLoginAttemptKey(identifier)])];
  await query('DELETE FROM login_attempts WHERE identifier=ANY($1::varchar[])', [keys]);
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
  if (typeof challengeId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(challengeId)
    || typeof code !== 'string' || !/^\d{6}$/.test(code)) return null;
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
