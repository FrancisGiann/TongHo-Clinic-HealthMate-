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
