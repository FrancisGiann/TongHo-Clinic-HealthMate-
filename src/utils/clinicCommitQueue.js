export function enqueueClinicCommit(queueRef, operation) {
  const request = queueRef.current.catch(() => {}).then(operation);
  queueRef.current = request.catch(() => {});
  return request;
}
