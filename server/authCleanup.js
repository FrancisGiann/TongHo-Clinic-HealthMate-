import { databaseConfigured } from './db.js';
import { clearExpiredGuardianSignupOtpMetadata } from './auth.js';

export function startGuardianSignupOtpCleanupScheduler({
  run = () => clearExpiredGuardianSignupOtpMetadata(),
  enabled = databaseConfigured,
  env = process.env,
  intervalMs = 60 * 60 * 1000,
  initialDelayMs = 0,
  setTimeoutFn = setTimeout,
  setIntervalFn = setInterval,
  clearTimeoutFn = clearTimeout,
  clearIntervalFn = clearInterval,
} = {}) {
  if (!enabled || String(env.GUARDIAN_SIGNUP_OTP_CLEANUP_ENABLED || '').trim().toLowerCase() === 'false') {
    const stop = () => Promise.resolve();
    stop.drain = stop;
    return stop;
  }
  let stopped = false;
  let running = false;
  let pending;
  let active = Promise.resolve();
  const drain = () => active;
  const tick = async () => {
    if (stopped || running) return;
    running = true;
    active = Promise.resolve().then(run).catch((error) => {
      console.error('Expired guardian signup metadata cleanup failed:', String(error?.code || 'OTP_CLEANUP_FAILED').slice(0, 60));
    }).finally(() => { running = false; });
    await active;
  };
  pending = setTimeoutFn(() => {
    void tick();
    if (!stopped) pending = setIntervalFn(() => { void tick(); }, intervalMs);
  }, Math.max(0, Number(initialDelayMs) || 0));
  const stop = () => {
    stopped = true;
    if (pending) {
      clearTimeoutFn(pending);
      clearIntervalFn(pending);
    }
    return drain();
  };
  stop.drain = drain;
  return stop;
}
