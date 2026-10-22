import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAuditPageQuery, decodeAuditCursor, encodeAuditCursor, formatAuditPage, validateAuditPageQuery } from './auditPagination.js';

const filters = { limit: 10, order: 'newest', event: 'LOGIN_SUCCESS', actorId: null, start: '2026-01-01', end: '2026-01-31', cursor: null };

test('audit pagination accepts only supported page sizes, order, date, and actor filters', () => {
  assert.equal(validateAuditPageQuery({}).value.limit, 25);
  assert.equal(validateAuditPageQuery({ limit: '50', order: 'oldest', actorId: 'system' }).valid, true);
  for (const query of [{ limit: '11' }, { order: 'random' }, { actorId: 'bad' }, { start: '2026-02-30' }, { start: '2026-02-02', end: '2026-02-01' }]) {
    assert.equal(validateAuditPageQuery(query).valid, false);
  }
});

test('audit cursor keeps microsecond timestamp and bigint ID precision', () => {
  const token = encodeAuditCursor({
    direction: 'next', order: 'newest', filters,
    row: { id: '9007199254740993', cursor_created_at: '2026-01-31T09:10:11.123456Z' },
  });
  const decoded = decodeAuditCursor(token);
  assert.equal(decoded.createdAt, '2026-01-31T09:10:11.123456Z');
  assert.equal(decoded.id, '9007199254740993');
  assert.equal(validateAuditPageQuery({ ...filters, cursor: token }).valid, true);
  assert.equal(validateAuditPageQuery({ ...filters, event: 'LOGOUT', cursor: token }).valid, false);
  assert.equal(decodeAuditCursor('garbage'), null);
});

test('audit keyset SQL parameterizes filters and reverses prior pages without offsets', () => {
  const built = buildAuditPageQuery({ ...filters, cursor: { direction: 'previous', createdAt: '2026-01-31T09:10:11.123456Z', id: '9007199254740993' } });
  assert.match(built.sql, /\(l\.created_at,l\.id\) > \(\$4::timestamptz,\$5::bigint\)/);
  assert.match(built.sql, /ORDER BY l\.created_at ASC,l\.id ASC LIMIT \$6/);
  assert.doesNotMatch(built.sql, /OFFSET/);
  assert.deepEqual(built.params.slice(0, 3), ['LOGIN_SUCCESS', '2026-01-01T00:00:00+08:00', '2026-02-01T00:00:00+08:00']);
  assert.equal(built.params[3], '2026-01-31T09:10:11.123456Z');
  assert.equal(built.params[4], '9007199254740993');
});

test('audit calendar day filters use Manila midnight on both boundaries', () => {
  const built = buildAuditPageQuery({ ...filters, cursor: null });
  assert.match(built.sql, /l\.created_at>=\$2::timestamptz/);
  assert.match(built.sql, /l\.created_at<\$3::timestamptz/);
  assert.equal(built.params[1], '2026-01-01T00:00:00+08:00');
  assert.equal(built.params[2], '2026-02-01T00:00:00+08:00');
});

test('audit page exposes both directions across full history using cursor anchors', () => {
  const rows = Array.from({ length: 11 }, (_, index) => ({ id: String(100 - index), cursor_created_at: `2026-01-31T09:10:${String(11 - index).padStart(2, '0')}.123456Z` }));
  const initial = formatAuditPage(rows, filters);
  assert.equal(initial.logs.length, 10);
  assert.equal(initial.hasPrevious, false);
  assert.equal(initial.hasNext, true);
  assert.ok(initial.nextCursor);
  const parsed = validateAuditPageQuery({ ...filters, cursor: initial.nextCursor }).value;
  const next = formatAuditPage(rows.slice(0, 10), { ...parsed, reverse: false });
  assert.equal(next.hasPrevious, true);
  assert.ok(next.previousCursor);
});

test('audit keyset pages traverse history beyond the former 200-row ceiling without duplicates', () => {
  const allRows = Array.from({ length: 257 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 0, 2) - index * 1000).toISOString().slice(0, 19);
    return { id: String(9007199254740993n + BigInt(index)), cursor_created_at: `${date}.123456Z` };
  });
  const visited = [];
  let query = { ...filters, limit: 25, event: null, actorId: null, start: null, end: null, cursor: null, reverse: false };
  let page;
  do {
    const anchor = query.cursor;
    const candidates = anchor
      ? allRows.filter((row) => row.cursor_created_at < anchor.createdAt
        || (row.cursor_created_at === anchor.createdAt && BigInt(row.id) < BigInt(anchor.id)))
      : allRows;
    page = formatAuditPage(candidates.slice(0, query.limit + 1), query);
    visited.push(...page.logs.map((row) => row.id));
    query = page.nextCursor ? { ...query, cursor: decodeAuditCursor(page.nextCursor), reverse: false } : null;
  } while (query);

  assert.equal(visited.length, 257);
  assert.equal(new Set(visited).size, 257);
  assert.deepEqual(visited, allRows.map((row) => row.id));
});
