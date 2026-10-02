const pendingVisitSubmissions = new Map();

export function getPendingVisitSubmission(userId) {
  const submission = pendingVisitSubmissions.get(String(userId || ''));
  return submission ? JSON.parse(JSON.stringify(submission)) : null;
}

export function rememberPendingVisitSubmission(userId, submission) {
  pendingVisitSubmissions.set(String(userId || ''), JSON.parse(JSON.stringify(submission)));
}

export function clearPendingVisitSubmission(userId) {
  pendingVisitSubmissions.delete(String(userId || ''));
}
