import test from 'node:test';
import assert from 'node:assert/strict';
import { reminderSchedulerSettings, startClinicReminderScheduler } from './reminderScheduler.js';

const productionEnv = {
  NODE_ENV: 'production',
  CLINIC_REMINDER_SCHEDULER_ENABLED: 'true',
  CLINIC_REMINDER_INTERVAL_HOURS: '1',
  CLINIC_REMINDER_INITIAL_DELAY_MS: '0',
};

test('reminder scheduler is opt-in and production/configuration guarded', () => {
  assert.equal(reminderSchedulerSettings({ NODE_ENV: 'development' }).reason, 'disabled');
  assert.equal(reminderSchedulerSettings({ ...productionEnv, NODE_ENV: 'development' }, { databaseConfigured: true, emailConfigured: true }).reason, 'production_only');
  assert.equal(reminderSchedulerSettings(productionEnv, { databaseConfigured: false, emailConfigured: true }).reason, 'database_required');
  assert.equal(reminderSchedulerSettings(productionEnv, { databaseConfigured: true, emailConfigured: false }).reason, 'smtp_required');
  assert.equal(reminderSchedulerSettings({ ...productionEnv, CLINIC_REMINDER_INTERVAL_HOURS: '0' }, { databaseConfigured: true, emailConfigured: true }).reason, 'invalid_interval');
  assert.equal(reminderSchedulerSettings(productionEnv, { databaseConfigured: true, emailConfigured: true }).enabled, true);
});

test('disabled scheduler exposes a safe drain hook for server shutdown', async () => {
  const stop = startClinicReminderScheduler({ env: { NODE_ENV: 'development' } });
  assert.equal(typeof stop, 'function');
  assert.equal(typeof stop.drain, 'function');
  await stop.drain();
});

test('scheduler delays the first run and skips overlapping interval ticks', async () => {
  let runCount = 0;
  let firstRunResolve;
  let initialCallback;
  let intervalCallback;
  let intervalDuration;
  const firstRun = new Promise((resolve) => { firstRunResolve = resolve; });
  const stop = startClinicReminderScheduler({
    run: () => {
      runCount += 1;
      return runCount === 1 ? firstRun : Promise.resolve();
    },
    env: productionEnv,
    databaseConfigured: true,
    emailConfigured: true,
    logger: { info() {}, warn() {}, error() {} },
    setTimeoutFn: (callback, delay) => { initialCallback = callback; assert.equal(delay, 0); return { unref() {} }; },
    setIntervalFn: (callback, delay) => { intervalCallback = callback; intervalDuration = delay; return { unref() {} }; },
    clearTimeoutFn() {},
    clearIntervalFn() {},
  });

  assert.equal(runCount, 0);
  initialCallback();
  await Promise.resolve();
  assert.equal(runCount, 1);
  assert.equal(intervalDuration, 60 * 60 * 1000);
  intervalCallback();
  await Promise.resolve();
  assert.equal(runCount, 1);

  firstRunResolve();
  await stop.drain();
  intervalCallback();
  await Promise.resolve();
  assert.equal(runCount, 2);
  stop();
});
