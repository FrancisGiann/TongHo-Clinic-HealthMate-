import test from 'node:test';
import assert from 'node:assert/strict';
import { compareValues, manilaDateTimeKey, readListState, sortAndPaginate, updateListParams } from './listState.js';

test('URL list state validates pagination values and preserves unrelated action parameters', () => {
  const params = new URLSearchParams('add=1&q=student&page=3&pageSize=50&sort=name&order=asc');
  assert.deepEqual(readListState(params), { q: 'student', sort: 'name', order: 'asc', page: 3, pageSize: 50 });
  let result;
  updateListParams(params, (next) => { result = next; }, { q: 'nurse' }, { resetPage: true });
  assert.equal(result.get('add'), '1');
  assert.equal(result.get('page'), null);
  assert.equal(result.get('q'), 'nurse');
  assert.deepEqual(readListState(new URLSearchParams('page=0&pageSize=99&order=random'), { pageSize: 10 }), { q: '', sort: 'name', order: 'asc', page: 1, pageSize: 10 });
});

test('sorting handles nulls last in either order, stable IDs, full-set counts, and page clamping', () => {
  const records = [
    { id: 'b', name: 'Alpha', expiry: null },
    { id: 'c', name: 'alpha', expiry: '2026-01-03' },
    { id: 'a', name: 'alpha', expiry: '2026-01-01' },
    ...Array.from({ length: 9 }, (_, index) => ({ id: String(index + 1), name: `Beta ${index}`, expiry: `2026-01-${String(index + 2).padStart(2, '0')}` })),
  ];
  const compare = (a, b, order) => compareValues(a.name, b.name, order);
  const firstPage = sortAndPaginate(records, compare, { page: 1, pageSize: 10 });
  assert.deepEqual(firstPage.items.slice(0, 3).map((item) => item.id), ['a', 'b', 'c']);
  const desc = sortAndPaginate(records, (a, b, order) => compareValues(a.expiry, b.expiry, order), { order: 'desc', page: 50, pageSize: 10 });
  assert.deepEqual(desc.items.map((item) => item.id), ['a', 'b']);
  assert.equal(desc.page, 2);
  assert.equal(desc.total, 12);
  assert.equal(compareValues(null, '2026-01-01', 'desc'), 1);
});

test('Manila date/time parser compares local appointments as absolute instants', () => {
  assert.equal(manilaDateTimeKey('2026-10-21', '8:30 AM'), Date.parse('2026-10-21T08:30:00+08:00'));
  assert.equal(manilaDateTimeKey('2026-10-21T08:30:00'), Date.parse('2026-10-21T08:30:00+08:00'));
  assert.equal(manilaDateTimeKey('2026-10-21 08:30:00'), Date.parse('2026-10-21T08:30:00+08:00'));
  assert.equal(manilaDateTimeKey('invalid-date'), null);
  assert.equal(manilaDateTimeKey('2026-10-21', '25:00'), null);
});
