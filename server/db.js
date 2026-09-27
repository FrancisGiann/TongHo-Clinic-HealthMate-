import pg from 'pg';
import { readFileSync } from 'node:fs';

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL?.trim();
const certificatePath = process.env.DB_SSL_CA_FILE?.trim();

export function databaseTlsVerifiedForConfig(url = connectionString, env = process.env) {
  if (!url || env.DB_SSL === 'false' || env.DB_SSL_REJECT_UNAUTHORIZED === 'false') return false;
  try {
    const parsed = new URL(url);
    return !['sslmode', 'sslrootcert', 'sslcert', 'sslkey'].some((parameter) => parsed.searchParams.has(parameter));
  } catch {
    return false;
  }
}

function sslConfiguration() {
  if (process.env.DB_SSL === 'false') return false;
  return {
    rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false',
    ...(certificatePath ? { ca: readFileSync(certificatePath, 'utf8') } : {}),
  };
}

export const databaseConfigured = Boolean(connectionString);
export const databaseTlsVerified = databaseTlsVerifiedForConfig();

if (process.env.NODE_ENV === 'production' && databaseConfigured && !databaseTlsVerified) {
  throw new Error('Production DATABASE_URL must omit SSL query parameters; configure verified TLS with DB_SSL and DB_SSL_CA_FILE.');
}

export const pool = databaseConfigured
  ? new Pool({
      connectionString,
      ssl: sslConfiguration(),
      max: Number(process.env.DB_POOL_MAX || 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    })
  : null;

export function requireDatabase() {
  if (!pool) {
    const error = new Error('DATABASE_URL is not configured.');
    error.code = 'DATABASE_NOT_CONFIGURED';
    throw error;
  }
  return pool;
}

export async function query(text, params = []) {
  return requireDatabase().query(text, params);
}

export async function transaction(work) {
  const client = await requireDatabase().connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function closeDatabase() {
  if (pool) await pool.end();
}
