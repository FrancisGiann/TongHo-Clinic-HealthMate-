const DEFAULT_INTERVAL_HOURS = 24;
const DEFAULT_INITIAL_DELAY_MS = 30_000;

export function reminderSchedulerSettings(env = process.env, { databaseConfigured = false, emailConfigured = false } = {}) {
  const requested = env.CLINIC_REMINDER_SCHEDULER_ENABLED === 'true';
  const intervalHours = Number(env.CLINIC_REMINDER_INTERVAL_HOURS || DEFAULT_INTERVAL_HOURS);
  const initialDelayMs = Number(env.CLINIC_REMINDER_INITIAL_DELAY_MS || DEFAULT_INITIAL_DELAY_MS);
  let reason = null;
  if (!requested) reason = 'disabled';
  else if (env.NODE_ENV !== 'production') reason = 'production_only';
  else if (!databaseConfigured) reason = 'database_required';
  else if (!emailConfigured) reason = 'smtp_required';
  else if (!Number.isInteger(intervalHours) || intervalHours < 1 || intervalHours > 168) reason = 'invalid_interval';
  else if (!Number.isInteger(initialDelayMs) || initialDelayMs < 0 || initialDelayMs > 86_400_000) reason = 'invalid_initial_delay';
  return {
    enabled: reason === null,
    reason,
    intervalMs: intervalHours * 60 * 60 * 1000,
    initialDelayMs,
  };
}

export function startClinicReminderScheduler({
  run,
  env = process.env,
  databaseConfigured = false,
  emailConfigured = false,
  logger = console,
  setTimeoutFn = setTimeout,
  setIntervalFn = setInterval,
  clearTimeoutFn = clearTimeout,
  clearIntervalFn = clearInterval,
} = {}) {
  const settings = reminderSchedulerSettings(env, { databaseConfigured, emailConfigured });
  if (!settings.enabled) {
    if (env.CLINIC_REMINDER_SCHEDULER_ENABLED === 'true') {
      logger.warn(`Automatic clinic reminders not started (${settings.reason}).`);
    }
    const stop = () => {};
    stop.drain = () => Promise.resolve();
    return stop;
  }
  if (typeof run !== 'function') throw new TypeError('A reminder job is required.');

  let stopped = false;
  let running = false;
  let runningPromise = null;
  let timeout;
  let interval;
  const execute = () => {
    if (stopped || running) return runningPromise || Promise.resolve();
    running = true;
    runningPromise = Promise.resolve()
      .then(run)
      .catch((error) => logger.error('Automatic clinic reminder run failed.', { code: error.code || 'REMINDER_JOB_ERROR' }))
      .finally(() => {
        running = false;
        runningPromise = null;
      });
    return runningPromise;
  };

  timeout = setTimeoutFn(() => {
    void execute();
    interval = setIntervalFn(() => void execute(), settings.intervalMs);
    interval?.unref?.();
  }, settings.initialDelayMs);
  timeout?.unref?.();
  logger.info(`Automatic clinic reminders enabled (every ${settings.intervalMs / 3_600_000} hours).`);

  const stop = () => {
    stopped = true;
    if (timeout) clearTimeoutFn(timeout);
    if (interval) clearIntervalFn(interval);
  };
  stop.drain = () => runningPromise || Promise.resolve();
  return stop;
}
