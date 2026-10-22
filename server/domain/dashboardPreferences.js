export const DASHBOARD_WIDGETS = Object.freeze({
  system_administrator: Object.freeze([
    'admin.metric.total', 'admin.metric.active', 'admin.metric.invites', 'admin.metric.nurses', 'admin.metric.nonActive',
    'admin.userAccess', 'admin.shortcuts', 'admin.pendingInvites',
  ]),
  school_nurse: Object.freeze([
    'nurse.appointmentRequests', 'nurse.upcomingAppointments', 'nurse.todayAppointments', 'nurse.inventoryAttention', 'nurse.recentVisits',
  ]),
});

export const DASHBOARD_PREFERENCES_VERSION = 1;

export function defaultDashboardPreferences(role) {
  const ids = DASHBOARD_WIDGETS[role] || [];
  return { version: DASHBOARD_PREFERENCES_VERSION, widgets: ids.map((id) => ({ id, visible: true })) };
}

export function validateDashboardPreferences(role, input) {
  const allowed = DASHBOARD_WIDGETS[role];
  if (!allowed || !input || typeof input !== 'object' || Array.isArray(input)
    || input.version !== DASHBOARD_PREFERENCES_VERSION || !Array.isArray(input.widgets)
    || input.widgets.length !== allowed.length) {
    return { valid: false, message: 'Dashboard preferences are invalid for this account.' };
  }
  const seen = new Set();
  const widgets = [];
  for (const item of input.widgets) {
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || typeof item.id !== 'string' || !allowed.includes(item.id)
      || typeof item.visible !== 'boolean' || seen.has(item.id)) {
      return { valid: false, message: 'Dashboard preferences contain an unsupported or duplicate widget.' };
    }
    seen.add(item.id);
    widgets.push({ id: item.id, visible: item.visible });
  }
  if (seen.size !== allowed.length) return { valid: false, message: 'Dashboard preferences must include each supported widget once.' };
  return { valid: true, value: { version: DASHBOARD_PREFERENCES_VERSION, widgets } };
}

export function normalizeDashboardPreferences(role, input) {
  const validated = validateDashboardPreferences(role, input);
  return validated.valid ? validated.value : defaultDashboardPreferences(role);
}
