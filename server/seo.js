export const PUBLIC_CANONICAL = 'https://healthmateplus.com/';

// Never trust X-Forwarded-Host for indexing eligibility. Any cookie conservatively
// excludes a personalized root response, without querying or changing sessions.
export function isIndexableLanding(req) {
  return ['GET', 'HEAD'].includes(req.method)
    && String(req.headers.host || '').toLowerCase() === 'healthmateplus.com'
    && req.originalUrl === '/'
    && !req.headers.cookie
    && !req.headers.authorization;
}

export function indexingHeaders(req, res, next) {
  res.setHeader('X-Robots-Tag', isIndexableLanding(req) ? 'index, follow' : 'noindex, nofollow');
  if (req.path === '/api' || req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'private, no-store');
  }
  next();
}

export function landingHtml(template, req) {
  if (!isIndexableLanding(req)) return template;
  return template.replace('<meta name="robots" content="noindex, nofollow" />',
    `<meta name="robots" content="index, follow" />\n    <link rel="canonical" href="${PUBLIC_CANONICAL}" />`);
}

export function serveApplicationHtml(template) {
  return (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.vary('Cookie');
    res.vary('Authorization');
    return res.type('html').send(landingHtml(template, req));
  };
}
