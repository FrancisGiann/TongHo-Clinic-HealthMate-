import { normalizeRosterIdentifier } from './roster.js';

export const GUARDIAN_RELATIONSHIPS = new Set([
  'Parent', 'Mother', 'Father', 'Guardian', 'Grandparent', 'Other relative',
]);

export function guardianSignupAcceptedResponse(challengeId) {
  return {
    challengeId,
    message: 'If this email can be used for guardian signup, a verification code will be sent. Check your inbox and spam folder; if you already have an account, sign in or use the administrator invitation link.',
  };
}

export function validateGuardianSignup(payload = {}, { validEmail, validatePassword } = {}) {
  const errors = {};
  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  const username = typeof payload.username === 'string' ? payload.username.trim().toLowerCase() : '';
  const password = payload.password;
  const confirmPassword = payload.confirmPassword;
  const studentId = typeof payload.studentId === 'string' ? payload.studentId.trim() : '';
  const relationship = typeof payload.relationship === 'string' ? payload.relationship.trim() : '';

  if (!name || name.length > 160) errors.name = 'Enter a name up to 160 characters.';
  if (!validEmail?.(email)) errors.email = 'Enter a valid email address.';
  if (!/^[a-z0-9._-]{3,80}$/.test(username)) errors.username = 'Use 3–80 letters, numbers, dots, underscores, or dashes.';
  const passwordError = validatePassword?.(password);
  if (passwordError) errors.password = passwordError;
  if (typeof confirmPassword !== 'string' || confirmPassword !== password) errors.confirmPassword = 'Passwords do not match.';
  if (!studentId || studentId.length > 80 || /[\u0000-\u001f\u007f]/.test(studentId)) errors.studentId = 'Enter a valid student ID.';
  if (!GUARDIAN_RELATIONSHIPS.has(relationship) || relationship.length > 80) errors.relationship = 'Choose a supported relationship.';

  if (Object.keys(errors).length) return { valid: false, errors };
  return {
    valid: true,
    value: { name, email, username, password, studentId, normalizedStudentId: normalizeRosterIdentifier(studentId), relationship },
  };
}

export function validGuardianSignupMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false;
  const allowedKeys = new Set(['name', 'username', 'passwordHash', 'studentId', 'relationship']);
  if (Object.keys(metadata).some((key) => !allowedKeys.has(key)) || Object.keys(metadata).length !== allowedKeys.size) return false;
  return typeof metadata.name === 'string' && metadata.name.trim().length > 0 && metadata.name.length <= 160
    && typeof metadata.username === 'string' && /^[a-z0-9._-]{3,80}$/.test(metadata.username)
    && typeof metadata.passwordHash === 'string' && metadata.passwordHash.length >= 40 && metadata.passwordHash.length <= 200
    && typeof metadata.studentId === 'string' && metadata.studentId.trim().length > 0 && metadata.studentId.length <= 80
    && typeof metadata.relationship === 'string' && GUARDIAN_RELATIONSHIPS.has(metadata.relationship);
}

export function resolveGuardianStudentMatch(rows, submittedStudentId) {
  const normalized = normalizeRosterIdentifier(submittedStudentId);
  if (!normalized) return { valid: false, reason: 'missing' };
  const matches = rows.filter((row) => row?.patient_type === 'student'
    && normalizeRosterIdentifier(row.student_id ?? row.data?.studentId) === normalized);
  if (matches.length !== 1) return { valid: false, reason: matches.length ? 'ambiguous' : 'not_found' };
  return { valid: true, patient: matches[0] };
}
