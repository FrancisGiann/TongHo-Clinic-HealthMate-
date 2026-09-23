const manilaFormatter = new Intl.DateTimeFormat('en-PH', {
  timeZone: 'Asia/Manila',
  dateStyle: 'medium',
  timeStyle: 'short',
});

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
