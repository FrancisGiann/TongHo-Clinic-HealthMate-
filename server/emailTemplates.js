// Pure rendering only: no transport, environment, recipients, or token generation.
export function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

const paragraph = (value) => `<p style="margin:0 0 18px;font-size:16px;line-height:1.65;overflow-wrap:anywhere;word-wrap:break-word">${escapeHtml(value).replaceAll('\n', '<br>')}</p>`;

function renderEmail({ title, preheader, paragraphs, code, action, secondaryAction, note }) {
  const content = paragraphs.map(paragraph).join('');
  const codeBlock = code === undefined ? '' : `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td align="center" bgcolor="#eaf3ff" style="padding:22px 8px;border:1px solid #c6d6e9;border-radius:8px;color:#1a3c68;font-family:Arial,Helvetica,sans-serif;font-size:32px;font-weight:700;letter-spacing:4px;line-height:1.4">${escapeHtml(code)}</td></tr></table>`;
  const actionBlock = !action ? '' : `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:6px 0 22px"><tr><td bgcolor="#1a3c68" style="border-radius:6px;text-align:center;mso-padding-alt:14px 24px"><a href="${escapeHtml(action.url)}" style="display:inline-block;padding:14px 24px;color:#ffffff;font-size:16px;font-weight:700;line-height:1.4;text-decoration:none;border:1px solid #1a3c68;border-radius:6px">${escapeHtml(action.label)}</a></td></tr></table>${paragraph('If the button does not open, copy this link into your browser:')}<p style="margin:0 0 22px;word-break:break-all;font-size:14px;line-height:1.6"><a href="${escapeHtml(action.url)}" style="color:#1a3c68;text-decoration:underline">${escapeHtml(action.url)}</a></p>`;
  const text = ['HealthMate+ | Tong Ho Clinic', title, ...paragraphs,
    ...(code === undefined ? [] : [String(code)]), ...(action ? [`${action.label}: ${action.url}`] : []), ...(secondaryAction ? [`${secondaryAction.label}: ${secondaryAction.url}`] : []), ...(note ? [note] : [])].join('\n\n');
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background-color:#fbf8f1;color:#252e39;font-family:Arial,Helvetica,sans-serif">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#fbf8f1">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#fbf8f1"><tr><td align="center" style="padding:24px 12px">
<!--[if mso]><table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;border:1px solid #ddd8ce;background-color:#ffffff;table-layout:fixed">
<tr><td bgcolor="#1a3c68" style="padding:24px;color:#ffffff"><p style="margin:0;font-size:24px;line-height:1.3;font-weight:700">HealthMate+</p><p style="margin:6px 0 0;font-size:14px;line-height:1.5">Tong Ho Clinic</p></td></tr>
<tr><td style="padding:28px 24px;overflow-wrap:anywhere;word-wrap:break-word"><h1 style="margin:0 0 22px;color:#1a3c68;font-size:26px;line-height:1.25;overflow-wrap:anywhere">${escapeHtml(title)}</h1>${content}${codeBlock}${actionBlock}${secondaryAction ? paragraph(secondaryAction.label) + `<p style="margin:0 0 22px;word-break:break-all"><a href="${escapeHtml(secondaryAction.url)}" style="color:#1a3c68;font-size:16px;line-height:1.6">${escapeHtml(secondaryAction.url)}</a></p>` : ''}${note ? `<div style="margin-top:22px">${paragraph(note)}</div>` : ''}</td></tr>
<tr><td style="padding:18px 24px;border-top:1px solid #ddd8ce;color:#625f6e;font-size:13px;line-height:1.6">HealthMate+ · Tong Ho Clinic<br>School clinic care, connected.</td></tr>
</table><!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`;
  return { text, html };
}

export function otpEmail(code, purpose = 'verification') {
  const titles = { login: 'Your sign-in code', 'password reset': 'Reset your password', 'guardian signup': 'Verify your email', verification: 'Your verification code' };
  return {
    subject: `HealthMate+ ${purpose} code`,
    ...renderEmail({ title: titles[purpose] || 'Your verification code', preheader: 'Your verification code expires in 5 minutes.',
      paragraphs: [`Your HealthMate+ ${purpose} code is:`], code,
      note: 'This code expires in 5 minutes. Do not share it. If you did not request this code, do not use it or share it with anyone.' }),
  };
}

export function invitationEmail(name, activationUrl, signInUrl) {
  return { subject: 'Your HealthMate+ account invitation',
    ...renderEmail({ title: 'You’re invited to HealthMate+', preheader: 'Activate your account within 72 hours.',
      paragraphs: [`Hello ${name || 'there'},`, 'You were invited to HealthMate+. Use the link below to activate your account.'],
      action: { label: 'Activate your account', url: activationUrl }, secondaryAction: signInUrl ? { label: 'Already activated? Sign in to HealthMate', url: signInUrl } : undefined, note: 'Your activation link expires in 72 hours. Keep your invitation link private.' }),
  };
}

export function notificationEmail({ name, subject, body, authorizedDetails = false }) {
  return { subject, ...renderEmail({ title: subject, preheader: 'An update from Tong Ho Clinic.',
    paragraphs: [`Hello ${name || 'there'},`, body],
    note: authorizedDetails ? 'Sign in to HealthMate+ for authorized details.' : undefined }) };
}

export function guardianDecisionEmail(approved, greeting, signInUrl) {
  const subject = approved ? 'Your HealthMate+ guardian account is approved' : 'Your HealthMate+ guardian account request needs an update';
  return { subject, ...renderEmail({ title: approved ? 'Your account is approved' : 'About your account request',
    preheader: 'An update about your guardian account request.',
    action: approved && signInUrl ? { label: 'Sign in to HealthMate', url: signInUrl } : undefined,
    paragraphs: [`Hello ${greeting}, your guardian account ${approved ? 'has been approved.' : 'request was not approved.'}`,
      approved ? 'You can now sign in using the email and password you registered.' : 'Contact the school clinic administrator for next steps.'] }) };
}
