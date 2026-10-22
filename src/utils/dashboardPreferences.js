export const DASHBOARD_WIDGETS = Object.freeze({
  system_administrator: [
    ['admin.metric.total', 'Total users'], ['admin.metric.active', 'Active users'],
    ['admin.metric.invites', 'Pending invites metric'], ['admin.metric.nurses', 'Nurse accounts'],
    ['admin.metric.nonActive', 'Non-active accounts'], ['admin.userAccess', 'User access overview'],
    ['admin.shortcuts', 'Admin shortcuts'], ['admin.pendingInvites', 'Pending invitations'],
  ],
  school_nurse: [
    ['nurse.appointmentRequests', 'Appointment requests'], ['nurse.upcomingAppointments', 'Upcoming appointments'],
    ['nurse.todayAppointments', 'Today’s appointments'], ['nurse.inventoryAttention', 'Inventory attention'],
    ['nurse.recentVisits', 'Recent clinic visits'],
  ],
});

export const defaultDashboardPreferences = (role) => ({
  version: 1,
  widgets: (DASHBOARD_WIDGETS[role] || []).map(([id]) => ({ id, visible: true })),
});

export function normalizeDashboardPreferences(role, value) {
  const defaults = defaultDashboardPreferences(role);
  if (!value || value.version !== 1 || !Array.isArray(value.widgets)) return defaults;
  const byId = new Map(value.widgets.filter((item) => item && typeof item.id === 'string').map((item) => [item.id, item]));
  if (byId.size !== defaults.widgets.length || defaults.widgets.some(({ id }) => !byId.has(id))) return defaults;
  return { version: 1, widgets: value.widgets.map(({ id }) => ({ id, visible: byId.get(id).visible === true })) };
}
