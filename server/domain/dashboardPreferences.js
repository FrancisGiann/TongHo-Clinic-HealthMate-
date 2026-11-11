export const DASHBOARD_WIDGETS = Object.freeze({
  system_administrator: Object.freeze([
    'admin.metric.total', 'admin.metric.active', 'admin.metric.invites', 'admin.metric.nurses', 'admin.metric.nonActive',
    'admin.userAccess', 'admin.shortcuts', 'admin.pendingInvites',
  ]),
  school_nurse: Object.freeze([
    'nurse.appointments', 'nurse.inventoryAttention', 'nurse.recentVisits',
  ]),
});

export const DASHBOARD_PREFERENCES_VERSION = 2;

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
  if (role === 'school_nurse' && input?.version === 1 && Array.isArray(input.widgets)) {
    const byId = new Map(input.widgets.filter((item) => item && typeof item.id === 'string').map((item) => [item.id, item]));
    const oldAppointmentIds = ['nurse.appointmentRequests', 'nurse.upcomingAppointments', 'nurse.todayAppointments'];
    if (oldAppointmentIds.every((id) => byId.has(id))
      && byId.has('nurse.inventoryAttention') && byId.has('nurse.recentVisits')) {
      const visible = oldAppointmentIds.some((id) => byId.get(id)?.visible === true);
      return {
        version: DASHBOARD_PREFERENCES_VERSION,
        widgets: [
          { id: 'nurse.appointments', visible },
          { id: 'nurse.inventoryAttention', visible: byId.get('nurse.inventoryAttention')?.visible === true },
          { id: 'nurse.recentVisits', visible: byId.get('nurse.recentVisits')?.visible === true },
        ],
      };
    }
  }
  if (input?.version === 1 && Array.isArray(input.widgets)) {
    const allowed = DASHBOARD_WIDGETS[role] || [];
    const byId = new Map(input.widgets.filter((item) => item && typeof item.id === 'string').map((item) => [item.id, item]));
    if (allowed.length && byId.size === allowed.length && allowed.every((id) => byId.has(id))) {
      return {
        version: DASHBOARD_PREFERENCES_VERSION,
        widgets: allowed.map((id) => ({ id, visible: byId.get(id)?.visible === true })),
      };
    }
  }
  const validated = validateDashboardPreferences(role, input);
  return validated.valid ? validated.value : defaultDashboardPreferences(role);
}
