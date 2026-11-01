import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePatientProfilePayload } from './patientProfileValidation.js';

test('profile payload accepts bounded strings and explicit image removal', () => {
  const result = validatePatientProfilePayload('patient-1', {
    id: 'patient-1', name: 'Ari Santos', contactNumber: '+63 900 000 0000', birthDate: '2015-02-28', profileImage: null,
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.value, {
    name: 'Ari Santos', contactNumber: '+63 900 000 0000', birthDate: '2015-02-28', profileImage: null,
  });
});

test('profile payload rejects mismatched IDs, object values, invalid email/date/phone, and oversized fields', () => {
  const result = validatePatientProfilePayload('patient-1', {
    id: 'patient-2', email: { value: 'nurse@example.test' }, birthDate: '2026-02-31',
    guardianPhone: 'Call me', allergies: 'x'.repeat(2001),
  });
  assert.equal(result.valid, false);
  assert.ok(result.fields.id);
  assert.ok(result.fields.email);
  assert.ok(result.fields.birthDate);
  assert.ok(result.fields.guardianPhone);
  assert.ok(result.fields.allergies);
});

test('profile payload keeps noneditable values out of targeted updates', () => {
  const result = validatePatientProfilePayload('patient-1', {
    id: 'patient-1', name: 'Ari Santos', guardianHealthRecord: { allergies: 'Must not replace canonical values' },
    consentStatus: 'accepted', patientType: 'faculty',
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.value, { name: 'Ari Santos' });
});
