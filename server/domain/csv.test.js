import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, validateStudentImport } from '../../src/utils/csv.js';

test('CSV parser preserves quoted commas, escaped quotes, and embedded line breaks', () => {
  assert.deepEqual(parseCsv('Student ID,Name,Notes\r\nPTHI-1,"Santos, Ana","Needs ""follow-up""\nfictional"'), [
    ['Student ID', 'Name', 'Notes'],
    ['PTHI-1', 'Santos, Ana', 'Needs "follow-up"\nfictional'],
  ]);
});

test('student import validation rejects duplicate IDs in file and existing roster', () => {
  const rows = parseCsv('Student ID,Name\nPTHI-1,Ana\nPTHI-1,Ben');
  const duplicate = validateStudentImport(rows);
  assert.equal(duplicate.valid, false);
  assert.match(duplicate.errors[0], /duplicate/i);
  const existing = validateStudentImport(parseCsv('Student ID,Name\nPTHI-2,Cara'), [{ studentId: 'PTHI-2' }]);
  assert.equal(existing.valid, false);
});
