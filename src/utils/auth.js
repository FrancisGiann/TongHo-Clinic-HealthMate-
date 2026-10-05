import { api } from './api';

let resetChallengeId = null;

function failure(error) {
  return {
    success: false,
    error: error?.message || 'The request could not be completed.',
    code: error?.code,
    locked: error?.code === 'ACCOUNT_LOCKED',
    attemptsRemaining: error?.status === 401 ? error?.attemptsRemaining : undefined,
  };
}

export async function getCurrentUser() {
  try {
    const result = await api.get('/api/auth/me');
    return result.user;
  } catch (error) {
    if (error.status === 401) return null;
    throw error;
  }
}

export async function authenticateUser(identifier, password, remember = false) {
  try {
    const result = await api.post('/api/auth/login', { identifier, password, remember });
    if (result.mfaRequired) return { success: false, mfaRequired: true, ...result };
    return { success: true, user: result.user };
  } catch (error) {
    const result = failure(error);
    result.attemptsRemaining = error?.status === 401 ? error?.attemptsRemaining : undefined;
    return result;
  }
}

export async function verifyMfaCode(challengeId, code) {
  try {
    const result = await api.post('/api/auth/otp/verify', { challengeId, code });
    return { success: true, user: result.user };
  } catch (error) {
    return failure(error);
  }
}

export async function logoutUser() {
  try {
    await api.post('/api/auth/logout');
  } catch (error) {
    if (error.status !== 401) throw error;
  }
}

export async function requestPasswordReset(identifier) {
  try {
    const result = await api.post('/api/auth/password-reset/request', { identifier });
    resetChallengeId = result.challengeId;
    return { success: true, ...result };
  } catch (error) {
    return failure(error);
  }
}

export async function resetPassword(_identifier, code, password) {
  if (!resetChallengeId) return { success: false, error: 'Request a new password reset code first.' };
  try {
    const result = await api.post('/api/auth/password-reset/confirm', { challengeId: resetChallengeId, code, password });
    resetChallengeId = null;
    return { success: true, ...result };
  } catch (error) {
    return failure(error);
  }
}

export async function activateAccount(token, username, password) {
  try {
    const result = await api.post('/api/auth/activate', { token, username, password });
    return { success: true, ...result };
  } catch (error) {
    return failure(error);
  }
}

export function validatePasswordStrength(password) {
  if (!password || password.length < 12) return { valid: false, error: 'Password must be at least 12 characters long.' };
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    return { valid: false, error: 'Password must include uppercase, lowercase, number, and special characters.' };
  }
  return { valid: true, strength: 4 };
}

export async function getUsersForAdmin({ throwOnError = false } = {}) {
  try {
    const result = await api.get('/api/admin/users');
    return (result.users || []).map((user) => ({
      ...user,
      schoolId: user.school_id || '',
      prcLicenseNumber: user.prc_license_number || '',
      prcLicenseVerified: Boolean(user.prc_license_number?.trim() && user.prc_license_verified_at && user.prc_license_verified_by),
      schoolName: user.school_name || '',
      invitationAccepted: Boolean(user.invitation_accepted),
      contactNumber: user.contact_number || '',
      lastLogin: user.last_login_at || null,
    }));
  } catch (error) {
    if (throwOnError) throw error;
    return [];
  }
}

export async function createManagedUser({ name, email, role, patientId, relationship }) {
  const roleMap = { Admin: 'system_administrator', Nurse: 'school_nurse', Guardian: 'guardian' };
  try {
    const result = await api.post('/api/admin/users/invite', { name, email, role: roleMap[role] || role, patientId, relationship });
    return { success: true, ...result };
  } catch (error) {
    return failure(error);
  }
}

export async function updateUserStatus(id, status) {
  try {
    const result = await api.patch(`/api/admin/users/${encodeURIComponent(id)}/status`, { status });
    return { success: true, user: result.user };
  } catch (error) {
    return failure(error);
  }
}

export async function resendInvitation(id) {
  try {
    const result = await api.post(`/api/admin/users/${encodeURIComponent(id)}/resend-invitation`);
    return { success: true, ...result };
  } catch (error) {
    return failure(error);
  }
}

export async function getAuditLogs({ throwOnError = false } = {}) {
  try {
    const result = await api.get('/api/admin/audit-logs?limit=200');
    return (result.logs || []).map((entry) => ({
      ...entry,
      timestamp: entry.created_at,
      details: entry.details || {},
    }));
  } catch (error) {
    if (throwOnError) throw error;
    return [];
  }
}

export async function changePassword(_username, currentPassword, newPassword) {
  try {
    const result = await api.post('/api/auth/password/change', { currentPassword, newPassword });
    return { success: true, ...result };
  } catch (error) {
    return failure(error);
  }
}

// Legacy exports retained while the existing settings UI is migrated.
export const createSession = (user) => user;
export const createMfaChallenge = () => ({ success: true, message: 'Enter the code sent to your email.' });
export const requestSignupOtp = async () => ({ success: false, error: 'Accounts are created by administrator invitation.' });
export const verifySignupOtp = async () => ({ success: false, error: 'Accounts are created by administrator invitation.' });
export const createNurseAccount = async () => ({ success: false, error: 'Ask an administrator to invite your account.' });
export const getPendingRegistrations = async () => [];
export const approveNurseAccount = async () => ({ success: false, error: 'Use the account status controls.' });
export const rejectNurseAccount = async () => ({ success: false, error: 'Use the account status controls.' });
export const getRemainingLockoutTime = () => 0;
export const validateSession = () => ({ valid: false, reason: 'Sessions are validated by the server.' });
export const logSecurityEvent = (event, details = {}) => console.info('[HealthMate event]', event, details);
