import 'dotenv/config';
import { createApp, runClinicReminders } from './server/app.js';
import { closeDatabase, databaseConfigured } from './server/db.js';
import { emailConfigured } from './server/email.js';
import { startClinicReminderScheduler } from './server/reminderScheduler.js';

const port = Number(process.env.PORT || 3001);
const app = createApp();
const server = app.listen(port, () => {
  console.log(`HealthMate+ running on http://localhost:${port}`);
});
const stopReminderScheduler = startClinicReminderScheduler({
  run: () => runClinicReminders({ source: 'scheduled' }),
  databaseConfigured,
  emailConfigured: emailConfigured(),
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  stopReminderScheduler();
  server.close(async (error) => {
    if (error) {
      console.error(`HTTP shutdown failed after ${signal}:`, error.message);
      process.exitCode = 1;
    }
    try {
      await stopReminderScheduler.drain();
      await closeDatabase();
    } catch (closeError) {
      console.error('Database shutdown failed:', closeError.message);
      process.exitCode = 1;
    }
  });
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
