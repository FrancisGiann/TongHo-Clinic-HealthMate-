import 'dotenv/config';
import { closeDatabase, query, transaction } from './db.js';
import { generateDemoData } from '../src/db/demoData.js';
import { addDemoData } from './demoSeed.js';
import { assertDemoSeedAllowed } from './demoSeedSafety.js';

try {
  assertDemoSeedAllowed();
  const admins = await query("SELECT * FROM users WHERE role='system_administrator' AND status='active' ORDER BY created_at LIMIT 1");
  if (!admins.rows[0]) throw new Error('Create the bootstrap administrator with `npm run db:migrate` first.');
  const demoData = generateDemoData();
  const counts = await transaction((client) => addDemoData(client, demoData, admins.rows[0].id));
  const inserted = Object.values(counts).reduce((sum, count) => sum + count.inserted, 0);
  const alreadyPresent = Object.values(counts).reduce((sum, count) => sum + count.alreadyPresent, 0);
  console.log(`Added ${inserted} fictional demo records; ${alreadyPresent} records already belonged to this demo dataset. No messages were sent.`);
} finally {
  await closeDatabase();
}
