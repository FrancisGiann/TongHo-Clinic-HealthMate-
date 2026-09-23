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
  const busy = new Set(existingStarts.map((value) => clinicDateTime(value).getTime()).filter(Number.isFinite));
  const slots = [];
  for (let offset = openMinutes; offset + durationMinutes <= closeMinutes; offset += durationMinutes) {
    const hour = String(Math.floor(offset / 60)).padStart(2, '0');
    const minute = String(offset % 60).padStart(2, '0');
    const local = `${date}T${hour}:${minute}`;
    const startsAt = clinicDateTime(local);
    if (clinicToday === date && startsAt.getTime() <= now.getTime()) continue;
    if (!busy.has(startsAt.getTime())) slots.push({ local, startsAt: startsAt.toISOString() });
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

export function normalizeAppointmentStatus(status) {
  return APPOINTMENT_STATUS_ALIASES[String(status || '')] || String(status || 'Requested');
}

export function isAppointmentTransitionAllowed(currentStatus, nextStatus) {
  const current = normalizeAppointmentStatus(currentStatus);
  const next = normalizeAppointmentStatus(nextStatus);
  return current === next || Boolean(APPOINTMENT_TRANSITIONS[current]?.has(next));
}
