import test from 'node:test';
import assert from 'node:assert/strict';
import { canRollbackImport, normalizeImportRows, selectedImportRows } from './imports.js';

test('roster import normalizes faculty identifiers and reports invalid fields per row', () => {
  const preview = normalizeImportRows('faculty', [
    {
      facultyId: 'FAC-01', name: 'Fictional Nurse', email: 'NURSE@example.test', department: 'Science',
      birthDate: '1988-04-12', gender: 'Female', bloodType: 'O+', allergies: 'Latex',
      conditions: 'Asthma', medications: 'Rescue inhaler',
    },
    { facultyId: 'FAC-02', name: '' },
  ]);
  assert.equal(preview.normalizedRows[0].record.studentId, 'FAC-01');
  assert.equal(preview.normalizedRows[0].record.patientType, 'faculty');
  assert.equal(preview.normalizedRows[0].record.email, 'nurse@example.test');
  assert.equal(preview.normalizedRows[0].record.birthDate, '1988-04-12');
  assert.equal(preview.normalizedRows[0].record.bloodType, 'O+');
  assert.equal(preview.normalizedRows[0].record.allergies, 'Latex');
  assert.equal(preview.normalizedRows[0].record.conditions, 'Asthma');
  assert.equal(preview.normalizedRows[0].record.medications, 'Rescue inhaler');
  assert.equal(preview.normalizedRows[0].status, 'ready');
  assert.deepEqual(preview.normalizedRows[1].errors, ['Name is required.']);
  assert.equal(preview.normalizedRows[1].status, 'invalid');
});

test('faculty health record fields enforce their storage limits', () => {
  const preview = normalizeImportRows('faculty', [{
    facultyId: 'FAC-03',
    name: 'Fictional Faculty',
    allergies: 'A'.repeat(2001),
  }]);
  assert.deepEqual(preview.normalizedRows[0].errors, ['Allergies must be 2000 characters or fewer.']);
  assert.equal(preview.normalizedRows[0].record.allergies.length, 2000);
});

test('import preview marks repeated identifiers and rejects selecting duplicates', () => {
  const preview = normalizeImportRows('students', [
    { studentId: 'PTHI-1', name: 'Fictional Student' },
    { studentId: 'pthi-1', name: 'Duplicate Student' },
  ]);
  assert.equal(preview.normalizedRows[1].status, 'duplicate');
  assert.deepEqual(selectedImportRows(preview.normalizedRows, [0, 1]), {
    valid: false,
    code: 'DUPLICATE_RECORD',
    message: 'One or more selected rows are invalid or duplicated. Refresh the preview and choose valid rows.',
    rows: [{ index: 1, errors: [], duplicateReason: 'This row repeats an earlier row in the file.' }],
  });
  assert.equal(selectedImportRows(preview.normalizedRows, [0]).valid, true);
});

test('historical visit import validates real dates, required fields, and batch limits', () => {
  const preview = normalizeImportRows('visits', [
    { patientId: 'PTHI-1', date: '2026-02-30', complaint: 'Headache', treatment: 'Rest' },
    { patientId: 'PTHI-1', date: '2026-02-28', complaint: '', treatment: '' },
  ]);
  assert.equal(preview.normalizedRows[0].status, 'invalid');
  assert.ok(preview.normalizedRows[0].errors.includes('Date must be a real date in YYYY-MM-DD format.'));
  assert.equal(preview.normalizedRows[1].errors.length, 2);
  assert.equal(normalizeImportRows('visits', []).invalidBatch, true);
  assert.equal(normalizeImportRows('unsupported', [{}]).validType, false);
});

test('import rollback authorization follows import type responsibilities', () => {
  assert.equal(canRollbackImport('system_administrator', 'students'), true);
  assert.equal(canRollbackImport('school_nurse', 'students'), false);
  assert.equal(canRollbackImport('school_nurse', 'faculty'), true);
  assert.equal(canRollbackImport('system_administrator', 'faculty'), true);
  assert.equal(canRollbackImport('school_nurse', 'visits'), true);
  assert.equal(canRollbackImport('system_administrator', 'visits'), false);
  assert.equal(canRollbackImport('guardian', 'faculty'), false);
});
