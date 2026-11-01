export function resolveClinicDataScope(role, pathname, search = '') {
  if (role !== 'school_nurse') return { kind: 'full', group: 'full', requestKey: 'full' };
  if (pathname === '/') return { kind: 'dashboard', group: 'dashboard', requestKey: 'dashboard' };
  if (['/students', '/students/new', '/faculty/new'].includes(pathname)) {
    const directoryQuery = patientDirectorySearch(search);
    return {
      kind: 'directory',
      group: 'directory',
      requestKey: `directory:${directoryQuery}`,
      search,
    };
  }
  const profile = /^\/students\/([^/]+)(?:\/visits\/[^/]+\/print|\/passes\/[^/]+)?$/.exec(pathname);
  if (profile) {
    let patientId = profile[1];
    try { patientId = decodeURIComponent(patientId); } catch { /* The route will return a validation error. */ }
    return { kind: 'patient', group: `patient:${patientId}`, requestKey: `patient:${patientId}`, patientId };
  }
  if (pathname === '/reports') return { kind: 'report', group: 'report', requestKey: 'report' };
  return { kind: 'full', group: 'full', requestKey: 'full' };
}

export function patientDirectorySearch(search = '') {
  const source = new URLSearchParams(search);
  const target = new URLSearchParams();
  const fields = [
    ['q', 'q'], ['filter', 'type'], ['grade', 'grade'], ['section', 'section'],
    ['sort', 'sort'], ['order', 'order'], ['page', 'page'], ['pageSize', 'pageSize'],
  ];
  for (const [from, to] of fields) {
    const value = source.get(from);
    if (value) target.set(to, value);
  }
  return target.toString();
}

export function mayReusePendingScopeData(kind, entryOwnerKey, activeOwnerKey) {
  return kind === 'directory' && Boolean(entryOwnerKey) && entryOwnerKey === activeOwnerKey;
}
