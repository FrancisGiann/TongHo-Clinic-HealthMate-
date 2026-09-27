export const SESSION_ABSOLUTE_TTL_MS = 12 * 60 * 60 * 1000;
export const SESSION_IDLE_TTL_MS = 15 * 60 * 1000;
export const MAX_CONCURRENT_SESSIONS = 3;

export function sessionCookieMaxAgeSeconds(remember, expiresAt, now = Date.now()) {
  if (!remember) return null;
  const remainingMs = Math.max(0, new Date(expiresAt).getTime() - now);
  return Math.floor(Math.min(SESSION_ABSOLUTE_TTL_MS, remainingMs) / 1000);
}
