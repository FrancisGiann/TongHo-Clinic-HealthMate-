import test from 'node:test';
import assert from 'node:assert/strict';
import { formatManilaDateTime } from '../../src/utils/dateTime.js';

test('appointment formatter renders Manila local time instead of raw ISO', () => {
  assert.match(formatManilaDateTime('2026-09-24T01:00:00.000Z'), /Sep 24, 2026/);
  assert.match(formatManilaDateTime('2026-09-24T01:00:00.000Z'), /9:00/);
  assert.equal(formatManilaDateTime('2026-09-24', '02:30 PM'), 'Sep 24, 2026, 2:30 PM');
  assert.equal(formatManilaDateTime(''), 'Not scheduled');
});
