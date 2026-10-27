import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeIdentifier, validEmail, validatePassword } from '../auth.js';
import { guardianSignupAcceptedResponse, resolveGuardianStudentMatch, validateGuardianSignup, validGuardianSignupMetadata } from './guardianSignup.js';

const validInput = {
  name: '  Sample Guardian  ', email: 'Guardian@Example.test', username: ' Guardian.User ',
  password: 'StrongPassword1!', confirmPassword: 'StrongPassword1!', childName: '  Sample Student  ',
  gradeLevel: 'Grade 4', section: '  Rizal  ', studentId: '  STU 001  ', relationship: 'Mother',
};

test('guardian signup validates user-selected details and normalizes account and roster identifiers', () => {
  const result = validateGuardianSignup(validInput, { validEmail, validatePassword });
  assert.equal(result.valid, true);
  assert.deepEqual(result.value, {
    name: 'Sample Guardian', email: 'guardian@example.test', username: 'guardian.user',
    password: 'StrongPassword1!', childName: 'Sample Student', gradeLevel: 'Grade 4', section: 'Rizal',
    studentId: 'STU 001', normalizedStudentId: 'stu 001', relationship: 'Mother',
  });
});

test('guardian signup rejects weak or mismatched passwords, invalid identity, and unsupported relationship', () => {
  const result = validateGuardianSignup({ ...validInput, password: 'weak', confirmPassword: 'different', studentId: 'x'.repeat(81), relationship: 'School nurse' }, { validEmail, validatePassword });
  assert.equal(result.valid, false);
  assert.deepEqual(Object.keys(result.errors).sort(), ['confirmPassword', 'password', 'relationship', 'studentId']);
});

test('signup challenge metadata requires a password hash and excludes plaintext password', () => {
  const base = { name: 'Guardian', username: 'guardian.one', passwordHash: '$2b$12$' + 'a'.repeat(53), studentId: 'S-1', relationship: 'Parent' };
  const legacy = { ...base };
  const current = { ...base, childName: 'Student', gradeLevel: 'Grade 3', section: '' };
  assert.equal(validGuardianSignupMetadata(legacy), true, 'old unconsumed OTP challenges remain usable');
  assert.equal(validGuardianSignupMetadata(current), true);
  assert.equal(validGuardianSignupMetadata({ ...current, password: 'StrongPassword1!' }), false);
  assert.equal(validGuardianSignupMetadata({ ...current, passwordHash: 'short' }), false);
  assert.equal(validGuardianSignupMetadata({ ...current, gradeLevel: 'Grade 13' }), false);
  assert.equal(normalizeIdentifier(' Guardian@Example.test '), 'guardian@example.test');
});

test('guardian signup accepts unknown or omitted student IDs while validating required child details', () => {
  for (const studentId of ['NOT-YET-ON-ROSTER', '']) {
    const result = validateGuardianSignup({ ...validInput, studentId }, { validEmail, validatePassword });
    assert.equal(result.valid, true);
    assert.equal(result.value.studentId, studentId);
  }
  const invalid = validateGuardianSignup({ ...validInput, studentId: 'x'.repeat(81), childName: ' ', gradeLevel: 'Grade 11', section: 'x'.repeat(81) }, { validEmail, validatePassword });
  assert.equal(invalid.valid, false);
  assert.deepEqual(Object.keys(invalid.errors).sort(), ['childName', 'gradeLevel', 'section', 'studentId']);
});

test('new, existing-account, and invited-email signup requests can share one non-enumerating response', () => {
  const actualChallengeId = 'f8c6f02e-98a0-4b59-9c51-ea09d2f24262';
  const placeholderChallengeId = '21c31560-8826-4f33-93d9-3348af8bd638';
  const accepted = guardianSignupAcceptedResponse(actualChallengeId);
  const existing = guardianSignupAcceptedResponse(placeholderChallengeId);
  assert.equal(accepted.message, existing.message);
  assert.deepEqual(Object.keys(accepted).sort(), Object.keys(existing).sort());
  assert.match(accepted.message, /if this email can be used/i);
  assert.match(accepted.message, /invitation link/i);
});

test('guardian signup matches one normalized student ID and ignores faculty IDs', () => {
  const student = { id: 'patient-1', patient_type: 'student', student_id: '  Stu 001  ' };
  const faculty = { id: 'patient-faculty', patient_type: 'faculty', student_id: 'stu 001' };
  assert.deepEqual(resolveGuardianStudentMatch([faculty, student], ' stu 001 '), { valid: true, patient: student });
  assert.deepEqual(resolveGuardianStudentMatch([faculty], 'stu 001'), { valid: false, reason: 'not_found' });
  assert.deepEqual(resolveGuardianStudentMatch([student, { ...student, id: 'patient-2', student_id: 'STU 001' }], 'stu 001'), { valid: false, reason: 'ambiguous' });
});
