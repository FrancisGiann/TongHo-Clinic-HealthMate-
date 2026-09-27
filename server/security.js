const DEV_ORIGIN_HOSTS = ['localhost', '127.0.0.1', '[::1]'];
const DEV_VITE_PORTS = Array.from({ length: 7 }, (_, index) => 5173 + index);

function normalizedOrigin(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function allowedOrigins(env = process.env) {
  const configured = [env.APP_URL];
  if (env.NODE_ENV === 'development') {
    configured.push(env.DEV_APP_URL);
    for (const host of DEV_ORIGIN_HOSTS) {
      for (const port of DEV_VITE_PORTS) configured.push(`http://${host}:${port}`);
    }
  }
  return [...new Set(configured.map(normalizedOrigin).filter(Boolean))];
}

export function requestOriginAllowed(origin, env = process.env) {
  return !origin || allowedOrigins(env).includes(normalizedOrigin(origin));
}

export function ensureSameOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (requestOriginAllowed(req.headers.origin)) return next();
  return res.status(403).json({
    error: { code: 'ORIGIN_REJECTED', message: 'The request origin is not allowed.' },
  });
}

export function loginOtpRequired(env = process.env) {
  return env.NODE_ENV !== 'development' || env.REQUIRE_LOGIN_OTP !== 'false';
}

export function productionStartupIssue({ nodeEnv, databaseConfigured, databaseTlsVerified, emailConfigured, smtpTlsVerified, hasDevelopmentAccounts, hasSeedRegistry }) {
  if (nodeEnv !== 'production') return null;
  if (!databaseConfigured) return 'Production requires DATABASE_URL.';
  if (!databaseTlsVerified) return 'Production requires verified PostgreSQL TLS.';
  if (!emailConfigured) return 'Production requires configured SMTP because email verification is mandatory.';
  if (!smtpTlsVerified) return 'Production requires certificate-verified SMTP TLS.';
  if (hasDevelopmentAccounts || hasSeedRegistry) return 'Production database contains development-only seed data.';
  return null;
}

export function trustProxyHops(env = process.env) {
  const configured = env.TRUST_PROXY_HOPS;
  if (configured === undefined || configured === '') return 0;
  if (!/^\d+$/.test(String(configured))) throw new Error('TRUST_PROXY_HOPS must be an integer from 0 to 5.');
  const hops = Number(configured);
  if (!Number.isSafeInteger(hops) || hops < 0 || hops > 5) throw new Error('TRUST_PROXY_HOPS must be an integer from 0 to 5.');
  return hops;
}

export function createWindowLimiter({ limit, windowMs, maxKeys = 10_000 }) {
  const buckets = new Map();
  return (key, now = Date.now()) => {
    const normalizedKey = String(key || 'unknown');
    let bucket = buckets.get(normalizedKey);
    if (!bucket || bucket.resetAt <= now) {
      if (buckets.size >= maxKeys) {
        for (const [entryKey, entry] of buckets) {
          if (entry.resetAt <= now || buckets.size >= maxKeys) buckets.delete(entryKey);
          if (buckets.size < maxKeys) break;
        }
      }
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(normalizedKey, bucket);
    }
    bucket.count += 1;
    return {
      allowed: bucket.count <= limit,
      remaining: Math.max(0, limit - bucket.count),
      retryAfterMs: Math.max(0, bucket.resetAt - now),
    };
  };
}

export function rateLimit({ limit, windowMs, key = (req) => req.ip }) {
  const check = createWindowLimiter({ limit, windowMs });
  return (req, res, next) => {
    const result = check(key(req));
    if (result.allowed) return next();
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil(result.retryAfterMs / 1000))));
    return res.status(429).json({
      error: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait and try again.' },
    });
  };
}
