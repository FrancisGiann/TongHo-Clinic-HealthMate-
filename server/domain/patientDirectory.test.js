import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPatientDirectoryQuery, escapeLikeLiteral, validatePatientDirectoryQuery } from './patientDirectory.js';

function queryFor(overrides = {}) {
  const validation = validatePatientDirectoryQuery({ page: 2, pageSize: 25, ...overrides });
  assert.equal(validation.valid, true);
  return buildPatientDirectoryQuery(validation.value);
}

test('directory search escapes SQL wildcard characters as literal text', () => {
  assert.equal(escapeLikeLiteral('A%_\\B'), 'A\\%\\_\\\\B');
  const built = queryFor({ q: 'A%_\\B' });
  assert.deepEqual(built.params, [null, null, null, 'A\\%\\_\\\\B', 25, 2]);
  assert.match(built.sql, /ESCAPE E'\\\\'/);
});

test('directory search falls back from an empty student ID to a faculty ID', () => {
  const built = queryFor({ q: 'FAC-SYN-0010' });
  assert.match(built.sql, /COALESCE\(NULLIF\(p\.data->>'studentId',''\),p\.data->>'facultyId',''\)/);
});

test('directory search and exact filters preserve caller whitespace', () => {
  const validation = validatePatientDirectoryQuery({ q: ' Patient ', grade: ' Grade 2 ', section: ' A ' });
  assert.equal(validation.valid, true);
  assert.deepEqual([validation.value.q, validation.value.grade, validation.value.section], [' Patient ', ' Grade 2 ', ' A ']);
});

test('name and grade sorts paginate in SQL and project only directory fields', () => {
  for (const sort of ['name', 'grade']) {
    const built = queryFor({ sort });
    assert.ok(built.sql.indexOf('page_candidates AS') < built.sql.indexOf('page_rows AS'));
    assert.match(built.sql, /LIMIT \$5 OFFSET \(\(SELECT page_no FROM effective_page\)-1\)\*\$5/);
    assert.doesNotMatch(built.sql, /SELECT p\.id,p\.patient_type,p\.data\s+FROM patients/);
    assert.match(built.sql, /FROM patients p\s+WHERE/);
    assert.doesNotMatch(built.sql, /latest_visit_at|make_timestamp/);
  }
});

test('latest-visit sorting returns narrow candidates for the shared baseline date parser', () => {
  const built = queryFor({ sort: 'latestVisit', page: 99 });
  assert.equal(built.clientLatestVisitSort, true);
  assert.equal(built.params.length, 4);
  assert.match(built.sql, /FROM filtered p/);
  assert.match(built.sql, /row_number\(\) OVER \(ORDER BY p\.id/);
  assert.doesNotMatch(built.sql, /LIMIT \$5|latest_visit_at|make_timestamp|regexp_match\(.*date/);
  assert.match(built.sql, /'latestVisit',NULL::jsonb/);
});

test('grade ordering preserves the unanchored first one-or-two-digit rank extraction', () => {
  const built = queryFor({ sort: 'grade' });
  assert.match(built.sql, /\(grade\[\[:space:\]\]\*\)\?\(\[0-9\]\{1,2\}\)/);
  assert.doesNotMatch(built.sql, /\^\(grade/);
  assert.match(built.sql, /IN \('k','kindergarten'\) THEN 0/);
});

test('latest visit candidate query projects no clinical payload or raw visit JSON', () => {
  const built = queryFor({ sort: 'latestVisit' });
  assert.doesNotMatch(built.sql, /SELECT .*data\s+FROM patients/);
  assert.doesNotMatch(built.sql, /data->'guardianHealthRecord'|profileImage|visit\.data/);
  assert.match(built.sql, /data->>'allergies' AS allergies/);
});
