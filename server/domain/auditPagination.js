const PAGE_SIZES = new Set([10, 25, 50]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value) {
  if (!DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function nextDate(value) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function decodeAuditCursor(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!parsed || !['next', 'previous'].includes(parsed.direction)
      || typeof parsed.createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/.test(parsed.createdAt)
      || !Number.isFinite(Date.parse(parsed.createdAt)) || typeof parsed.id !== 'string' || !/^[1-9]\d{0,18}$/.test(parsed.id)
      || !['newest', 'oldest'].includes(parsed.order)
      || !(parsed.event === null || (typeof parsed.event === 'string' && parsed.event.length <= 80))
      || !(parsed.actorId === null || parsed.actorId === 'system' || (typeof parsed.actorId === 'string' && UUID.test(parsed.actorId)))
      || !(parsed.start === null || (typeof parsed.start === 'string' && validDate(parsed.start)))
      || !(parsed.end === null || (typeof parsed.end === 'string' && validDate(parsed.end)))) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function encodeAuditCursor({ direction, row, order, filters }) {
  const createdAt = row?.cursor_created_at;
  const id = String(row?.id || '');
  if (!['next', 'previous'].includes(direction) || typeof createdAt !== 'string' || !/^[1-9]\d{0,18}$/.test(id)) return null;
  return Buffer.from(JSON.stringify({
    direction, createdAt, id, order,
    event: filters.event || null, actorId: filters.actorId || null,
    start: filters.start || null, end: filters.end || null,
  })).toString('base64url');
}

export function validateAuditPageQuery(query = {}) {
  const rawLimit = query.limit === undefined ? '25' : String(query.limit);
  const limit = Number(rawLimit);
  const order = query.order === undefined ? 'newest' : String(query.order);
  const event = query.event == null || query.event === '' ? null : String(query.event);
  const actorId = query.actorId == null || query.actorId === '' ? null : String(query.actorId);
  const start = query.start == null || query.start === '' ? null : String(query.start);
  const end = query.end == null || query.end === '' ? null : String(query.end);
  if (!PAGE_SIZES.has(limit)) return { valid: false, message: 'Page size must be 10, 25, or 50.' };
  if (!['newest', 'oldest'].includes(order)) return { valid: false, message: 'Sort order must be newest or oldest.' };
  if (event && (event.length > 80 || !/^[A-Z0-9_]+$/.test(event))) return { valid: false, message: 'Choose a valid audit event.' };
  if (actorId && actorId !== 'system' && !UUID.test(actorId)) return { valid: false, message: 'Choose a valid audit actor.' };
  if (start && !validDate(start)) return { valid: false, message: 'Start date must be a valid calendar date.' };
  if (end && !validDate(end)) return { valid: false, message: 'End date must be a valid calendar date.' };
  if (start && end && start > end) return { valid: false, message: 'Start date must be on or before end date.' };
  const cursor = query.cursor == null || query.cursor === '' ? null : decodeAuditCursor(String(query.cursor));
  if (query.cursor && !cursor) return { valid: false, message: 'The audit page cursor is invalid or expired.' };
  if (cursor && (cursor.order !== order || cursor.event !== event || cursor.actorId !== actorId || cursor.start !== start || cursor.end !== end)) {
    return { valid: false, message: 'The audit page cursor does not match the selected filters.' };
  }
  return { valid: true, value: { limit, order, event, actorId, start, end, cursor } };
}

export function buildAuditPageQuery(filters) {
  const { limit, order, event, actorId, start, end, cursor } = filters;
  const clauses = [];
  const params = [];
  const add = (value) => { params.push(value); return `$${params.length}`; };
  if (event) clauses.push(`l.event=${add(event)}`);
  if (actorId === 'system') clauses.push('l.actor_user_id IS NULL');
  else if (actorId) clauses.push(`l.actor_user_id=${add(actorId)}::uuid`);
  if (start) clauses.push(`l.created_at>=${add(`${start}T00:00:00+08:00`)}::timestamptz`);
  if (end) clauses.push(`l.created_at<${add(`${nextDate(end)}T00:00:00+08:00`)}::timestamptz`);
  const descending = order === 'newest';
  const forwardComparator = descending ? '<' : '>';
  const reverseComparator = descending ? '>' : '<';
  let reverse = false;
  if (cursor) {
    reverse = cursor.direction === 'previous';
    const comparator = reverse ? reverseComparator : forwardComparator;
    const timeParam = add(cursor.createdAt);
    const idParam = add(cursor.id);
    clauses.push(`(l.created_at,l.id) ${comparator} (${timeParam}::timestamptz,${idParam}::bigint)`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const sqlOrder = descending ? (reverse ? 'ASC' : 'DESC') : (reverse ? 'DESC' : 'ASC');
  params.push(limit + 1);
  const sql = `SELECT l.*,to_char(l.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at,u.name AS actor_name,u.email AS actor_email
    FROM audit_logs l LEFT JOIN users u ON u.id=l.actor_user_id ${where}
    ORDER BY l.created_at ${sqlOrder},l.id ${sqlOrder} LIMIT $${params.length}`;
  return { sql, params, reverse, descending, limit };
}

export function formatAuditPage(rows, query) {
  const extra = rows.length > query.limit;
  let visibleRows = rows.slice(0, query.limit);
  if (query.reverse) visibleRows = visibleRows.reverse();
  const hasPrevious = query.cursor ? (query.reverse ? extra : true) : false;
  const hasNext = query.cursor ? (query.reverse ? true : extra) : extra;
  const filters = query;
  return {
    logs: visibleRows,
    previousCursor: hasPrevious && visibleRows.length ? encodeAuditCursor({ direction: 'previous', row: visibleRows[0], order: query.order, filters }) : null,
    nextCursor: hasNext && visibleRows.length ? encodeAuditCursor({ direction: 'next', row: visibleRows.at(-1), order: query.order, filters }) : null,
    hasPrevious,
    hasNext,
  };
}
