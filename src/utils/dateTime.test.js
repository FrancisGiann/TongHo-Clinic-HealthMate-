import test from 'node:test';
import assert from 'node:assert/strict';
import { manilaCalendarDate, shiftCalendarDate } from './dateTime.js';

test('weekly report dates use the Manila calendar before 08:00 local time', () => {
  const earlyMorning = new Date('2026-10-08T16:30:00.000Z');
  const today = manilaCalendarDate(earlyMorning);

  assert.equal(today, '2026-10-09');
  const start = shiftCalendarDate(today, -6);
  assert.equal(start, '2026-10-03');
  assert.equal(shiftCalendarDate(start, 6), today, 'start through end covers seven inclusive calendar days');
});

test('calendar date shifts handle month, year, and leap-day boundaries', () => {
  for (const [end, expectedStart] of [
    ['2026-03-03', '2026-02-25'],
    ['2026-01-04', '2025-12-29'],
    ['2024-03-04', '2024-02-27'],
  ]) {
    const start = shiftCalendarDate(end, -6);
    assert.equal(start, expectedStart);
    assert.equal(shiftCalendarDate(start, 6), end, 'calendar boundaries retain seven inclusive dates');
  }
});

test('calendar date helpers reject invalid inputs', () => {
  assert.equal(manilaCalendarDate(null), null);
  assert.equal(manilaCalendarDate(new Date('invalid')), null);
  assert.equal(shiftCalendarDate('2026-02-30', -6), null);
  assert.equal(shiftCalendarDate('2026-10-09', 1.5), null);
});
