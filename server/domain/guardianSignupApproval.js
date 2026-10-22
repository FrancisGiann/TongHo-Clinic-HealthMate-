export const GUARDIAN_SIGNUP_STATUSES = Object.freeze(['pending_review', 'approved', 'rejected']);
export const GUARDIAN_SIGNUP_PAGE_SIZES = Object.freeze([10, 25, 50]);

export function validateGuardianSignupPageQuery(query = {}) {
  const status = String(query.status || 'pending_review');
  const order = String(query.order || 'newest');
  const limit = Number(query.limit || 25);
  const page = Number(query.page || 1);
  const search = String(query.q || '').trim();
  if (![...GUARDIAN_SIGNUP_STATUSES, 'all'].includes(status)) return { valid: false, message: 'Choose a valid request status.' };
  if (!['newest', 'oldest'].includes(order)) return { valid: false, message: 'Choose newest or oldest order.' };
  if (!GUARDIAN_SIGNUP_PAGE_SIZES.includes(limit)) return { valid: false, message: 'Choose a page size of 10, 25, or 50.' };
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000) return { valid: false, message: 'Choose a valid page number.' };
  if (search.length > 100) return { valid: false, message: 'Search text must be 100 characters or fewer.' };
  return { valid: true, value: { status, order, limit, page, search } };
}

export function publicGuardianSignupRequest(row = {}) {
  return {
    id: String(row.id),
    name: String(row.name || ''),
    email: String(row.email || ''),
    username: String(row.username || ''),
    studentId: String(row.student_id || ''),
    relationship: String(row.relationship || ''),
    status: String(row.status || ''),
    decisionReason: String(row.status === 'rejected' ? row.decision_reason || '' : ''),
    decisionEmailStatus: String(row.decision_email_status || 'not_sent'),
    createdAt: row.created_at || null,
    decidedAt: row.decided_at || null,
  };
}

export function validateGuardianSignupDecisionReason(value) {
  const reason = typeof value === 'string' ? value.trim() : '';
  return reason.length >= 1 && reason.length <= 500 ? { valid: true, value: reason } : { valid: false };
}

export function guardianSignupDecisionEmail(status, name) {
  const approved = status === 'approved';
  const greeting = String(name || 'Guardian').replace(/[\r\n\u0000-\u001f]/g, ' ').slice(0, 160);
  if (approved) return {
    subject: 'Your HealthMate+ guardian account is approved',
    text: `Hello ${greeting}, your guardian account has been approved. You can now sign in using the email and password you registered.`,
    html: `<p>Hello ${escapeHtml(greeting)}, your guardian account has been approved.</p><p>You can now sign in using the email and password you registered.</p>`,
  };
  return {
    subject: 'Your HealthMate+ guardian account request needs an update',
    text: `Hello ${greeting}, your guardian account request was not approved. Contact the school clinic administrator for next steps.`,
    html: `<p>Hello ${escapeHtml(greeting)}, your guardian account request was not approved.</p><p>Contact the school clinic administrator for next steps.</p>`,
  };
}

function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}
