export const PAGE_SIZES = Object.freeze([10, 25, 50]);

export function readListState(params, defaults = {}) {
  const page = Number.parseInt(params.get('page') || '1', 10);
  const pageSize = Number.parseInt(params.get('pageSize') || String(defaults.pageSize || 25), 10);
  return {
    q: params.get('q') || '',
    sort: params.get('sort') || defaults.sort || 'name',
    order: ['asc', 'desc'].includes(params.get('order')) ? params.get('order') : (defaults.order || 'asc'),
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
    pageSize: PAGE_SIZES.includes(pageSize) ? pageSize : (PAGE_SIZES.includes(defaults.pageSize) ? defaults.pageSize : 25),
  };
}

export function updateListParams(params, setParams, updates, { resetPage = false, replace = false } = {}) {
  const next = new URLSearchParams(params);
  for (const [key, value] of Object.entries(updates)) {
    if (value === null || value === undefined || value === '') next.delete(key);
    else next.set(key, String(value));
  }
  if (resetPage && !Object.prototype.hasOwnProperty.call(updates, 'page')) next.delete('page');
  setParams(next, { replace });
}

export function compareValues(first, second, direction = 'asc') {
  const firstMissing = first === null || first === undefined || first === '' || (typeof first === 'number' && !Number.isFinite(first));
  const secondMissing = second === null || second === undefined || second === '' || (typeof second === 'number' && !Number.isFinite(second));
  if (firstMissing || secondMissing) return firstMissing === secondMissing ? 0 : firstMissing ? 1 : -1;
  let result;
  if (typeof first === 'number' && typeof second === 'number') result = first - second;
  else result = String(first).localeCompare(String(second), undefined, { numeric: true, sensitivity: 'base' });
  return direction === 'desc' ? -result : result;
}

export function manilaDateTimeKey(date, time = '') {
  if (typeof date !== 'string' || !date.trim()) return null;
  const raw = date.trim();
  let candidate = raw;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const parsedTime = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i.exec(String(time || '00:00').trim());
    if (!parsedTime) return null;
    let hour = Number(parsedTime[1]);
    if (parsedTime[4]) hour = (hour % 12) + (parsedTime[4].toUpperCase() === 'PM' ? 12 : 0);
    if (hour > 23 || Number(parsedTime[2]) > 59 || Number(parsedTime[3] || 0) > 59) return null;
    candidate = `${raw}T${String(hour).padStart(2, '0')}:${parsedTime[2]}:${parsedTime[3] || '00'}+08:00`;
  } else if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(raw)) {
    candidate = `${raw.replace(' ', 'T')}+08:00`;
  }
  const value = Date.parse(candidate);
  return Number.isFinite(value) ? value : null;
}

export function sortAndPaginate(records, compare, { page = 1, pageSize = 25, order = 'asc' } = {}) {
  const sorted = [...records].sort((first, second) => {
    const result = compare(first, second, order) || 0;
    return result || String(first?.id ?? '').localeCompare(String(second?.id ?? ''), undefined, { numeric: true, sensitivity: 'base' });
  });
  const safeSize = PAGE_SIZES.includes(pageSize) ? pageSize : 25;
  const pageCount = Math.max(1, Math.ceil(sorted.length / safeSize));
  const safePage = Math.min(Math.max(1, Number.isInteger(page) ? page : 1), pageCount);
  const start = (safePage - 1) * safeSize;
  return { items: sorted.slice(start, start + safeSize), page: safePage, pageSize: safeSize, pageCount, total: sorted.length };
}
