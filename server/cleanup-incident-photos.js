import 'dotenv/config';
import { closeDatabase } from './db.js';
import { runIncidentPhotoCleanup } from './incidentPhotoCleanup.js';
import { privateStorageFromEnvironment } from './storage/supabasePrivateStorage.js';
import { parseIncidentPhotoCleanupArguments, validateIncidentPhotoCleanupOptions } from './domain/incidentPhotoCleanupCli.js';

let options;
const storage = privateStorageFromEnvironment();

try {
  options = parseIncidentPhotoCleanupArguments(process.argv.slice(2));
  const validation = validateIncidentPhotoCleanupOptions(options, {
    storageConfigured: storage.isConfigured(),
    configuredBucket: storage.bucket,
    photosEnabled: String(process.env.INCIDENT_PHOTOS_ENABLED || '').trim().toLowerCase() === 'true',
  });
  if (!validation.valid) throw Object.assign(new Error('Photo cleanup configuration is not safe for this operation.'), { code: validation.code });
  const result = await runIncidentPhotoCleanup({ storage, dryRun: !options.apply, queueDefenseEnded: options.defenseEnded });
  console.log(JSON.stringify(result));
} catch (error) {
  const code = /^[A-Z0-9_-]{1,60}$/.test(String(error?.code || '')) ? error.code : 'CLEANUP_FAILED';
  console.error(`Incident photo cleanup could not run (${code}).`);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
