import 'dotenv/config';
import { closeDatabase, databaseConfigured, query, transaction } from './db.js';
import { applyStudentHealthReset, inspectStudentHealthReset, validateStudentResetArguments } from './student-health-reset.js';

const args = process.argv.slice(2);
const validation = validateStudentResetArguments(args);

try {
  if (!validation.valid) {
    console.error(validation.error);
    process.exitCode = 2;
  } else if (!databaseConfigured) {
    console.error('DATABASE_URL is not configured.');
    process.exitCode = 2;
  } else if (!validation.apply) {
    const scope = await inspectStudentHealthReset({ query });
    console.log(JSON.stringify({ mode: 'dry-run', applied: false, scope }, null, 2));
  } else {
    const result = await transaction(async (client) => {
      const before = await inspectStudentHealthReset(client);
      const reset = await applyStudentHealthReset(client);
      return { before, reset };
    });
    console.log(JSON.stringify({ mode: 'apply', applied: true, backupConfirmed: true, ...result }, null, 2));
  }
} catch (error) {
  console.error(`Student health reset failed (${error.code || 'unknown'}).`);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
