import test from 'node:test';
import assert from 'node:assert/strict';
import { appointmentRowsOverlappingPeriod, appointmentSettings, clinicDateTime, generateAppointmentSlots, intervalsOverlap, isAppointmentTransitionAllowed, isValidAppointmentDate, normalizeAppointmentStatus, rankAppointmentSlots, sortedManilaDayLockKeys, unavailablePeriodsForSlot, validateUnavailablePeriod } from './scheduling.js';

test('appointment slots respect clinic hours, weekdays, duration and conflicts', () => {
  const date = '2026-09-24';
  const all = generateAppointmentSlots(date, [], { open: '08:00', close: '10:00', durationMinutes: 30 });
  assert.deepEqual(all.map((slot) => slot.local), ['2026-09-24T08:00', '2026-09-24T08:30', '2026-09-24T09:00', '2026-09-24T09:30']);
  const available = generateAppointmentSlots(date, [all[1].startsAt], { open: '08:00', close: '10:00', durationMinutes: 30 });
  assert.equal(available.some((slot) => slot.local.endsWith('08:30')), false);
  assert.equal(generateAppointmentSlots('2026-09-26', []).length, 0);
});

test('appointment parsing treats timezone-less school times as Asia/Manila', () => {
  assert.equal(clinicDateTime('2026-09-24T08:00').toISOString(), '2026-09-24T00:00:00.000Z');
  assert.deepEqual(appointmentSettings({}), { open: '08:00', close: '16:00', durationMinutes: 30 });
});

test('appointment dates are real calendar dates and clinic weekend behavior uses the Manila date', () => {
  assert.equal(isValidAppointmentDate('2026-02-28'), true);
  assert.equal(isValidAppointmentDate('2026-02-30'), false);
  assert.equal(generateAppointmentSlots('2026-02-30', []).length, 0);
  assert.equal(generateAppointmentSlots('2026-09-24', []).length, 16);
  assert.equal(generateAppointmentSlots('2026-09-26', []).length, 0);
});

test('appointment availability on today excludes elapsed clinic slots using Manila time', () => {
  const slots = generateAppointmentSlots('2026-09-24', [], {
    open: '08:00', close: '10:00', durationMinutes: 30,
    now: new Date('2026-09-24T00:45:00.000Z'), // 08:45 in Asia/Manila
  });
  assert.deepEqual(slots.map((slot) => slot.local), ['2026-09-24T09:00', '2026-09-24T09:30']);
  assert.deepEqual(generateAppointmentSlots('2026-09-23', [], {
    open: '08:00', close: '10:00', durationMinutes: 30,
    now: new Date('2026-09-24T00:45:00.000Z'),
  }), []);
});

test('unavailable periods validate Manila full-day and partial-day ranges', () => {
  const fullDay = validateUnavailablePeriod({ date: '2026-10-21', fullDay: true, reason: 'School activity' });
  assert.equal(fullDay.valid, true);
  assert.equal(fullDay.value.startsAt.toISOString(), '2026-10-20T16:00:00.000Z');
  assert.equal(fullDay.value.endsAt.toISOString(), '2026-10-21T16:00:00.000Z');
  const partial = validateUnavailablePeriod({ date: '2026-10-21', startTime: '09:00', endTime: '10:30', reason: 'Clinic meeting' });
  assert.equal(partial.valid, true);
  assert.equal(partial.value.startsAt.toISOString(), '2026-10-21T01:00:00.000Z');
  assert.equal(validateUnavailablePeriod({ date: '2026-10-21', startTime: '10:30', endTime: '09:00', reason: 'x' }).code, 'INVALID_TIME_RANGE');
  assert.equal(validateUnavailablePeriod({ date: '2026-10-21', fullDay: true, reason: ' ' }).code, 'INVALID_REASON');
});

test('slot, block and appointment overlap checks use half-open duration intervals', () => {
  assert.equal(intervalsOverlap('2026-10-21T01:00:00Z', '2026-10-21T01:30:00Z', '2026-10-21T01:30:00Z', '2026-10-21T02:00:00Z'), false);
  const slot = '2026-10-21T01:00:00.000Z';
  assert.equal(unavailablePeriodsForSlot(slot, 30, [{ starts_at: '2026-10-21T01:29:00Z', ends_at: '2026-10-21T02:00:00Z' }]), true);
  assert.equal(unavailablePeriodsForSlot(slot, 30, [{ starts_at: '2026-10-21T01:30:00Z', ends_at: '2026-10-21T02:00:00Z' }]), false);
  const rows = [
    { status: 'Requested', starts_at: '2026-10-21T01:29:00Z' },
    { status: 'Scheduled', starts_at: '2026-10-21T02:00:00Z' },
    { status: 'Cancelled', starts_at: '2026-10-21T01:15:00Z' },
  ];
  assert.equal(appointmentRowsOverlappingPeriod(rows, '2026-10-21T01:00:00Z', '2026-10-21T02:00:00Z', 30).length, 1);
  assert.deepEqual(sortedManilaDayLockKeys('2026-10-22', '2026-10-21', '2026-10-22'), ['appointment-day:2026-10-21', 'appointment-day:2026-10-22']);
});

test('appointment suggestions rank free slots by same-weekday Manila visit timestamps', () => {
  const date = '2026-09-24'; // Thursday
  const freeSlots = generateAppointmentSlots(date, [clinicDateTime(`${date}T08:30`).toISOString()], {
    open: '08:00', close: '09:30', durationMinutes: 30,
  });
  const visitTimestamps = [
    '2026-09-03T00:05:00.000Z', // Manila Thursday, 08:05
    '2026-09-10T00:10:00.000Z',
    '2026-09-17T00:20:00.000Z',
    '2026-09-03T00:45:00.000Z', // Manila Thursday, 08:45
    '2026-09-10T00:50:00.000Z',
    '2026-09-17T00:45:00.000Z',
    '2026-09-03T01:05:00.000Z', // Manila Thursday, 09:05
    '2026-09-10T01:35:00.000Z', // Manila Thursday, 09:35 (outside open time)
    '2026-09-17T01:20:00.000Z', // Manila Thursday, 09:20 (outside requested slots but in clinic hours)
    '2026-09-08T00:10:00.000Z', // Tuesday, ignored
    '2026-09-23T16:30:00.000Z', // Thursday in Manila only if converted; outside clinic hours
  ];
  const result = rankAppointmentSlots(date, freeSlots, visitTimestamps, { open: '08:00', close: '09:30', durationMinutes: 30 });
  assert.equal(result.traffic.historyAvailable, true);
  assert.equal(result.traffic.lookbackDays, 90);
  assert.deepEqual(result.slots.map((slot) => slot.local), ['2026-09-24T09:00', '2026-09-24T08:00']);
  assert.deepEqual(result.slots.map((slot) => slot.trafficCount), [2, 3]);
  assert.deepEqual(result.slots.map((slot) => slot.suggestionRank), [1, 2]);
  assert.equal(result.slots.length, freeSlots.length);
  assert.equal(result.slots.some((slot) => slot.local === '2026-09-24T08:30'), false);
});

test('sparse appointment traffic history keeps every free slot in clinic-time order', () => {
  const date = '2026-09-24';
  const freeSlots = generateAppointmentSlots(date, [], { open: '08:00', close: '09:30', durationMinutes: 30 });
  const result = rankAppointmentSlots(date, freeSlots, ['2026-09-03T00:10:00.000Z'], { open: '08:00', close: '09:30', durationMinutes: 30 });
  assert.equal(result.traffic.historyAvailable, false);
  assert.deepEqual(result.slots.map((slot) => slot.local), freeSlots.map((slot) => slot.local));
  assert.ok(result.slots.every((slot) => slot.trafficCount === null && slot.suggestionRank === null));
});

test('appointment transitions preserve terminal states and allow only scheduled workflow steps', () => {
  assert.equal(normalizeAppointmentStatus('Pending'), 'Requested');
  assert.equal(isAppointmentTransitionAllowed('Requested', 'Scheduled'), true);
  assert.equal(isAppointmentTransitionAllowed('Requested', 'Rejected'), true);
  assert.equal(isAppointmentTransitionAllowed('Requested', 'Cancelled'), true);
  assert.equal(isAppointmentTransitionAllowed('Scheduled', 'Completed'), true);
  assert.equal(isAppointmentTransitionAllowed('Scheduled', 'Cancelled'), true);
  assert.equal(isAppointmentTransitionAllowed('Completed', 'Scheduled'), false);
  assert.equal(isAppointmentTransitionAllowed('Cancelled', 'Requested'), false);
  assert.equal(isAppointmentTransitionAllowed('Rejected', 'Scheduled'), false);
});
