import 'dotenv/config';
import { closeDatabase, query } from './db.js';
import { saveClinicData } from './repository.js';
import { loadData } from '../src/db/database.js';

try {
  const count = await query('SELECT COUNT(*)::int AS count FROM patients');
  if (count.rows[0].count > 0) throw new Error('Refusing to overwrite existing clinic data. Use the authenticated backup import instead.');
  const admins = await query("SELECT * FROM users WHERE role='system_administrator' AND status='active' ORDER BY created_at LIMIT 1");
  if (!admins.rows[0]) throw new Error('Create the bootstrap administrator with `npm run db:migrate` first.');
  await saveClinicData(loadData(), admins.rows[0]);
  console.log('Loaded demonstration clinic data. Do not treat it as real patient information.');
} finally {
  await closeDatabase();
}
