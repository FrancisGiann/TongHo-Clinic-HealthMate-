import { normalizeRosterIdentifier } from './roster.js';
import { isStudentGradeLevel } from '../../shared/grades.js';

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
  const childName = typeof payload.childName === 'string' ? payload.childName.trim() : '';
  const gradeLevel = typeof payload.gradeLevel === 'string' ? payload.gradeLevel.trim() : '';
  const section = typeof payload.section === 'string' ? payload.section.trim() : '';
  const studentId = typeof payload.studentId === 'string' ? payload.studentId.trim() : '';
  const relationship = typeof payload.relationship === 'string' ? payload.relationship.trim() : '';

  if (!name || name.length > 160 || /[\u0000-\u001f\u007f]/.test(name)) errors.name = 'Enter a valid name up to 160 characters.';
  if (!validEmail?.(email)) errors.email = 'Enter a valid email address.';
  if (!/^[a-z0-9._-]{3,80}$/.test(username)) errors.username = 'Use 3–80 letters, numbers, dots, underscores, or dashes.';
  const passwordError = validatePassword?.(password);
  if (passwordError) errors.password = passwordError;
  if (typeof confirmPassword !== 'string' || confirmPassword !== password) errors.confirmPassword = 'Passwords do not match.';
  if (!childName || childName.length > 160 || /[\u0000-\u001f\u007f]/.test(childName)) errors.childName = 'Enter the student’s full name, up to 160 characters.';
  if (!isStudentGradeLevel(gradeLevel)) errors.gradeLevel = 'Choose a supported grade level.';
  if (section.length > 80 || /[\u0000-\u001f\u007f]/.test(section)) errors.section = 'Section must be 80 characters or fewer.';
  if (typeof payload.studentId !== 'undefined' && payload.studentId !== null && typeof payload.studentId !== 'string') errors.studentId = 'Enter a valid student ID.';
  else if (studentId.length > 80 || /[\u0000-\u001f\u007f]/.test(studentId)) errors.studentId = 'Student ID must be 80 characters or fewer.';
  if (typeof payload.section !== 'undefined' && payload.section !== null && typeof payload.section !== 'string') errors.section = 'Section must be text.';
  if (!GUARDIAN_RELATIONSHIPS.has(relationship) || relationship.length > 80) errors.relationship = 'Choose a supported relationship.';

  if (Object.keys(errors).length) return { valid: false, errors };
  return {
    valid: true,
    value: { name, email, username, password, childName, gradeLevel, section, studentId, normalizedStudentId: normalizeRosterIdentifier(studentId), relationship },
  };
}

export function validGuardianSignupMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false;
  const legacyKeys = ['name', 'username', 'passwordHash', 'studentId', 'relationship'];
  const currentKeys = [...legacyKeys, 'childName', 'gradeLevel', 'section'];
  const keys = Object.keys(metadata).sort();
  const isLegacy = keys.length === legacyKeys.length && keys.every((key, index) => key === [...legacyKeys].sort()[index]);
  const isCurrent = keys.length === currentKeys.length && keys.every((key, index) => key === [...currentKeys].sort()[index]);
  if (!isLegacy && !isCurrent) return false;
  const validIdentity = typeof metadata.name === 'string' && metadata.name.trim().length > 0 && metadata.name.length <= 160
    && !/[\u0000-\u001f\u007f]/.test(metadata.name)
    && typeof metadata.username === 'string' && /^[a-z0-9._-]{3,80}$/.test(metadata.username)
    && typeof metadata.passwordHash === 'string' && metadata.passwordHash.length >= 40 && metadata.passwordHash.length <= 200
    && typeof metadata.studentId === 'string' && metadata.studentId.length <= 80
    && !/[\u0000-\u001f\u007f]/.test(metadata.studentId)
    && typeof metadata.relationship === 'string' && GUARDIAN_RELATIONSHIPS.has(metadata.relationship);
  if (!validIdentity) return false;
  if (isLegacy) return metadata.studentId.trim().length > 0;
  return typeof metadata.childName === 'string' && metadata.childName.trim().length > 0 && metadata.childName.length <= 160
    && !/[\u0000-\u001f\u007f]/.test(metadata.childName)
    && typeof metadata.gradeLevel === 'string' && isStudentGradeLevel(metadata.gradeLevel)
    && typeof metadata.section === 'string' && metadata.section.length <= 80 && !/[\u0000-\u001f\u007f]/.test(metadata.section)
    && !/[\u0000-\u001f\u007f]/.test(metadata.studentId);
}

export function resolveGuardianStudentMatch(rows, submittedStudentId) {
  const normalized = normalizeRosterIdentifier(submittedStudentId);
  if (!normalized) return { valid: false, reason: 'missing' };
  const matches = rows.filter((row) => row?.patient_type === 'student'
    && normalizeRosterIdentifier(row.student_id ?? row.data?.studentId) === normalized);
  if (matches.length !== 1) return { valid: false, reason: matches.length ? 'ambiguous' : 'not_found' };
  return { valid: true, patient: matches[0] };
}
