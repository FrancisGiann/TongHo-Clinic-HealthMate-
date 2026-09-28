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
  const rows = parseCsv('Student ID,Name,Grade\nPTHI-1,Ana,Kindergarten\nPTHI-1,Ben,Grade 10');
  const duplicate = validateStudentImport(rows);
  assert.equal(duplicate.valid, false);
  assert.match(duplicate.errors[0], /duplicate/i);
  const existing = validateStudentImport(parseCsv('Student ID,Name,Grade\nPTHI-2,Cara,Grade 1'), [{ studentId: 'PTHI-2' }]);
  assert.equal(existing.valid, false);
});

test('student CSV imports preserve only minimal roster fields and accept Kindergarten', async () => {
  const { importCsvRecords } = await import('../../src/utils/csv.js');
  const [record] = importCsvRecords(parseCsv('Student ID,Name,Grade,Section,Adviser,Guardian,Birth Date\nPTHI-K-1,Fictional Child,Kindergarten,Sample,Fictional Adviser,Ignored,2019-01-01'), 'students');
  assert.deepEqual(record, { studentId: 'PTHI-K-1', name: 'Fictional Child', gradeLevel: 'Kindergarten', section: 'Sample', adviser: 'Fictional Adviser' });
  assert.equal(validateStudentImport(parseCsv('Student ID,Name,Grade\nPTHI-K-2,Fictional Child,Kindergarten')).valid, true);
  assert.equal(validateStudentImport(parseCsv('Student ID,Name,Grade\nPTHI-X,Fictional Child,Grade 11')).valid, false);
});
