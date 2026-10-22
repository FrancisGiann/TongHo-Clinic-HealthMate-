import test from 'node:test';
import assert from 'node:assert/strict';
import { canShowNurseDashboardBootstrap, dashboardDataForIdentity, isDashboardBootstrapEntryPath } from './dashboardBootstrap.js';

test('dashboard bootstrap is requested only for root and login entry paths', () => {
  assert.equal(isDashboardBootstrapEntryPath('/'), true);
  assert.equal(isDashboardBootstrapEntryPath('/login'), true);
  assert.equal(isDashboardBootstrapEntryPath('/students'), false);
  assert.equal(isDashboardBootstrapEntryPath('/appointments'), false);
});

test('partial dashboard is visible only to a nurse on root while the initial full load is pending', () => {
  const summary = { settings: {}, dashboardSummary: {} };
  const base = { role: 'school_nurse', pathname: '/', loading: true, error: '', dashboardData: summary };
  assert.equal(canShowNurseDashboardBootstrap(base), true);
  assert.equal(canShowNurseDashboardBootstrap({ ...base, pathname: '/students' }), false);
  assert.equal(canShowNurseDashboardBootstrap({ ...base, role: 'guardian' }), false);
  assert.equal(canShowNurseDashboardBootstrap({ ...base, role: 'system_administrator' }), false);
  assert.equal(canShowNurseDashboardBootstrap({ ...base, loading: false }), false);
  assert.equal(canShowNurseDashboardBootstrap({ ...base, error: 'Clinic data unavailable' }), false);
  assert.equal(canShowNurseDashboardBootstrap({ ...base, dashboardData: null }), false);
});

test('dashboard bootstrap data is hidden immediately when the authenticated session changes', () => {
  const entry = { ownerKey: '1:nurse-a', data: { students: [{ id: 'a' }] } };
  assert.deepEqual(dashboardDataForIdentity(entry, '1:nurse-a'), { students: [{ id: 'a' }] });
  assert.equal(dashboardDataForIdentity(entry, '2:nurse-b'), null);
  assert.equal(dashboardDataForIdentity(null, '1:nurse-a'), null);
});
