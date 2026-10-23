import test from 'node:test';
import assert from 'node:assert/strict';
import { incidentDeletionRetryHours, incidentStorageKeyAllowed, runIncidentPhotoCleanup, startIncidentPhotoCleanupScheduler } from './incidentPhotoCleanup.js';

const key = 'incidents/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.png';

test('incident photo cleanup keys and retry delays stay bounded to incident images', () => {
  assert.equal(incidentStorageKeyAllowed(key), true);
  assert.equal(incidentStorageKeyAllowed('branding/11111111-1111-4111-8111-111111111111.png'), false);
  assert.equal(incidentStorageKeyAllowed('incidents/../branding/logo.png'), false);
  assert.deepEqual([1, 2, 3, 10].map(incidentDeletionRetryHours), [1, 2, 4, 24]);
});

test('dry-run reports expired and due counts without invoking cleanup transactions or storage', async () => {
  const results = [1, 3];
  const result = await runIncidentPhotoCleanup({
    dryRun: true,
    dbQuery: async () => ({ rows: [{ count: results.shift() }] }),
    dbTransaction: async () => assert.fail('dry-run must not mutate'),
    storage: { remove: async () => assert.fail('dry-run must not delete') },
  });
  assert.deepEqual(result, { dryRun: true, newlyExpired: 1, due: 3, defenseEnded: null, removed: 0, failed: 0 });
});

test('defense-ended dry-run counts active consent and every remaining image including orphan deletion tasks', async () => {
  const counts = [2, 1, 4, 3, 2];
  const result = await runIncidentPhotoCleanup({
    dryRun: true,
    queueDefenseEnded: true,
    dbQuery: async () => ({ rows: [{ count: counts.shift() }] }),
    dbTransaction: async () => assert.fail('defense-ended preview must not mutate'),
    storage: { remove: async () => assert.fail('dry-run must not delete') },
  });
  assert.deepEqual(result, { dryRun: true, newlyExpired: 2, due: 1, defenseEnded: { incidents: 3, photos: 6 }, removed: 0, failed: 0 });
});

test('defense-ended cleanup revokes active consent and queues every remaining incident image before deletion', async () => {
  const statements = [];
  const consent = { incident_id: 'incident-1', guardian_user_id: 'guardian-1', status: 'granted', notice_version: 'incident-photo-defense-v1' };
  const photo = { id: 'photo-1', incident_id: 'incident-1', storage_key: key };
  const task = { id: 'task-1', photo_id: 'photo-1', storage_key: key, attempts: 0 };
  let removed = 0;
  const dbQuery = async (sql) => {
    statements.push(sql);
    if (sql.includes('SELECT COUNT(*)') && sql.includes('incident_photo_deletion_tasks')) return { rows: [{ count: 1 }] };
    return { rows: [] };
  };
  const dbTransaction = async (work) => work({ query: async (sql, params = []) => {
    statements.push({ sql, params });
    if (sql.includes('SELECT c.incident_id FROM incident_photo_consents')) return { rows: [{ incident_id: consent.incident_id }], rowCount: 1 };
    if (sql.includes('SELECT c.incident_id,c.guardian_user_id')) return { rows: [{ ...consent }], rowCount: 1 };
    if (sql.includes('UPDATE incident_photos') && sql.includes('RETURNING id,incident_id,storage_key')) return { rows: [{ ...photo }], rowCount: 1 };
    if (sql.includes('FROM incident_photos') && sql.includes('FOR UPDATE SKIP LOCKED')) return { rows: [], rowCount: 0 };
    if (sql.includes('FROM incident_photo_deletion_tasks') && sql.includes('FOR UPDATE SKIP LOCKED')) return { rows: [{ ...task }], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  } });
  const result = await runIncidentPhotoCleanup({
    queueDefenseEnded: true,
    dbQuery,
    dbTransaction,
    storage: { isConfigured: () => true, bucket: 'private', async remove(bucket, storageKey) { assert.equal(bucket, 'private'); assert.equal(storageKey, key); removed += 1; } },
  });
  assert.deepEqual(result.defenseEnded, { incidents: 1, photos: 1 });
  assert.equal(removed, 1);
  assert.ok(statements.some((entry) => typeof entry === 'object' && entry.sql.includes("event_type,notice_version,actor_user_id") && entry.sql.includes("'revoked'")));
  assert.ok(statements.some((entry) => typeof entry === 'object' && entry.sql.includes("reason='defense_cleanup'")));
  assert.ok(statements.some((entry) => typeof entry === 'object' && entry.sql.includes('SET status=\'revoked\'')));
});

test('storage deletion failures are retried with a durable sanitized task update', async () => {
  const updates = [];
  const tx = async (work) => work({ query: async (sql) => {
    if (sql.includes('FROM incident_photos') && sql.includes('FOR UPDATE SKIP LOCKED')) return { rows: [] };
    if (sql.includes('FROM incident_photo_deletion_tasks') && sql.includes('FOR UPDATE SKIP LOCKED')) return { rows: [{ id: 'task-1', photo_id: 'photo-1', storage_key: key, attempts: 1 }] };
    updates.push(sql);
    return { rowCount: 1, rows: [] };
  } });
  const result = await runIncidentPhotoCleanup({
    dbTransaction: tx,
    dbQuery: async (sql, params) => { updates.push({ sql, params }); return { rows: [{ count: 1 }] }; },
    storage: { isConfigured: () => true, bucket: 'private', async remove() { throw Object.assign(new Error('credential=https://secret.example'), { code: 'STORAGE_DELETE_503' }); } },
  });
  assert.equal(result.failed, 1);
  const retryUpdate = updates.find((entry) => entry && typeof entry === 'object' && entry.params?.[0] === 'task-1');
  assert.ok(retryUpdate);
  assert.equal(retryUpdate.params[1], '2');
  assert.equal(retryUpdate.params[2], 'STORAGE_DELETE_503');
  assert.equal(JSON.stringify(updates).includes('secret.example'), false);
});

test('cleanup scheduler is disabled without a configured database and drains active work', async () => {
  let starts = 0;
  let resolveRun;
  const stop = startIncidentPhotoCleanupScheduler({ enabled: true, initialDelayMs: 0, setTimeoutFn: (fn) => { starts += 1; fn(); return 1; }, setIntervalFn: () => 2, clearTimeoutFn() {}, clearIntervalFn() {}, run: () => new Promise((resolve) => { resolveRun = resolve; }) });
  assert.equal(starts, 1);
  await Promise.resolve();
  const drained = stop();
  resolveRun();
  await drained;
  const disabled = startIncidentPhotoCleanupScheduler({ enabled: false });
  await disabled.drain();
});


test('INCIDENT_PHOTO_CLEANUP_ENABLED=false prevents startup and interval registration even with a configured database', async () => {
  for (const value of ['false', ' FALSE ']) {
    const stop = startIncidentPhotoCleanupScheduler({
      enabled: true,
      env: { INCIDENT_PHOTO_CLEANUP_ENABLED: value },
      run: () => assert.fail('cleanup must not run'),
      setTimeoutFn: () => assert.fail('startup timer must not be registered'),
      setIntervalFn: () => assert.fail('interval must not be registered'),
    });
    await stop();
    await stop.drain();
  }
});

test('INCIDENT_PHOTO_CLEANUP_ENABLED preserves omitted/true behavior and cannot enable a missing database', async () => {
  for (const env of [{}, { INCIDENT_PHOTO_CLEANUP_ENABLED: 'true' }]) {
    let startup;
    let interval;
    let runs = 0;
    const stop = startIncidentPhotoCleanupScheduler({
      enabled: true, env, run: async () => { runs += 1; },
      setTimeoutFn: (fn) => { startup = fn; return 1; },
      setIntervalFn: (fn) => { interval = fn; return 2; },
      clearTimeoutFn() {}, clearIntervalFn() {},
    });
    startup(); await stop.drain();
    interval(); await stop.drain();
    assert.equal(runs, 2);
    await stop();
    await startIncidentPhotoCleanupScheduler({ enabled: false, env, setTimeoutFn: () => assert.fail('database required') })();
  }
});
