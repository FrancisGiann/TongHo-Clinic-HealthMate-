import 'dotenv/config';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { closeDatabase, query, transaction } from './db.js';

const currentDir = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(currentDir, 'migrations');

async function migrate() {
  await query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);

  const files = (await readdir(migrationsDir)).filter((name) => name.endsWith('.sql')).sort();
  for (const file of files) {
    const applied = await query('SELECT 1 FROM schema_migrations WHERE version = $1', [file]);
    if (applied.rowCount) continue;
    const sql = await readFile(join(migrationsDir, file), 'utf8');
    await transaction(async (client) => {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(version) VALUES ($1)', [file]);
    });
    console.log(`Applied migration ${file}`);
  }
}

async function bootstrapAdmin() {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!email || !password) return;
  if (password.length < 12) throw new Error('BOOTSTRAP_ADMIN_PASSWORD must have at least 12 characters.');
  const existing = await query('SELECT id FROM users WHERE LOWER(email) = $1', [email]);
  if (existing.rowCount) return;
  const username = (process.env.BOOTSTRAP_ADMIN_USERNAME || email.split('@')[0]).toLowerCase();
  const passwordHash = await bcrypt.hash(password, 12);
  await query(
    `INSERT INTO users(id, username, email, password_hash, name, role, status, mfa_enabled)
     VALUES ($1,$2,$3,$4,$5,'system_administrator','active',TRUE)`,
    [crypto.randomUUID(), username, email, passwordHash, process.env.BOOTSTRAP_ADMIN_NAME || 'System Administrator'],
  );
  console.log(`Created bootstrap administrator ${email}`);
}

try {
  await migrate();
  await bootstrapAdmin();
} finally {
  await closeDatabase();
}
