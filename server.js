import 'dotenv/config';
import { createApp, runClinicReminders } from './server/app.js';
import { closeDatabase, databaseConfigured, databaseTlsVerified, query } from './server/db.js';
import { emailConfigured, emailTlsVerified } from './server/email.js';
import { startClinicReminderScheduler } from './server/reminderScheduler.js';
import { runReportArchiveSweep, startReportArchiveScheduler } from './server/reportArchives.js';
import { startIncidentPhotoCleanupScheduler } from './server/incidentPhotoCleanup.js';
import { startGuardianSignupOtpCleanupScheduler } from './server/authCleanup.js';
import { productionStartupIssue } from './server/security.js';

const port = Number(process.env.PORT || 3001);
const app = createApp();
if (process.env.NODE_ENV === 'production') {
  const seedCheck = databaseConfigured
    ? await query(`SELECT
        EXISTS(SELECT 1 FROM users WHERE LOWER(email) LIKE '%.test') AS has_development_accounts,
        to_regclass('public.dev_role_account_seed_registry') IS NOT NULL AS has_seed_registry`)
    : { rows: [{ has_development_accounts: false, has_seed_registry: false }] };
  const issue = productionStartupIssue({
    nodeEnv: process.env.NODE_ENV,
    databaseConfigured,
    databaseTlsVerified,
    emailConfigured: emailConfigured(),
    emailTlsVerified: emailTlsVerified(),
    hasDevelopmentAccounts: seedCheck.rows[0].has_development_accounts,
    hasSeedRegistry: seedCheck.rows[0].has_seed_registry,
  });
  if (issue) throw new Error(issue);
}
const server = app.listen(port, () => {
  console.log(`HealthMate+ running on http://localhost:${port}`);
});
const stopReminderScheduler = startClinicReminderScheduler({
  run: () => runClinicReminders({ source: 'scheduled' }),
  databaseConfigured,
  emailConfigured: emailConfigured(),
});
const stopReportArchiveScheduler = startReportArchiveScheduler({
  run: () => runReportArchiveSweep(),
  databaseConfigured,
});
const stopIncidentPhotoCleanupScheduler = startIncidentPhotoCleanupScheduler({
  enabled: databaseConfigured,
});
const stopGuardianSignupOtpCleanupScheduler = startGuardianSignupOtpCleanupScheduler({ enabled: databaseConfigured });

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  stopReminderScheduler();
  stopReportArchiveScheduler();
  stopIncidentPhotoCleanupScheduler();
  stopGuardianSignupOtpCleanupScheduler();
  server.close(async (error) => {
    if (error) {
      console.error(`HTTP shutdown failed after ${signal}:`, error.message);
      process.exitCode = 1;
    }
    try {
      await stopReminderScheduler.drain();
      await stopReportArchiveScheduler.drain();
      await stopIncidentPhotoCleanupScheduler.drain();
      await stopGuardianSignupOtpCleanupScheduler.drain();
      await closeDatabase();
    } catch (closeError) {
      console.error('Database shutdown failed:', closeError.message);
      process.exitCode = 1;
    }
  });
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
