import test from 'node:test';
import assert from 'node:assert/strict';
import { DASHBOARD_WIDGETS, defaultDashboardPreferences, normalizeDashboardPreferences, validateDashboardPreferences } from './dashboardPreferences.js';

test('dashboard defaults are limited to fixed admin and nurse registry widgets', () => {
  assert.deepEqual(defaultDashboardPreferences('guardian'), { version: 1, widgets: [] });
  assert.equal(defaultDashboardPreferences('system_administrator').widgets.length, 8);
  assert.equal(defaultDashboardPreferences('school_nurse').widgets.length, 5);
  assert.deepEqual(normalizeDashboardPreferences('school_nurse', { version: 1, widgets: [{ id: 'admin.userAccess', visible: true }] }), defaultDashboardPreferences('school_nurse'));
});

test('dashboard preference validation rejects unknown, duplicate, omitted, and non-boolean widgets', () => {
  const defaults = defaultDashboardPreferences('system_administrator');
  assert.equal(validateDashboardPreferences('system_administrator', defaults).valid, true);
  assert.equal(validateDashboardPreferences('system_administrator', { ...defaults, widgets: [...defaults.widgets, defaults.widgets[0]] }).valid, false);
  assert.equal(validateDashboardPreferences('system_administrator', { ...defaults, widgets: defaults.widgets.slice(1) }).valid, false);
  assert.equal(validateDashboardPreferences('system_administrator', { ...defaults, widgets: defaults.widgets.map((item, index) => index ? item : { id: 'nurse.recentVisits', visible: true }) }).valid, false);
  assert.equal(validateDashboardPreferences('school_nurse', { version: 1, widgets: DASHBOARD_WIDGETS.school_nurse.map((id, index) => ({ id, visible: index !== 0 })) }).valid, true);
});
