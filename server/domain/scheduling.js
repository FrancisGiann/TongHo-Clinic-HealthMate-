const DEFAULT_HOURS = Object.freeze({ open: '08:00', close: '16:00', durationMinutes: 30 });
const CLINIC_TIME_ZONE = 'Asia/Manila';
const TRAFFIC_LOOKBACK_DAYS = 90;
const MINIMUM_TRAFFIC_SAMPLE_VISITS = 8;
const MINIMUM_TRAFFIC_SAMPLE_DAYS = 3;
const WEEKDAY_INDEX = Object.freeze({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 });
const clinicTrafficFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: CLINIC_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const clinicDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: CLINIC_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const APPOINTMENT_STATUS_ALIASES = Object.freeze({ Pending: 'Requested' });
const APPOINTMENT_TRANSITIONS = Object.freeze({
  Requested: new Set(['Scheduled', 'Rejected', 'Cancelled']),
  Scheduled: new Set(['Completed', 'Cancelled']),
  Completed: new Set(),
  Cancelled: new Set(),
  Rejected: new Set(),
});

function minutes(value) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value || ''));
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export function isValidAppointmentDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function clinicWeekday(date) {
  return new Date(`${date}T12:00:00+08:00`).getUTCDay();
}

function clinicCalendarDate(value) {
  const parts = Object.fromEntries(clinicDateFormatter.formatToParts(value)
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function clinicVisitTime(value) {
  const date = clinicDateTime(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = Object.fromEntries(clinicTrafficFormatter.formatToParts(date)
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, part.value]));
  const weekday = WEEKDAY_INDEX[parts.weekday];
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  if (weekday === undefined || !Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  return { weekday, minuteOfDay: hour * 60 + minute, localDate: `${parts.year}-${parts.month}-${parts.day}` };
}

export function clinicDateTime(value) {
  if (value instanceof Date) return value;
  const raw = String(value || '').trim();
  if (!raw) return new Date(NaN);
  return new Date(/(?:Z|[+-]\d{2}:?\d{2})$/.test(raw) ? raw : `${raw}:00+08:00`);
}

export function generateAppointmentSlots(date, existingStarts = [], options = {}) {
  const open = options.open || DEFAULT_HOURS.open;
  const close = options.close || DEFAULT_HOURS.close;
  const durationMinutes = Number(options.durationMinutes || DEFAULT_HOURS.durationMinutes);
  const openMinutes = minutes(open);
  const closeMinutes = minutes(close);
  if (!isValidAppointmentDate(date) || openMinutes === null || closeMinutes === null || closeMinutes <= openMinutes || !Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 240) return [];
  const now = options.now === undefined ? null : clinicDateTime(options.now);
  if (now && !Number.isFinite(now.getTime())) return [];
  const clinicToday = now ? clinicCalendarDate(now) : null;
  if (clinicToday && date < clinicToday) return [];
  const weekday = clinicWeekday(date);
  if (weekday === 0 || weekday === 6) return [];
  const busy = existingStarts.map((value) => clinicDateTime(value)).filter((value) => Number.isFinite(value.getTime()));
  const slots = [];
  for (let offset = openMinutes; offset + durationMinutes <= closeMinutes; offset += durationMinutes) {
    const hour = String(Math.floor(offset / 60)).padStart(2, '0');
    const minute = String(offset % 60).padStart(2, '0');
    const local = `${date}T${hour}:${minute}`;
    const startsAt = clinicDateTime(local);
    if (clinicToday === date && startsAt.getTime() <= now.getTime()) continue;
    const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);
    if (!busy.some((occupied) => intervalsOverlap(startsAt, endsAt, occupied, new Date(occupied.getTime() + durationMinutes * 60_000)))) {
      slots.push({ local, startsAt: startsAt.toISOString() });
    }
  }
  return slots;
}

export function rankAppointmentSlots(date, slots = [], visitTimestamps = [], options = {}) {
  const openMinutes = minutes(options.open || DEFAULT_HOURS.open);
  const closeMinutes = minutes(options.close || DEFAULT_HOURS.close);
  const durationMinutes = Number(options.durationMinutes || DEFAULT_HOURS.durationMinutes);
  const validSchedule = openMinutes !== null
    && closeMinutes !== null
    && closeMinutes > openMinutes
    && Number.isInteger(durationMinutes)
    && durationMinutes >= 15
    && durationMinutes <= 240;
  const weekday = isValidAppointmentDate(date) ? clinicWeekday(date) : null;
  const sampleVisits = validSchedule && weekday !== null
    ? visitTimestamps.map(clinicVisitTime)
      .filter((visit) => visit
        && visit.weekday === weekday
        && visit.minuteOfDay >= openMinutes
        && visit.minuteOfDay < closeMinutes)
    : [];
  const sampleDays = new Set(sampleVisits.map((visit) => visit.localDate)).size;
  const sufficientHistory = sampleVisits.length >= MINIMUM_TRAFFIC_SAMPLE_VISITS
    && sampleDays >= MINIMUM_TRAFFIC_SAMPLE_DAYS;
  const traffic = {
    lookbackDays: TRAFFIC_LOOKBACK_DAYS,
    historyAvailable: sufficientHistory,
  };

  if (!sufficientHistory) {
    return {
      slots: [...slots].sort((left, right) => left.local.localeCompare(right.local))
        .map((slot) => ({ ...slot, trafficCount: null, suggestionRank: null })),
      traffic,
    };
  }

  const ranked = slots.map((slot) => {
    const start = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):([0-5]\d)$/.exec(slot.local || '');
    const startMinute = start ? Number(start[1]) * 60 + Number(start[2]) : null;
    const trafficCount = startMinute === null ? 0 : sampleVisits.filter((visit) => (
      visit.minuteOfDay >= startMinute && visit.minuteOfDay < startMinute + durationMinutes
    )).length;
    return { ...slot, trafficCount };
  }).sort((left, right) => left.trafficCount - right.trafficCount || left.local.localeCompare(right.local));

  return {
    slots: ranked.map((slot, index) => ({ ...slot, suggestionRank: index + 1 })),
    traffic,
  };
}

export function appointmentSettings(settings = {}) {
  return {
    open: settings.clinicOpenTime || DEFAULT_HOURS.open,
    close: settings.clinicCloseTime || DEFAULT_HOURS.close,
    durationMinutes: Number(settings.appointmentDurationMinutes || DEFAULT_HOURS.durationMinutes),
  };
}

function nextCalendarDate(value) {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function validateUnavailablePeriod(payload = {}) {
  const date = String(payload.date || '');
  const fullDay = payload.fullDay === true;
  const reason = typeof payload.reason === 'string' ? payload.reason.trim() : '';
  if (!isValidAppointmentDate(date)) return { valid: false, code: 'INVALID_DATE', message: 'Choose a real clinic date.' };
  if (!reason || reason.length > 500) return { valid: false, code: 'INVALID_REASON', message: 'Enter a reason from 1 to 500 characters.' };
  let startsAt;
  let endsAt;
  if (fullDay) {
    startsAt = new Date(`${date}T00:00:00+08:00`);
    endsAt = new Date(`${nextCalendarDate(date)}T00:00:00+08:00`);
  } else {
    const startTime = String(payload.startTime || '');
    const endTime = String(payload.endTime || '');
    if (minutes(startTime) === null || minutes(endTime) === null || minutes(endTime) <= minutes(startTime)) {
      return { valid: false, code: 'INVALID_TIME_RANGE', message: 'Choose a valid same-day start and end time.' };
    }
    startsAt = new Date(`${date}T${startTime}:00+08:00`);
    endsAt = new Date(`${date}T${endTime}:00+08:00`);
  }
  return { valid: true, value: { date, fullDay, startsAt, endsAt, reason } };
}

export function intervalsOverlap(firstStart, firstEnd, secondStart, secondEnd) {
  const a = new Date(firstStart).getTime();
  const b = new Date(firstEnd).getTime();
  const c = new Date(secondStart).getTime();
  const d = new Date(secondEnd).getTime();
  return [a, b, c, d].every(Number.isFinite) && a < d && c < b;
}

export function unavailablePeriodsForSlot(startsAt, durationMinutes, periods = []) {
  const start = clinicDateTime(startsAt);
  if (!Number.isFinite(start.getTime()) || !Number.isInteger(Number(durationMinutes))) return false;
  const end = new Date(start.getTime() + Number(durationMinutes) * 60_000);
  return periods.some((period) => intervalsOverlap(start, end, period.starts_at || period.startsAt, period.ends_at || period.endsAt));
}

export function appointmentRowsOverlappingPeriod(rows = [], startsAt, endsAt, durationMinutes = 30) {
  return rows.filter((row) => {
    const status = normalizeAppointmentStatus(row.status);
    if (!['Requested', 'Scheduled'].includes(status)) return false;
    const start = row.starts_at || row.startsAt || row.date;
    const parsed = clinicDateTime(start);
    if (!Number.isFinite(parsed.getTime())) return false;
    const end = new Date(parsed.getTime() + Number(durationMinutes) * 60_000);
    return intervalsOverlap(parsed, end, startsAt, endsAt);
  });
}

export function sortedManilaDayLockKeys(...dates) {
  return [...new Set(dates.filter(isValidAppointmentDate).map((date) => `appointment-day:${date}`))].sort();
}

export function normalizeAppointmentStatus(status) {
  return APPOINTMENT_STATUS_ALIASES[String(status || '')] || String(status || 'Requested');
}

export function isAppointmentTransitionAllowed(currentStatus, nextStatus) {
  const current = normalizeAppointmentStatus(currentStatus);
  const next = normalizeAppointmentStatus(nextStatus);
  return current === next || Boolean(APPOINTMENT_TRANSITIONS[current]?.has(next));
}
