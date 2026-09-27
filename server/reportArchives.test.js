import test from 'node:test';
import assert from 'node:assert/strict';
import {
  completedArchivePeriod,
  missingArchivePeriods,
  reportArchiveSchedulerSettings,
  runReportArchiveSweep,
  startReportArchiveScheduler,
} from './reportArchives.js';

test('archive periods use completed Asia/Manila calendar dates', () => {
  const now = new Date('2026-09-23T02:00:00.000Z');
  assert.deepEqual(completedArchivePeriod('daily', now), { type: 'daily', start: '2026-09-22', end: '2026-09-22' });
  assert.deepEqual(completedArchivePeriod('weekly', now), { type: 'weekly', start: '2026-09-14', end: '2026-09-20' });
  assert.deepEqual(completedArchivePeriod('monthly', now), { type: 'monthly', start: '2026-08-01', end: '2026-08-31' });
  assert.deepEqual(missingArchivePeriods('daily', '2026-09-19', now).map(({ start }) => start), ['2026-09-20', '2026-09-21', '2026-09-22']);
  assert.deepEqual(missingArchivePeriods('weekly', null, now), [{ type: 'weekly', start: '2026-09-14', end: '2026-09-20' }]);
});

test('report archives are opt-in and require production plus a configured database', () => {
  assert.equal(reportArchiveSchedulerSettings({}).reason, 'disabled');
  assert.equal(reportArchiveSchedulerSettings({ REPORT_ARCHIVE_SCHEDULER_ENABLED: 'true', NODE_ENV: 'development' }, { databaseConfigured: true }).reason, 'production_only');
  assert.equal(reportArchiveSchedulerSettings({ REPORT_ARCHIVE_SCHEDULER_ENABLED: 'true', NODE_ENV: 'production' }).reason, 'database_required');
  assert.equal(reportArchiveSchedulerSettings({ REPORT_ARCHIVE_SCHEDULER_ENABLED: 'true', NODE_ENV: 'production' }, { databaseConfigured: true }).enabled, true);
  assert.equal(reportArchiveSchedulerSettings({ REPORT_ARCHIVE_SCHEDULER_ENABLED: 'true', NODE_ENV: 'production', REPORT_ARCHIVE_RETENTION_DAYS: '0' }, { databaseConfigured: true }).reason, 'invalid_retention');
});

test('archive sweep creates missing period snapshots idempotently and applies retention', async () => {
  const now = new Date('2026-09-23T02:00:00.000Z');
  const calls = [];
  const latest = { daily: '2026-09-19', weekly: null, monthly: null };
  const result = await runReportArchiveSweep({
    now,
    loadDataFn: async (user, options) => {
      assert.equal(user.role, 'school_nurse');
      assert.equal(options.includeClinical, true);
      return { students: [], visits: [], incidents: [], appointments: [], dispenseLogs: [], screenings: [], immunizations: [] };
    },
    queryFn: async (sql, params) => {
      calls.push([sql, params]);
      if (sql.startsWith('SELECT period_end')) return { rows: latest[params[0]] ? [{ period_end: latest[params[0]] }] : [] };
      if (sql.startsWith('INSERT INTO report_snapshots')) return { rowCount: 1 };
      if (sql.startsWith('INSERT INTO audit_logs')) return { rowCount: 1 };
      if (sql.startsWith('DELETE FROM report_snapshots')) return { rowCount: 2 };
      throw new Error('Unexpected archive query.');
    },
  });
  assert.deepEqual(result, { created: 5, considered: 5, deleted: 2, today: '2026-09-23' });
  assert.equal(calls.filter(([sql]) => sql.startsWith('INSERT INTO report_snapshots')).length, 5);
  const insert = calls.find(([sql]) => sql.startsWith('INSERT INTO report_snapshots'));
  assert.match(insert[0], /source='automated'/);
  assert.match(insert[0], /ON CONFLICT/);
  const retention = calls.find(([sql]) => sql.startsWith('DELETE FROM report_snapshots'));
  assert.match(retention[0], /source='automated'/);
  assert.doesNotMatch(retention[0], /source='manual'/);
  assert.deepEqual(retention[1], ['2026-09-23', 730]);
});

test('archive scheduler drains active jobs and skips overlapping ticks', async () => {
  const env = { NODE_ENV: 'production', REPORT_ARCHIVE_SCHEDULER_ENABLED: 'true', REPORT_ARCHIVE_INTERVAL_HOURS: '1', REPORT_ARCHIVE_INITIAL_DELAY_MS: '0' };
  let firstRunResolve;
  let initialCallback;
  let intervalCallback;
  let runCount = 0;
  const firstRun = new Promise((resolve) => { firstRunResolve = resolve; });
  const stop = startReportArchiveScheduler({
    run: () => { runCount += 1; return runCount === 1 ? firstRun : Promise.resolve(); },
    env,
    databaseConfigured: true,
    logger: { info() {}, warn() {}, error() {} },
    setTimeoutFn: (callback) => { initialCallback = callback; return { unref() {} }; },
    setIntervalFn: (callback) => { intervalCallback = callback; return { unref() {} }; },
    clearTimeoutFn() {}, clearIntervalFn() {},
  });
  initialCallback();
  await Promise.resolve();
  intervalCallback();
  await Promise.resolve();
  assert.equal(runCount, 1);
  firstRunResolve();
  await stop.drain();
  stop();
});
