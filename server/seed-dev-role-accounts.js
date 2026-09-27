import 'dotenv/config';
import { closeDatabase, databaseConfigured, query, transaction } from './db.js';
import { hashPassword } from './auth.js';
import {
  assertDevRoleAccountSeedEnabled,
  DEV_ROLE_ACCOUNTS,
  DEV_ROLE_PATIENT_ID,
  DEV_ROLE_SEED_REGISTRY,
} from './dev-role-accounts.js';

const DEV_PATIENT = {
  id: DEV_ROLE_PATIENT_ID,
  studentId: DEV_ROLE_PATIENT_ID,
  name: 'Fictional Development Student',
  gradeLevel: 'Grade 8',
  section: 'Development',
  gender: 'Prefer not to say',
  guardianName: 'Fictional Development Guardian',
  guardianRelation: 'Guardian',
};
const REGISTRY_KEYS = new Set(['patient', ...DEV_ROLE_ACCOUNTS.map((account) => `account:${account.key}`)]);

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

function safeDatabaseKind(connectionString) {
  if (!connectionString) return 'unconfigured';
  try {
    const hostname = new URL(connectionString).hostname.toLowerCase();
    if (hostname.endsWith('.supabase.co') || hostname.endsWith('.supabase.com')) return 'supabase_postgresql';
    if (['localhost', '127.0.0.1', '::1'].includes(hostname)) return 'local_postgresql';
    return 'remote_postgresql';
  } catch {
    return 'configured_unrecognized';
  }
}

async function inspectDatabase(client) {
  const registryExists = await client.query('SELECT to_regclass($1) IS NOT NULL AS present', [`public.${DEV_ROLE_SEED_REGISTRY}`]);
  const registryResult = registryExists.rows[0].present
    ? await client.query(`SELECT seed_key,entity_type,entity_id FROM ${DEV_ROLE_SEED_REGISTRY}`)
    : { rows: [] };
  const registry = new Map(registryResult.rows.map((row) => [row.seed_key, row]));
  const userCountsResult = await client.query('SELECT role,COUNT(*)::int AS count FROM users GROUP BY role ORDER BY role');
  const patientCountResult = await client.query('SELECT COUNT(*)::int AS count FROM patients');
  const identityResult = await client.query(
    `SELECT id,username,email,role FROM users
     WHERE id=ANY($1::uuid[]) OR LOWER(username)=ANY($2::text[]) OR LOWER(email)=ANY($3::text[])`,
    [DEV_ROLE_ACCOUNTS.map((account) => account.id), DEV_ROLE_ACCOUNTS.map((account) => account.username), DEV_ROLE_ACCOUNTS.map((account) => account.email)],
  );
  const patientResult = await client.query(
    `SELECT id,patient_type,user_id,data FROM patients
     WHERE id=$1 OR data->>'id'=$1 OR data->>'studentId'=$1`,
    [DEV_ROLE_PATIENT_ID],
  );
  const guardianLinks = await client.query(
    'SELECT guardian_user_id,patient_id,relationship FROM guardian_patient_links WHERE patient_id=$1 OR guardian_user_id=$2',
    [DEV_ROLE_PATIENT_ID, DEV_ROLE_ACCOUNTS.find((account) => account.role === 'guardian').id],
  );
  const summary = {
    safe: false,
    usersByRole: Object.fromEntries(userCountsResult.rows.map((row) => [row.role, row.count])),
    patientCount: patientCountResult.rows[0].count,
    seededAlready: registry.size > 0,
  };
  const refused = (reason) => ({ ...summary, reason });

  if (registry.size && (registry.size !== REGISTRY_KEYS.size || [...registry.keys()].some((key) => !REGISTRY_KEYS.has(key)))) {
    return refused('unexpected_seed_registry_entries');
  }
  if (!registry.size) {
    if (identityResult.rowCount) return refused('development_account_identifier_collision');
    if (patientResult.rowCount || guardianLinks.rowCount) return refused('development_patient_identifier_collision');
    return { ...summary, safe: true, registry, identities: identityResult.rows };
  }

  const patientMarker = registry.get('patient');
  if (patientMarker?.entity_type !== 'patient' || patientMarker.entity_id !== DEV_ROLE_PATIENT_ID
    || patientResult.rowCount !== 1
    || patientResult.rows[0].id !== DEV_ROLE_PATIENT_ID
    || patientResult.rows[0].patient_type !== 'student'
    || stableJson(patientResult.rows[0].data) !== stableJson(DEV_PATIENT)
    || patientResult.rows[0].user_id !== registry.get('account:student')?.entity_id) {
    return refused('seeded_development_patient_changed');
  }

  if (guardianLinks.rowCount !== 1
    || guardianLinks.rows[0].guardian_user_id !== registry.get('account:guardian')?.entity_id
    || guardianLinks.rows[0].patient_id !== DEV_ROLE_PATIENT_ID
    || guardianLinks.rows[0].relationship !== 'Guardian') {
    return refused('seeded_guardian_link_changed');
  }

  if (identityResult.rowCount !== DEV_ROLE_ACCOUNTS.length) return refused('seeded_account_identity_changed');
  for (const account of DEV_ROLE_ACCOUNTS) {
    const marker = registry.get(`account:${account.key}`);
    const user = identityResult.rows.find((row) => row.id === account.id);
    if (marker?.entity_type !== 'user' || marker.entity_id !== account.id
      || !user || user.role !== account.role
      || user.username.toLowerCase() !== account.username || user.email.toLowerCase() !== account.email) {
      return refused('seeded_account_identity_changed');
    }
  }
  return { ...summary, safe: true, registry, identities: identityResult.rows };
}

function printPreflight(report) {
  console.log(JSON.stringify({
    databaseKind: safeDatabaseKind(process.env.DATABASE_URL),
    databaseUrlConfigured: databaseConfigured,
    connected: true,
    safeToSeedByContents: report.safe,
    usersByRole: report.usersByRole,
    patientCount: report.patientCount,
    seededAlready: report.seededAlready,
    reason: report.reason || null,
    requiresDevelopmentEnvironmentAndExplicitOptIn: true,
  }, null, 2));
}

async function runPreflight() {
  if (!databaseConfigured) {
    console.log(JSON.stringify({ databaseKind: 'unconfigured', databaseUrlConfigured: false, connected: false, safeToSeedByContents: false, reason: 'database_not_configured' }, null, 2));
    process.exitCode = 1;
    return;
  }
  try {
    const report = await inspectDatabase({ query });
    printPreflight(report);
    if (!report.safe) process.exitCode = 2;
  } catch (error) {
    console.log(JSON.stringify({
      databaseKind: safeDatabaseKind(process.env.DATABASE_URL),
      databaseUrlConfigured: databaseConfigured,
      connected: false,
      safeToSeedByContents: false,
      reason: error.code || 'database_preflight_failed',
    }, null, 2));
    process.exitCode = 1;
  }
}

function safeFailure(message) {
  const error = new Error(message);
  error.safeMessage = message;
  return error;
}

async function applySeed() {
  assertDevRoleAccountSeedEnabled();
  if (!databaseConfigured) throw safeFailure('DATABASE_URL is not configured.');
  const result = await transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('healthmate-dev-role-accounts')::bigint)");
    const inspection = await inspectDatabase(client);
    if (!inspection.safe) throw safeFailure(`Seed refused by collision preflight (${inspection.reason}).`);
    await client.query(`CREATE TABLE IF NOT EXISTS ${DEV_ROLE_SEED_REGISTRY} (
      seed_key TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL CHECK (entity_type IN ('user','patient')),
      entity_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(entity_type,entity_id)
    )`);

    const accountIds = {};
    for (const account of DEV_ROLE_ACCOUNTS) {
      const marker = inspection.registry.get(`account:${account.key}`);
      if (marker) {
        await client.query(
          `UPDATE users SET password_hash=$1,status='active',mfa_enabled=TRUE,updated_at=NOW() WHERE id=$2`,
          [await hashPassword(account.password), account.id],
        );
      } else {
        await client.query(
          `INSERT INTO users(id,username,email,password_hash,name,role,status,mfa_enabled)
           VALUES($1,$2,$3,$4,$5,$6,'active',TRUE)`,
          [account.id, account.username, account.email, await hashPassword(account.password), account.name, account.role],
        );
        await client.query(
          `INSERT INTO ${DEV_ROLE_SEED_REGISTRY}(seed_key,entity_type,entity_id) VALUES($1,'user',$2)`,
          [`account:${account.key}`, account.id],
        );
      }
      accountIds[account.key] = account.id;
    }

    if (!inspection.seededAlready) {
      await client.query(
        `INSERT INTO patients(id,user_id,patient_type,data) VALUES($1,$2,'student',$3::jsonb)`,
        [DEV_ROLE_PATIENT_ID, accountIds.student, JSON.stringify(DEV_PATIENT)],
      );
      await client.query(
        `INSERT INTO ${DEV_ROLE_SEED_REGISTRY}(seed_key,entity_type,entity_id) VALUES('patient','patient',$1)`,
        [DEV_ROLE_PATIENT_ID],
      );
      await client.query(
        `INSERT INTO guardian_patient_links(guardian_user_id,patient_id,relationship) VALUES($1,$2,'Guardian')`,
        [accountIds.guardian, DEV_ROLE_PATIENT_ID],
      );
    }
    return { accountCount: DEV_ROLE_ACCOUNTS.length, newPatientCreated: !inspection.seededAlready };
  });
  console.log(JSON.stringify({ seeded: true, ...result, credentials: 'See docs/DEV_ROLE_ACCOUNTS.md' }, null, 2));
}

const mode = process.argv[2] || '--preflight';
try {
  if (mode === '--preflight') await runPreflight();
  else if (mode === '--apply') await applySeed();
  else throw safeFailure('Use --preflight or --apply.');
} catch (error) {
  console.error(error.safeMessage || `Development account seed failed (${error.code || 'unknown'}).`);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
