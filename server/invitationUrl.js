export function buildInvitationActivationUrl(token, appUrl = process.env.APP_URL || 'http://localhost:5173') {
  const activationUrl = new URL('/login', appUrl);
  activationUrl.searchParams.set('activate', token);
  return activationUrl.toString();
}
