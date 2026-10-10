const manilaFormatter = new Intl.DateTimeFormat('en-PH', {
  timeZone: 'Asia/Manila',
  dateStyle: 'medium',
  timeStyle: 'short',
});
const manilaDatePartsFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Manila',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function manilaCalendarDate(value = new Date()) {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(manilaDatePartsFormatter.formatToParts(date)
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function shiftCalendarDate(value, dayOffset) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isInteger(dayOffset)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  date.setUTCDate(date.getUTCDate() + dayOffset);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

export function formatManilaDateTime(value, time = '') {
  if (!value) return 'Not scheduled';
  const raw = String(value).trim();
  const timeMatch = /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i.exec(String(time).trim());
  const hourValue = timeMatch ? Number(timeMatch[1]) : 0;
  const meridiem = timeMatch?.[3]?.toUpperCase();
  const hour = meridiem ? (hourValue % 12) + (meridiem === 'PM' ? 12 : 0) : hourValue;
  const localTime = timeMatch ? `${String(hour).padStart(2, '0')}:${timeMatch[2]}` : '00:00';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(`${raw}T${localTime}:00+08:00`)
    : new Date(raw);
  return Number.isNaN(date.getTime()) ? 'Not scheduled' : manilaFormatter.format(date);
}
