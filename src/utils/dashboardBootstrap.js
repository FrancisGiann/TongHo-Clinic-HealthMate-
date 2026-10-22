export function isDashboardBootstrapEntryPath(pathname) {
  return pathname === '/' || pathname === '/login';
}

export function canShowNurseDashboardBootstrap({ role, pathname, loading, error, dashboardData }) {
  return role === 'school_nurse'
    && pathname === '/'
    && loading
    && !error
    && Boolean(dashboardData);
}

export function dashboardDataForIdentity(entry, sessionKey) {
  return entry?.ownerKey === sessionKey ? entry.data : null;
}
