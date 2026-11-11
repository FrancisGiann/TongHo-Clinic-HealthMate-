export const DASHBOARD_WIDGETS = Object.freeze({
  system_administrator: [
    ['admin.metric.total', 'Total users'], ['admin.metric.active', 'Active users'],
    ['admin.metric.invites', 'Pending invites metric'], ['admin.metric.nurses', 'Nurse accounts'],
    ['admin.metric.nonActive', 'Non-active accounts'], ['admin.userAccess', 'User access overview'],
    ['admin.shortcuts', 'Admin shortcuts'], ['admin.pendingInvites', 'Pending invitations'],
  ],
  school_nurse: [
    ['nurse.appointments', 'Clinic scheduling shortcut'], ['nurse.inventoryAttention', 'Inventory attention'],
    ['nurse.recentVisits', 'Recent clinic visits'],
  ],
});

export const DASHBOARD_PREFERENCES_VERSION = 2;

export const defaultDashboardPreferences = (role) => ({
  version: DASHBOARD_PREFERENCES_VERSION,
  widgets: (DASHBOARD_WIDGETS[role] || []).map(([id]) => ({ id, visible: true })),
});

export function normalizeDashboardPreferences(role, value) {
  const defaults = defaultDashboardPreferences(role);
  if (!value || !Array.isArray(value.widgets)) return defaults;
  const byId = new Map(value.widgets.filter((item) => item && typeof item.id === 'string').map((item) => [item.id, item]));
  if (role === 'school_nurse' && value.version === 1) {
    const oldAppointments = ['nurse.appointmentRequests', 'nurse.upcomingAppointments', 'nurse.todayAppointments'];
    if (oldAppointments.every((id) => byId.has(id)) && byId.has('nurse.inventoryAttention') && byId.has('nurse.recentVisits')) {
      return {
        version: DASHBOARD_PREFERENCES_VERSION,
        widgets: [
          { id: 'nurse.appointments', visible: oldAppointments.some((id) => byId.get(id)?.visible === true) },
          { id: 'nurse.inventoryAttention', visible: byId.get('nurse.inventoryAttention')?.visible === true },
          { id: 'nurse.recentVisits', visible: byId.get('nurse.recentVisits')?.visible === true },
        ],
      };
    }
  }
  if (value.version === 1) {
    if (byId.size === defaults.widgets.length && defaults.widgets.every(({ id }) => byId.has(id))) {
      return { version: DASHBOARD_PREFERENCES_VERSION, widgets: defaults.widgets.map(({ id }) => ({ id, visible: byId.get(id)?.visible === true })) };
    }
    return defaults;
  }
  if (value.version !== DASHBOARD_PREFERENCES_VERSION) return defaults;
  if (byId.size !== defaults.widgets.length || defaults.widgets.some(({ id }) => !byId.has(id))) return defaults;
  return { version: DASHBOARD_PREFERENCES_VERSION, widgets: defaults.widgets.map(({ id }) => ({ id, visible: byId.get(id).visible === true })) };
}
