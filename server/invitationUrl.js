export function buildInvitationActivationUrl(token, appUrl = process.env.APP_URL || 'http://localhost:5173') {
  const activationUrl = new URL('/login', appUrl);
  activationUrl.searchParams.set('activate', token);
  return activationUrl.toString();
}

// Uses only server configuration, never request headers or recipient input.
export function buildSignInUrl(appUrl = process.env.APP_URL || 'http://localhost:5173') {
  const url = new URL('/login', appUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Invalid public application URL.');
  }
  return url.toString();
}
