import crypto from 'node:crypto';
import { databaseConfigured, query, transaction } from './db.js';
import { privateStorageFromEnvironment } from './storage/supabasePrivateStorage.js';

const SAFE_STORAGE_KEY = /^incidents\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(?:png|jpg|webp)$/i;

export function incidentStorageKeyAllowed(value) { return typeof value === 'string' && SAFE_STORAGE_KEY.test(value); }
export function incidentDeletionRetryHours(attempt) { return Math.min(24, 2 ** Math.min(Math.max(1, Number(attempt) || 1) - 1, 5)); }

export async function runIncidentPhotoCleanup({ storage = privateStorageFromEnvironment(), dryRun = false, queueDefenseEnded = false, batchSize = 50, dbQuery = query, dbTransaction = transaction } = {}) {
  const boundedBatch = Math.max(1, Math.min(200, Number.isInteger(Number(batchSize)) ? Number(batchSize) : 50));
  if (dryRun) {
    const [expired, due, defensePhotos, defenseIncidents, defenseOrphans] = await Promise.all([
      dbQuery('SELECT COUNT(*)::int AS count FROM incident_photos WHERE expires_at<=NOW() AND deleted_at IS NULL AND deletion_requested_at IS NULL'),
      dbQuery(`SELECT COUNT(*)::int AS count FROM incident_photo_deletion_tasks
        WHERE completed_at IS NULL AND available_at<=NOW()
          AND (leased_at IS NULL OR leased_at<NOW()-INTERVAL '15 minutes')`),
      queueDefenseEnded ? dbQuery('SELECT COUNT(*)::int AS count FROM incident_photos WHERE deleted_at IS NULL') : Promise.resolve({ rows: [{ count: 0 }] }),
      queueDefenseEnded ? dbQuery("SELECT COUNT(*)::int AS count FROM incident_photo_consents WHERE status IN ('pending','granted')") : Promise.resolve({ rows: [{ count: 0 }] }),
      queueDefenseEnded ? dbQuery("SELECT COUNT(*)::int AS count FROM incident_photo_deletion_tasks WHERE completed_at IS NULL AND photo_id IS NULL AND storage_key LIKE 'incidents/%'") : Promise.resolve({ rows: [{ count: 0 }] }),
    ]);
    return {
      dryRun: true,
      newlyExpired: expired.rows[0]?.count || 0,
      due: due.rows[0]?.count || 0,
      defenseEnded: queueDefenseEnded ? { incidents: defenseIncidents.rows[0]?.count || 0, photos: (defensePhotos.rows[0]?.count || 0) + (defenseOrphans.rows[0]?.count || 0) } : null,
      removed: 0,
      failed: 0,
    };
  }
  let defenseEnded = { incidents: 0, photos: 0 };
  if (queueDefenseEnded) {
    defenseEnded = await dbTransaction(async (client) => {
      const candidates = await client.query(
        `SELECT c.incident_id FROM incident_photo_consents c
         WHERE c.status IN ('pending','granted')
         ORDER BY c.incident_id`,
      );
      for (const row of candidates.rows) await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`incident-photo-consent:${row.incident_id}`]);
      const current = await client.query(
        `SELECT c.incident_id,c.guardian_user_id,c.status,c.notice_version
         FROM incident_photo_consents c WHERE c.status IN ('pending','granted')
         ORDER BY c.incident_id FOR UPDATE`,
      );
      for (const consent of current.rows) {
        const eventId = crypto.randomUUID();
        await client.query(
          `INSERT INTO incident_photo_consent_events(id,incident_id,guardian_user_id,event_type,notice_version,actor_user_id)
           VALUES($1,$2,$3,'revoked',$4,NULL)`, [eventId, consent.incident_id, consent.guardian_user_id, consent.notice_version],
        );
        await client.query(
          `UPDATE incident_photo_consents SET status='revoked',granted_event_id=NULL,last_event_id=$2,updated_by=NULL,updated_at=NOW()
           WHERE incident_id=$1`, [consent.incident_id, eventId],
        );
        await client.query(
          `INSERT INTO audit_logs(actor_user_id,event,subject_type,subject_id,details)
           VALUES(NULL,'INCIDENT_PHOTO_CONSENT_DECIDED','student_incident',$1,$2::jsonb)`,
          [consent.incident_id, JSON.stringify({ decision: 'revoked', noticeVersion: consent.notice_version })],
        );
      }
      const queued = await client.query(
        `UPDATE incident_photos SET deletion_requested_at=COALESCE(deletion_requested_at,NOW())
         WHERE deleted_at IS NULL RETURNING id,incident_id,storage_key`,
      );
      for (const photo of queued.rows) {
        await client.query(
          `INSERT INTO incident_photo_deletion_tasks(id,photo_id,storage_key,reason,available_at)
           VALUES($1,$2,$3,'defense_cleanup',NOW()) ON CONFLICT(storage_key) DO UPDATE
           SET available_at=LEAST(incident_photo_deletion_tasks.available_at,EXCLUDED.available_at),reason='defense_cleanup'`,
          [crypto.randomUUID(), photo.id, photo.storage_key],
        );
      }
      await client.query(
        `UPDATE incident_photo_deletion_tasks
         SET available_at=LEAST(available_at,NOW()),reason='defense_cleanup'
         WHERE completed_at IS NULL AND storage_key LIKE 'incidents/%'`,
      );
      return { incidents: current.rowCount, photos: queued.rowCount };
    });
  }
  const expiration = await dbTransaction(async (client) => {
    const expired = await client.query(
      `SELECT id,storage_key FROM incident_photos
       WHERE expires_at<=NOW() AND deleted_at IS NULL AND deletion_requested_at IS NULL
       ORDER BY expires_at,id FOR UPDATE SKIP LOCKED LIMIT $1`, [boundedBatch],
    );
    for (const photo of expired.rows) {
      await client.query('UPDATE incident_photos SET deletion_requested_at=NOW() WHERE id=$1', [photo.id]);
      await client.query(
        `INSERT INTO incident_photo_deletion_tasks(id,photo_id,storage_key,reason,available_at)
         VALUES($1,$2,$3,'expired',NOW()) ON CONFLICT(storage_key) DO UPDATE
         SET available_at=LEAST(incident_photo_deletion_tasks.available_at,EXCLUDED.available_at)`,
        [crypto.randomUUID(), photo.id, photo.storage_key],
      );
    }
    return { newlyExpired: expired.rowCount };
  });
  const dueCount = await dbQuery(
    `SELECT COUNT(*)::int AS count FROM incident_photo_deletion_tasks
     WHERE completed_at IS NULL AND available_at<=NOW()
       AND (leased_at IS NULL OR leased_at<NOW()-INTERVAL '15 minutes')`,
  );
  const leased = await dbTransaction(async (client) => {
    const rows = await client.query(
      `SELECT id,photo_id,storage_key,attempts FROM incident_photo_deletion_tasks
       WHERE completed_at IS NULL AND available_at<=NOW()
         AND (leased_at IS NULL OR leased_at<NOW()-INTERVAL '15 minutes')
       ORDER BY available_at,created_at,id FOR UPDATE SKIP LOCKED LIMIT $1`, [boundedBatch],
    );
    for (const row of rows.rows) await client.query('UPDATE incident_photo_deletion_tasks SET leased_at=NOW(),last_attempt_at=NOW() WHERE id=$1', [row.id]);
    return rows.rows;
  });

  let removed = 0;
  let failed = 0;
  for (const task of leased) {
    if (!incidentStorageKeyAllowed(task.storage_key)) {
      await dbQuery('UPDATE incident_photo_deletion_tasks SET attempts=attempts+1,leased_at=NULL,available_at=NOW()+INTERVAL \'1 day\',last_error_code=$2 WHERE id=$1', [task.id, 'INVALID_STORAGE_KEY']);
      failed += 1;
      continue;
    }
    try {
      if (!storage?.isConfigured?.() || !storage?.bucket) throw Object.assign(new Error('Storage unavailable.'), { code: 'STORAGE_UNAVAILABLE' });
      await storage.remove(storage.bucket, task.storage_key);
      await dbTransaction(async (client) => {
        await client.query('UPDATE incident_photo_deletion_tasks SET completed_at=NOW(),leased_at=NULL,last_error_code=NULL WHERE id=$1', [task.id]);
        if (task.photo_id) await client.query('UPDATE incident_photos SET deleted_at=COALESCE(deleted_at,NOW()) WHERE id=$1', [task.photo_id]);
      });
      removed += 1;
    } catch (error) {
      const attempts = Number(task.attempts || 0) + 1;
      const delayHours = incidentDeletionRetryHours(attempts);
      const code = String(error.code || 'STORAGE_DELETE_FAILED').replace(/[^A-Z0-9_-]/gi, '').slice(0, 60) || 'STORAGE_DELETE_FAILED';
      await dbQuery(
        `UPDATE incident_photo_deletion_tasks SET attempts=attempts+1,leased_at=NULL,
           available_at=NOW()+($2::text || ' hours')::interval,last_error_code=$3 WHERE id=$1`,
        [task.id, String(delayHours), code],
      );
      failed += 1;
    }
  }
  return { dryRun: false, defenseEnded, newlyExpired: expiration.newlyExpired, due: dueCount.rows[0]?.count || 0, removed, failed };
}

export function startIncidentPhotoCleanupScheduler({ run = () => runIncidentPhotoCleanup(), enabled = databaseConfigured, intervalMs = 60 * 60 * 1000, initialDelayMs = 15_000, setTimeoutFn = setTimeout, setIntervalFn = setInterval, clearTimeoutFn = clearTimeout, clearIntervalFn = clearInterval } = {}) {
  if (!enabled) {
    const stop = () => Promise.resolve();
    stop.drain = stop;
    return stop;
  }
  let stopped = false;
  let running = false;
  let pending;
  let active = Promise.resolve();
  const drain = () => active;
  const tick = async () => {
    if (stopped || running) return;
    running = true;
    active = Promise.resolve().then(run).catch((error) => {
      // Storage providers may include endpoint details; only the code is useful for operations.
      console.error('Incident photo cleanup failed:', String(error?.code || 'CLEANUP_FAILED').slice(0, 60));
    }).finally(() => { running = false; });
    await active;
  };
  pending = setTimeoutFn(() => {
    void tick();
    if (!stopped) pending = setIntervalFn(() => { void tick(); }, intervalMs);
  }, Math.max(0, Number(initialDelayMs) || 0));
  const stop = () => {
    stopped = true;
    if (pending) {
      clearTimeoutFn(pending);
      clearIntervalFn(pending);
    }
    return drain();
  };
  stop.drain = drain;
  return stop;
}
