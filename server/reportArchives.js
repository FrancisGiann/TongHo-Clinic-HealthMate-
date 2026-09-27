import crypto from 'node:crypto';
import { query } from './db.js';
import { loadClinicData } from './repository.js';
import { buildClinicReport, reportSnapshotForStorage } from './domain/reporting.js';

const REPORT_TYPES = ['daily', 'weekly', 'monthly'];
const DEFAULT_INTERVAL_HOURS = 6;
const DEFAULT_INITIAL_DELAY_MS = 30_000;
const DEFAULT_AUTOMATED_RETENTION_DAYS = 730;
const MAX_AUTOMATED_RETENTION_DAYS = 3650;

function configuredRetentionDays(env = process.env) {
  const value = Number(env.REPORT_ARCHIVE_RETENTION_DAYS || DEFAULT_AUTOMATED_RETENTION_DAYS);
  return Number.isInteger(value) && value >= 1 && value <= MAX_AUTOMATED_RETENTION_DAYS ? value : null;
}
const MANUAL_RETENTION_YEARS = 5;

function addDays(value, amount) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function dateParts(value) {
  const date = new Date(`${value}T00:00:00.000Z`);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth(), day: date.getUTCDay() };
}

function manilaCalendarDate(value) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function monthStart(value) {
  return `${value.slice(0, 7)}-01`;
}

function periodFromStart(type, start) {
  if (type === 'daily') return { type, start, end: start };
  if (type === 'weekly') return { type, start, end: addDays(start, 6) };
  if (type === 'monthly') {
    const nextMonth = new Date(`${monthStart(start)}T00:00:00.000Z`);
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
    const end = addDays(nextMonth.toISOString().slice(0, 10), -1);
    return { type, start: monthStart(start), end };
  }
  return null;
}

export function completedArchivePeriod(type, now = new Date()) {
  if (!REPORT_TYPES.includes(type) || !(now instanceof Date) || Number.isNaN(now.getTime())) return null;
  const today = manilaCalendarDate(now);
  if (type === 'daily') return { type, start: addDays(today, -1), end: addDays(today, -1) };
  if (type === 'weekly') {
    const currentDay = dateParts(today).day;
    const daysSinceMonday = (currentDay + 6) % 7;
    const currentWeekStart = addDays(today, -daysSinceMonday);
    const end = addDays(currentWeekStart, -1);
    return { type, start: addDays(end, -6), end };
  }
  const currentMonthStart = monthStart(today);
  const end = addDays(currentMonthStart, -1);
  return { type, start: monthStart(end), end };
}

export function missingArchivePeriods(type, latestEnd, now = new Date(), limit = MAX_AUTOMATED_RETENTION_DAYS) {
  const completed = completedArchivePeriod(type, now);
  if (!completed) return [];
  if (!latestEnd) return [completed];
  const nextStart = type === 'monthly'
    ? (() => {
      const date = new Date(`${monthStart(latestEnd)}T00:00:00.000Z`);
      date.setUTCMonth(date.getUTCMonth() + 1);
      return date.toISOString().slice(0, 10);
    })()
    : addDays(latestEnd, 1);
  const periods = [];
  let cursor = nextStart;
  while (periods.length < limit) {
    const period = periodFromStart(type, cursor);
    if (!period || period.end > completed.end) break;
    periods.push(period);
    if (type === 'monthly') {
      const nextMonth = new Date(`${period.start}T00:00:00.000Z`);
      nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
      cursor = nextMonth.toISOString().slice(0, 10);
    } else if (type === 'weekly') cursor = addDays(period.start, 7);
    else cursor = addDays(period.start, 1);
  }
  return periods;
}

export async function runReportArchiveSweep({ now = new Date(), queryFn = query, loadDataFn = loadClinicData, retentionDays = configuredRetentionDays() } = {}) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new RangeError('A valid report archive time is required.');
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > MAX_AUTOMATED_RETENTION_DAYS) throw new RangeError('Report archive retention must be 1 to 3,650 days.');
  const today = manilaCalendarDate(now);
  const periods = [];
  for (const type of REPORT_TYPES) {
    const latest = await queryFn(
      "SELECT period_end FROM report_snapshots WHERE report_type=$1 AND source='automated' ORDER BY period_end DESC LIMIT 1",
      [type],
    );
    periods.push(...missingArchivePeriods(type, latest.rows[0]?.period_end ? String(latest.rows[0].period_end).slice(0, 10) : null, now));
  }

  let created = 0;
  if (periods.length) {
    const data = await loadDataFn({ role: 'school_nurse' }, { includeClinical: true });
    for (const period of periods) {
      const report = buildClinicReport(data, period.start, period.end);
      const result = await queryFn(
        `INSERT INTO report_snapshots(id,report_type,period_start,period_end,data,created_by,source)
         VALUES($1,$2,$3,$4,$5::jsonb,NULL,'automated')
         ON CONFLICT(report_type,period_start,period_end) WHERE source='automated' DO NOTHING`,
        [crypto.randomUUID(), period.type, period.start, period.end, JSON.stringify(reportSnapshotForStorage(report))],
      );
      if (result.rowCount) {
        created += 1;
        await queryFn(
          `INSERT INTO audit_logs(actor_user_id,event,subject_type,subject_id,details)
           VALUES(NULL,'REPORT_ARCHIVE_CREATED','report',$1,$2::jsonb)`,
          [`${period.type}:${period.start}:${period.end}`, JSON.stringify({ type: period.type, start: period.start, end: period.end })],
        );
      }
    }
  }

  const retention = await queryFn(
    `DELETE FROM report_snapshots
     WHERE source='automated' AND period_end < ($1::date - $2::int)`,
    [today, retentionDays],
  );
  return { created, considered: periods.length, deleted: retention.rowCount || 0, today };
}

export function reportArchiveSchedulerSettings(env = process.env, { databaseConfigured = false } = {}) {
  const requested = env.REPORT_ARCHIVE_SCHEDULER_ENABLED === 'true';
  const intervalHours = Number(env.REPORT_ARCHIVE_INTERVAL_HOURS || DEFAULT_INTERVAL_HOURS);
  const initialDelayMs = Number(env.REPORT_ARCHIVE_INITIAL_DELAY_MS || DEFAULT_INITIAL_DELAY_MS);
  const retentionDays = configuredRetentionDays(env);
  let reason = null;
  if (!requested) reason = 'disabled';
  else if (env.NODE_ENV !== 'production') reason = 'production_only';
  else if (!databaseConfigured) reason = 'database_required';
  else if (!Number.isInteger(intervalHours) || intervalHours < 1 || intervalHours > 168) reason = 'invalid_interval';
  else if (!Number.isInteger(initialDelayMs) || initialDelayMs < 0 || initialDelayMs > 86_400_000) reason = 'invalid_initial_delay';
  else if (retentionDays === null) reason = 'invalid_retention';
  return { enabled: reason === null, reason, intervalMs: intervalHours * 60 * 60 * 1000, initialDelayMs, retentionDays };
}

export function startReportArchiveScheduler({
  run,
  env = process.env,
  databaseConfigured = false,
  logger = console,
  setTimeoutFn = setTimeout,
  setIntervalFn = setInterval,
  clearTimeoutFn = clearTimeout,
  clearIntervalFn = clearInterval,
} = {}) {
  const settings = reportArchiveSchedulerSettings(env, { databaseConfigured });
  if (!settings.enabled) {
    if (env.REPORT_ARCHIVE_SCHEDULER_ENABLED === 'true') logger.warn(`Automatic report archive not started (${settings.reason}).`);
    const stop = () => {};
    stop.drain = () => Promise.resolve();
    return stop;
  }
  if (typeof run !== 'function') throw new TypeError('A report archive job is required.');

  let stopped = false;
  let running = false;
  let runningPromise = null;
  let timeout;
  let interval;
  const execute = () => {
    if (stopped || running) return runningPromise || Promise.resolve();
    running = true;
    runningPromise = Promise.resolve().then(run)
      .catch((error) => logger.error('Automatic report archive failed.', { code: error.code || 'REPORT_ARCHIVE_ERROR' }))
      .finally(() => { running = false; runningPromise = null; });
    return runningPromise;
  };
  timeout = setTimeoutFn(() => {
    void execute();
    interval = setIntervalFn(() => void execute(), settings.intervalMs);
    interval?.unref?.();
  }, settings.initialDelayMs);
  timeout?.unref?.();
  logger.info(`Automatic report archive enabled (every ${settings.intervalMs / 3_600_000} hours).`);
  const stop = () => {
    stopped = true;
    if (timeout) clearTimeoutFn(timeout);
    if (interval) clearIntervalFn(interval);
  };
  stop.drain = () => runningPromise || Promise.resolve();
  return stop;
}
