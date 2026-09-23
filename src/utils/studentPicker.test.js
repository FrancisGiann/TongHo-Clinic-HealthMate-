import test from 'node:test';
import assert from 'node:assert/strict';
import { findStudentMatches, nextStudentIndex } from './studentPicker.js';

const students = [
  { id: 'stu-1', name: 'Ari Santos', studentId: 'HM-104', gradeLevel: 'Grade 4', section: 'Maple' },
  { id: 'stu-2', name: 'Bea Cruz', studentId: 'HM-205', gradeLevel: 'Grade 6', section: 'Pine' },
];

test('student picker matches names, IDs, grade and section without selecting a result', () => {
  assert.deepEqual(findStudentMatches(students, '  ARI '), [students[0]]);
  assert.deepEqual(findStudentMatches(students, 'hm-205'), [students[1]]);
  assert.deepEqual(findStudentMatches(students, 'grade 6'), [students[1]]);
  assert.deepEqual(findStudentMatches(students, 'pine'), [students[1]]);
  assert.deepEqual(findStudentMatches(students, 'no match'), []);
  assert.deepEqual(findStudentMatches(students, ''), students, 'empty search offers options but leaves explicit selection to the caller');
});

test('student picker caps suggestions and keeps keyboard movement within valid options', () => {
  assert.equal(findStudentMatches(Array.from({ length: 60 }, (_, index) => ({ id: index })), '').length, 50);
  assert.equal(nextStudentIndex(-1, 1, 2), 0);
  assert.equal(nextStudentIndex(0, 1, 2), 1);
  assert.equal(nextStudentIndex(1, 1, 2), 1);
  assert.equal(nextStudentIndex(0, -1, 2), 0);
  assert.equal(nextStudentIndex(-1, 1, 0), -1);
});
