import bcrypt from 'bcryptjs';

/**
 * Authentication Utilities
 * Provides secure password hashing, session management, and rate limiting
 */

// Simple hash function for demo purposes
// In production, use bcrypt or similar on the backend
async function simpleHash(text) {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Stored hashed passwords (in production, these would be in a secure database)
const DEFAULT_USERS = [
  {
    username: 'nurse.santos',
    passwordHash: bcrypt.hashSync('HealthMate2026!', 10),
    name: 'Nurse Maya Santos',
    role: 'school_nurse',
    email: 'maya.santos@tongho.edu.ph',
    status: 'active',
    mfaEnabled: false,
    schoolId: 'TNH-1001',
    prcLicenseNumber: 'PRC-2026001',
    contactNumber: '+63 917 000 0001',
    schoolName: 'Tong Ho Academy Health Center'
  },
  {
    username: 'admin',
    passwordHash: bcrypt.hashSync('Admin@TongHo2026!', 10),
    name: 'System Administrator',
    role: 'system_administrator',
    email: 'admin@tongho.edu.ph',
    status: 'active',
    mfaEnabled: false,
    schoolId: 'ADM-0001',
    prcLicenseNumber: 'PRC-ADMIN-001',
    contactNumber: '+63 917 000 0002',
    schoolName: 'Tong Ho Academy'
  }
];

// Load users from localStorage or use defaults
let USERS = (() => {
  try {
    const stored = localStorage.getItem('clinic-users');
    if (!stored) {
      return DEFAULT_USERS.map(normalizeUser);
    }

    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.map(normalizeUser) : DEFAULT_USERS.map(normalizeUser);
  } catch {
    return DEFAULT_USERS.map(normalizeUser);
  }
})();

/**
 * Save users to localStorage
 */
function saveUsers() {
  try {
    localStorage.setItem('clinic-users', JSON.stringify(USERS));
  } catch (error) {
    console.error('Failed to save users:', error);
  }
}

function isBcryptHash(value) {
  return typeof value === 'string' && value.startsWith('$2');
}

function normalizeUser(user) {
  return {
    ...user,
    role: user.role || 'school_nurse',
    status: user.status || 'active',
    mfaEnabled: Boolean(user.mfaEnabled),
    schoolId: user.schoolId || '',
    prcLicenseNumber: user.prcLicenseNumber || '',
    contactNumber: user.contactNumber || '',
    schoolName: user.schoolName || ''
  };
}

const MFA_STORAGE_KEY = 'clinic-mfa-challenge';
const RESET_STORAGE_KEY = 'clinic-password-reset';

// Rate limiting
const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes

/**
 * Check if user is locked out due to too many failed attempts
 */
function isLockedOut(username) {
  const attempts = loginAttempts.get(username);
  if (!attempts) return false;
  
  if (attempts.count >= MAX_ATTEMPTS) {
    const timeSinceLockout = Date.now() - attempts.lastAttempt;
    if (timeSinceLockout < LOCKOUT_DURATION) {
      return {
        locked: true,
        remainingTime: Math.ceil((LOCKOUT_DURATION - timeSinceLockout) / 1000 / 60)
      };
    } else {
      // Lockout expired, reset
      loginAttempts.delete(username);
      return false;
    }
  }
  return false;
}

/**
 * Record a failed login attempt
 */
function recordFailedAttempt(username) {
  const attempts = loginAttempts.get(username) || { count: 0, lastAttempt: 0 };
  attempts.count += 1;
  attempts.lastAttempt = Date.now();
  loginAttempts.set(username, attempts);
  
  return {
    attemptsRemaining: Math.max(0, MAX_ATTEMPTS - attempts.count),
    totalAttempts: MAX_ATTEMPTS
  };
}

/**
 * Clear failed attempts on successful login
 */
function clearFailedAttempts(username) {
  loginAttempts.delete(username);
}

/**
 * Request an email OTP from the server. The server keeps the challenge state.
 */
export async function requestSignupOtp(destination, method = 'email') {
  const cleanDestination = (destination || '').trim().toLowerCase();

  if (!cleanDestination) return { success: false, error: 'Please enter your email before requesting an OTP.' };

  if (method !== 'email' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanDestination)) {
    return { success: false, error: 'Please enter a valid email address to receive the OTP.' };
  }

  try {
    const response = await fetch('http://localhost:3001/api/send-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: cleanDestination })
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.message || 'Failed to send OTP.');
    }

    logSecurityEvent('OTP_REQUESTED', { destination: cleanDestination, method });
    return { success: true, message: result.message || 'A verification code was sent to your email.' };
  } catch (error) {
    return { success: false, error: error.message || 'Unable to send the verification email.' };
  }
}

/**
 * Verify the OTP for a given destination.
 */
export async function verifySignupOtp(destination, code) {
  const cleanDestination = (destination || '').trim().toLowerCase();
  const cleanCode = (code || '').trim();

  if (!cleanDestination || !/^\d{6}$/.test(cleanCode)) return { success: false, error: 'Please enter the 6-digit verification code.' };

  try {
    const response = await fetch('http://localhost:3001/api/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: cleanDestination, otp: cleanCode })
    });
    const result = await response.json();
    return response.ok && result.success
      ? { success: true, message: result.message }
      : { success: false, error: result.message || 'The verification code is invalid or expired.' };
  } catch {
    return { success: false, error: 'Unable to verify the code right now. Please try again.' };
  }
}

function findUserByIdentifier(identifier) {
  const cleanIdentifier = (identifier || '').trim().toLowerCase();

  if (!cleanIdentifier) {
    return null;
  }

  return USERS.find((user) => {
    const username = (user.username || '').toLowerCase();
    const email = (user.email || '').toLowerCase();
    return username === cleanIdentifier || email === cleanIdentifier;
  }) || null;
}

export function createMfaChallenge(user) {
  if (!user?.username) {
    return {
      success: false,
      error: 'MFA could not be initiated for this account.'
    };
  }

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const challenge = {
    username: user.username,
    code,
    expiresAt: Date.now() + (5 * 60 * 1000)
  };

  localStorage.setItem(MFA_STORAGE_KEY, JSON.stringify(challenge));
  logSecurityEvent('MFA_CHALLENGE_CREATED', { username: user.username, code });

  return {
    success: true,
    message: `A 6-digit MFA code has been generated. Use code ${code} to continue.`
  };
}

export function verifyMfaCode(username, code) {
  const cleanUsername = (username || '').trim().toLowerCase();
  const cleanCode = (code || '').trim();

  if (!cleanUsername || !cleanCode) {
    return {
      success: false,
      error: 'Please enter the MFA code to continue.'
    };
  }

  try {
    const entry = JSON.parse(localStorage.getItem(MFA_STORAGE_KEY) || 'null');

    if (!entry) {
      return {
        success: false,
        error: 'No active MFA challenge was found. Please sign in again.'
      };
    }

    if (Date.now() > entry.expiresAt) {
      localStorage.removeItem(MFA_STORAGE_KEY);
      return {
        success: false,
        error: 'The MFA code has expired. Please sign in again.'
      };
    }

    const isValid = entry.username === cleanUsername && entry.code === cleanCode;
    if (!isValid) {
      return {
        success: false,
        error: 'Invalid MFA code. Please try again.'
      };
    }

    localStorage.removeItem(MFA_STORAGE_KEY);
    logSecurityEvent('MFA_VERIFIED', { username: cleanUsername });

    return {
      success: true,
      message: 'MFA verification successful.'
    };
  } catch (error) {
    console.error('Failed to verify MFA code:', error);
    return {
      success: false,
      error: 'Unable to verify MFA code. Please try again.'
    };
  }
}

export async function requestPasswordReset(identifier) {
  const user = findUserByIdentifier(identifier);

  if (!user) {
    return {
      success: true,
      message: 'If an account exists for that email or username, a password reset token will be created for the demo portal.'
    };
  }

  const token = Math.random().toString(36).slice(2, 10).toUpperCase();
  const resetEntry = {
    username: user.username,
    email: user.email,
    token,
    expiresAt: Date.now() + (10 * 60 * 1000)
  };

  localStorage.setItem(RESET_STORAGE_KEY, JSON.stringify(resetEntry));
  logSecurityEvent('PASSWORD_RESET_REQUESTED', {
    username: user.username,
    email: user.email,
    token
  });

  return {
    success: true,
    message: `A password reset token has been generated for ${user.email}. Use code ${token} to continue.`,
    token
  };
}

export async function resetPassword(identifier, token, newPassword) {
  const cleanIdentifier = (identifier || '').trim().toLowerCase();
  const cleanToken = (token || '').trim().toUpperCase();

  if (!cleanIdentifier || !cleanToken || !newPassword) {
    return {
      success: false,
      error: 'Email/username, reset token, and a new password are required.'
    };
  }

  const passwordStrength = validatePasswordStrength(newPassword);
  if (!passwordStrength.valid) {
    return {
      success: false,
      error: passwordStrength.error
    };
  }

  try {
    const entry = JSON.parse(localStorage.getItem(RESET_STORAGE_KEY) || 'null');

    if (!entry) {
      return {
        success: false,
        error: 'No active password reset token was found. Please request a new one.'
      };
    }

    if (Date.now() > entry.expiresAt) {
      localStorage.removeItem(RESET_STORAGE_KEY);
      return {
        success: false,
        error: 'The password reset token has expired. Please request a new one.'
      };
    }

    if (entry.token !== cleanToken) {
      return {
        success: false,
        error: 'The reset token is invalid or does not match the requested account.'
      };
    }

    const user = findUserByIdentifier(cleanIdentifier);

    if (!user || user.username !== entry.username) {
      return {
        success: false,
        error: 'The reset token does not match the requested account.'
      };
    }

    user.passwordHash = await bcrypt.hash(newPassword, 10);
    saveUsers();
    localStorage.removeItem(RESET_STORAGE_KEY);
    logSecurityEvent('PASSWORD_RESET_COMPLETED', { username: user.username, email: user.email });

    return {
      success: true,
      message: 'Password reset successfully. You can now sign in with your new password.'
    };
  } catch (error) {
    console.error('Failed to reset password:', error);
    return {
      success: false,
      error: 'Unable to reset the password right now. Please try again.'
    };
  }
}

export async function updateMfaPreference(username, enabled) {
  const user = findUserByIdentifier(username);

  if (!user) {
    return {
      success: false,
      error: 'Unable to update MFA settings for this account.'
    };
  }

  user.mfaEnabled = Boolean(enabled);
  saveUsers();
  logSecurityEvent('MFA_SETTING_UPDATED', {
    username: user.username,
    enabled: Boolean(enabled)
  });

  return {
    success: true,
    message: `MFA has been ${Boolean(enabled) ? 'enabled' : 'disabled'} for ${user.username}.`
  };
}

export function getPendingRegistrations() {
  return USERS.filter((user) => user.status === 'pending_verification')
    .map((user) => ({
      username: user.username,
      name: user.name,
      email: user.email,
      schoolName: user.schoolName,
      schoolId: user.schoolId,
      prcLicenseNumber: user.prcLicenseNumber,
      contactNumber: user.contactNumber,
      createdAt: user.createdAt || 'Unknown'
    }));
}

export function getUsersForAdmin() {
  return USERS.map(({ passwordHash, ...user }) => ({
    ...user,
    lastLogin: user.lastLogin || null,
  }));
}

export function updateUserStatus(username, status) {
  const user = findUserByIdentifier(username);
  if (!user) return { success: false, error: 'The account could not be found.' };

  user.status = status;
  saveUsers();
  logSecurityEvent(status === 'active' ? 'ACCOUNT_ACTIVATED' : 'ACCOUNT_DEACTIVATED', {
    username: user.username,
    status,
  });
  return { success: true, user: { ...user, passwordHash: undefined } };
}

export async function createManagedUser({ name, email, role }) {
  const cleanName = (name || '').trim();
  const cleanEmail = (email || '').trim().toLowerCase();
  const cleanRole = role === 'Admin' ? 'system_administrator' : 'school_nurse';
  const username = cleanEmail.split('@')[0].replace(/[^a-z0-9._-]/g, '') || `user-${Date.now()}`;

  if (!cleanName || !cleanEmail) return { success: false, error: 'Name and email are required.' };
  if (USERS.some((user) => user.email.toLowerCase() === cleanEmail || user.username === username)) {
    return { success: false, error: 'An account with this email already exists.' };
  }

  const temporaryPassword = `Reset-${Math.random().toString(36).slice(2, 8)}!`;
  const newUser = {
    username,
    passwordHash: await bcrypt.hash(temporaryPassword, 10),
    name: cleanName,
    role: cleanRole,
    email: cleanEmail,
    status: 'active',
    mfaEnabled: false,
    schoolId: '',
    prcLicenseNumber: '',
    contactNumber: '',
    schoolName: '',
    lastLogin: null,
  };
  USERS = [...USERS, newUser];
  saveUsers();
  logSecurityEvent('MANAGED_ACCOUNT_CREATED', { username, email: cleanEmail, role: cleanRole });
  return { success: true, username, temporaryPassword };
}

export function approveNurseAccount(username, approvedBy = 'system_administrator') {
  const user = findUserByIdentifier(username);

  if (!user) {
    return {
      success: false,
      error: 'The requested account could not be found.'
    };
  }

  user.status = 'active';
  user.approvedBy = approvedBy;
  user.approvedAt = new Date().toISOString();
  saveUsers();
  logSecurityEvent('ACCOUNT_APPROVED', {
    username: user.username,
    approvedBy,
    email: user.email
  });

  return {
    success: true,
    message: `${user.name} has been approved and can now sign in.`,
    user
  };
}

export function rejectNurseAccount(username, reason, approvedBy = 'system_administrator') {
  const user = findUserByIdentifier(username);

  if (!user) {
    return {
      success: false,
      error: 'The requested account could not be found.'
    };
  }

  user.status = 'deactivated';
  user.rejectReason = reason || 'No reason provided';
  user.approvedBy = approvedBy;
  user.updatedAt = new Date().toISOString();
  saveUsers();
  logSecurityEvent('ACCOUNT_REJECTED', {
    username: user.username,
    approvedBy,
    reason: user.rejectReason
  });

  return {
    success: true,
    message: `${user.name} has been rejected and their account has been deactivated.`,
    user
  };
}

export function getAuditLogs() {
  try {
    return JSON.parse(localStorage.getItem('security-logs') || '[]');
  } catch {
    return [];
  }
}

/**
 * Authenticate user with username and password
 */
export async function authenticateUser(identifier, password) {
  // Check for lockout
  const inputKey = (identifier || '').trim().toLowerCase();
  const lockout = isLockedOut(inputKey);
  if (lockout) {
    return {
      success: false,
      error: `Account locked due to too many failed attempts. Please try again in ${lockout.remainingTime} minutes.`,
      locked: true
    };
  }

  // Input validation
  if (!identifier || !password) {
    return {
      success: false,
      error: 'Email/username and password are required'
    };
  }

  const cleanIdentifier = identifier.trim().toLowerCase();

  const user = USERS.find(u => {
    const username = (u.username || '').toLowerCase();
    const email = (u.email || '').toLowerCase();
    return username === cleanIdentifier || email === cleanIdentifier;
  });

  if (!user) {
    const attempts = recordFailedAttempt(cleanIdentifier);
    return {
      success: false,
      error: `Invalid credentials. ${attempts.attemptsRemaining} attempts remaining.`,
      attemptsRemaining: attempts.attemptsRemaining
    };
  }

  const isValidPassword = await verifyPassword(password, user);

  if (!isValidPassword) {
    const attempts = recordFailedAttempt(cleanIdentifier);
    return {
      success: false,
      error: `Invalid credentials. ${attempts.attemptsRemaining} attempts remaining.`,
      attemptsRemaining: attempts.attemptsRemaining
    };
  }

  if (user.status === 'pending_verification') {
    return {
      success: false,
      error: 'Your nurse account is pending verification by the school administrator.'
    };
  }

  if (user.status === 'suspended') {
    return {
      success: false,
      error: 'This account has been suspended. Please contact the school administrator.'
    };
  }

  if (user.status === 'rejected') {
    return {
      success: false,
      error: 'Your account request was rejected. Please contact the school administrator.'
    };
  }

  if (user.status === 'deactivated') {
    return {
      success: false,
      error: 'This account is no longer active.'
    };
  }

  clearFailedAttempts(cleanIdentifier);
  user.lastLogin = new Date().toISOString();
  saveUsers();

  return {
    success: true,
    user: {
      username: user.username,
      name: user.name,
      role: user.role,
      email: user.email,
      status: user.status,
      schoolId: user.schoolId,
      prcLicenseNumber: user.prcLicenseNumber,
      contactNumber: user.contactNumber,
      schoolName: user.schoolName,
      mfaEnabled: Boolean(user.mfaEnabled)
    }
  };
}

/**
 * Verify password against user's stored hash
 * For demo: checks hardcoded passwords
 * In production: use bcrypt.compare()
 */
async function verifyPassword(password, user) {
  if (!password || !user) return false;

  if (isBcryptHash(user.passwordHash)) {
    return await bcrypt.compare(password, user.passwordHash);
  }

  const demoPasswords = {
    'nurse.santos': 'HealthMate2026!',
    'admin': 'Admin@TongHo2026!'
  };

  if (demoPasswords[user.username]) {
    return demoPasswords[user.username] === password;
  }

  if (user.passwordHash) {
    const candidateHash = await simpleHash(password);
    return user.passwordHash === candidateHash;
  }

  return false;
}

/**
 * Create a nurse account
 */
export async function createNurseAccount({
  fullName,
  schoolId,
  prcLicenseNumber,
  email,
  contactNumber,
  schoolName,
  username,
  password
}) {
  const cleanUsername = (username || '').trim().toLowerCase();
  const cleanEmail = (email || '').trim().toLowerCase();
  const cleanFullName = (fullName || '').trim();
  const cleanSchoolId = (schoolId || '').trim();
  const cleanPrcLicenseNumber = (prcLicenseNumber || '').trim();
  const cleanContactNumber = (contactNumber || '').trim();
  const cleanSchoolName = (schoolName || '').trim();

  if (!cleanUsername || !password || !cleanEmail || !cleanFullName || !cleanSchoolId || !cleanPrcLicenseNumber || !cleanContactNumber || !cleanSchoolName) {
    return {
      success: false,
      error: 'All fields are required to submit a nurse account request.'
    };
  }

  const usernamePattern = /^[a-zA-Z0-9._-]+$/;
  if (!usernamePattern.test(cleanUsername)) {
    return {
      success: false,
      error: 'Username can only contain letters, numbers, dots, underscores, and dashes.'
    };
  }

  if (USERS.some(user => user.username.toLowerCase() === cleanUsername || user.email.toLowerCase() === cleanEmail)) {
    return {
      success: false,
      error: 'This username or email is already registered.'
    };
  }

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(cleanEmail)) {
    return {
      success: false,
      error: 'Please enter a valid email address.'
    };
  }

  const passwordStrength = validatePasswordStrength(password);
  if (!passwordStrength.valid) {
    return {
      success: false,
      error: passwordStrength.error
    };
  }

  const newUser = {
    username: cleanUsername,
    passwordHash: await bcrypt.hash(password, 10),
    name: cleanFullName,
    role: 'school_nurse',
    email: cleanEmail,
    status: 'pending_verification',
    mfaEnabled: false,
    schoolId: cleanSchoolId,
    prcLicenseNumber: cleanPrcLicenseNumber,
    contactNumber: cleanContactNumber,
    schoolName: cleanSchoolName
  };

  USERS = [...USERS, newUser];
  saveUsers();
  logSecurityEvent('NURSE_ACCOUNT_CREATED', {
    username: cleanUsername,
    email: cleanEmail,
    fullName: cleanFullName,
    status: 'pending_verification'
  });

  return {
    success: true,
    message: 'Your nurse account has been submitted for verification. The school administrator will review your license and school details before approval.',
    user: {
      username: newUser.username,
      name: newUser.name,
      role: newUser.role,
      email: newUser.email,
      status: newUser.status
    }
  };
}

/**
 * Create a secure session token
 */
export function createSession(user) {
  const sessionData = {
    ...user,
    timestamp: Date.now(),
    sessionId: generateSessionId(),
    expiresAt: Date.now() + (24 * 60 * 60 * 1000) // 24 hours
  };

  return sessionData;
}

/**
 * Validate an existing session
 */
export function validateSession(sessionData) {
  if (!sessionData || !sessionData.timestamp || !sessionData.expiresAt) {
    return { valid: false, reason: 'Invalid session data' };
  }

  const now = Date.now();
  
  if (now > sessionData.expiresAt) {
    return { valid: false, reason: 'Session expired' };
  }

  // Session valid
  return { valid: true, user: sessionData };
}

/**
 * Generate a random session ID
 */
function generateSessionId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Get remaining lockout time for a user
 */
export function getRemainingLockoutTime(username) {
  const lockout = isLockedOut(username);
  return lockout ? lockout.remainingTime : 0;
}

/**
 * Change user password (for settings)
 */
export async function changePassword(username, currentPassword, newPassword) {
  const user = findUserByIdentifier(username);

  if (!user) {
    return {
      success: false,
      error: 'Unable to locate the requested account.'
    };
  }

  const passwordStrength = validatePasswordStrength(newPassword);
  if (!passwordStrength.valid) {
    return {
      success: false,
      error: passwordStrength.error
    };
  }

  const authResult = await authenticateUser(username, currentPassword);
  if (!authResult.success) {
    return {
      success: false,
      error: 'Current password is incorrect'
    };
  }

  user.passwordHash = await bcrypt.hash(newPassword, 10);
  saveUsers();
  logSecurityEvent('PASSWORD_CHANGED', {
    username: user.username,
    email: user.email
  });

  return {
    success: true,
    message: 'Password changed successfully. Please sign in again with your new password.'
  };
}

/**
 * Validate password strength
 */
export function validatePasswordStrength(password) {
  if (!password || password.length < 12) {
    return {
      valid: false,
      error: 'Password must be at least 12 characters long'
    };
  }

  const hasUpperCase = /[A-Z]/.test(password);
  const hasLowerCase = /[a-z]/.test(password);
  const hasNumbers = /\d/.test(password);
  const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);

  if (!hasUpperCase || !hasLowerCase || !hasNumbers || !hasSpecialChar) {
    return {
      valid: false,
      error: 'Password must include uppercase, lowercase, numbers, and special characters'
    };
  }

  return { valid: true, strength: 4 };
}

/**
 * Log security events (in production, send to backend)
 */
export function logSecurityEvent(event, details) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    event,
    details,
    userAgent: navigator.userAgent
  };

  // In production, send this to your backend
  console.log('[Security Event]', logEntry);
  
  // Store in localStorage for demo
  try {
    const logs = JSON.parse(localStorage.getItem('security-logs') || '[]');
    logs.push(logEntry);
    // Keep only last 100 logs
    if (logs.length > 100) logs.shift();
    localStorage.setItem('security-logs', JSON.stringify(logs));
  } catch (error) {
    console.error('Failed to log security event:', error);
  }
}
