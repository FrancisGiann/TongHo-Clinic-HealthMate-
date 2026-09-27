import 'dotenv/config';
import { closeDatabase, query } from './db.js';
import { saveClinicData } from './repository.js';
import { loadData } from '../src/db/database.js';
import { assertDemoSeedAllowed } from './demoSeedSafety.js';

try {
  assertDemoSeedAllowed();
  const counts = await query(`SELECT
    (SELECT COUNT(*)::int FROM patients) AS patients,
    (SELECT COUNT(*)::int FROM visits) AS visits,
    (SELECT COUNT(*)::int FROM appointments) AS appointments,
    (SELECT COUNT(*)::int FROM inventory_items) AS inventory,
    (SELECT COUNT(*)::int FROM dispense_logs) AS dispense_logs,
    (SELECT COUNT(*)::int FROM stock_adjustments) AS stock_adjustments,
    (SELECT COUNT(*)::int FROM screenings) AS screenings,
    (SELECT COUNT(*)::int FROM immunizations) AS immunizations,
    (SELECT COUNT(*)::int FROM incidents) AS incidents,
    (SELECT COUNT(*)::int FROM queue_entries) AS queue_entries,
    (SELECT COUNT(*)::int FROM notifications) AS notifications,
    (SELECT COUNT(*)::int FROM report_snapshots) AS report_snapshots,
    (SELECT COUNT(*)::int FROM audit_logs) AS audit_logs,
    (SELECT COUNT(*)::int FROM import_batches) AS import_batches,
    (SELECT COUNT(*)::int FROM import_batch_items) AS import_batch_items`);
  if (Object.values(counts.rows[0] || {}).some((count) => Number(count) > 0)) {
    throw new Error('Refusing to seed a clinic database that already contains clinic records. Use `npm run db:seed-demo-additive` to add fictional rows without replacing existing records.');
  }
  const admins = await query("SELECT * FROM users WHERE role='system_administrator' AND status='active' ORDER BY created_at LIMIT 1");
  if (!admins.rows[0]) throw new Error('Create the bootstrap administrator with `npm run db:migrate` first.');
  const demoData = loadData();
  await saveClinicData(demoData, admins.rows[0], demoData.schemaVersion, { internal: true });
  console.log('Loaded demonstration clinic data. Do not treat it as real patient information.');
} finally {
  await closeDatabase();
}
