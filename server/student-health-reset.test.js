import test from 'node:test';
import assert from 'node:assert/strict';
import { applyStudentHealthReset, disposableStudentResetTargetAllowed, studentResetTargetFingerprint, validateStudentResetArguments } from './student-health-reset.js';

const safeDatabase = 'postgres://localhost/healthmate-reset-disposable';
const safeEnvironment = { HEALTHMATE_RESET_DISPOSABLE: 'true' };

test('student reset defaults to dry-run and only accepts explicitly named local disposable databases', () => {
  assert.equal(disposableStudentResetTargetAllowed(safeDatabase, safeEnvironment), true);
  assert.equal(disposableStudentResetTargetAllowed('postgres://db.example.test/healthmate-reset-disposable', safeEnvironment), false);
  assert.equal(disposableStudentResetTargetAllowed('postgres://localhost/healthmate-production', safeEnvironment), false);
  assert.equal(studentResetTargetFingerprint('postgres://db.example.test:5432/healthmate-demo'), 'db.example.test:5432/healthmate-demo');
  const allowlisted = { HEALTHMATE_RESET_ALLOWED_TARGETS: '["db.example.test:5432/healthmate-demo"]' };
  assert.equal(disposableStudentResetTargetAllowed('postgres://db.example.test:5432/healthmate-demo', allowlisted), true);
  assert.deepEqual(validateStudentResetArguments([], safeEnvironment, safeDatabase), { valid: true, apply: false });
  assert.equal(validateStudentResetArguments(['--apply'], safeEnvironment, safeDatabase).valid, false);
});

test('student reset apply requires an explicit backup flag and recorded backup reference', () => {
  const withBackup = { ...safeEnvironment, HEALTHMATE_RESET_BACKUP_REFERENCE: 'verified-test-backup-2026-09-28' };
  assert.equal(validateStudentResetArguments(['--apply', '--backup-confirmed'], withBackup, safeDatabase).valid, true);
  assert.equal(validateStudentResetArguments(['--apply', '--backup-confirmed'], safeEnvironment, safeDatabase).valid, false);
  assert.equal(validateStudentResetArguments(['--apply', '--dry-run', '--backup-confirmed'], withBackup, safeDatabase).valid, false);
});

test('reset applies only student-linked cleanup and preserves account, faculty, settings, inventory, and audit rows', async () => {
  const statements = [];
  const client = {
    async query(sql, values = []) {
      statements.push({ sql: sql.replace(/\s+/g, ' ').trim(), values });
      if (/SELECT id FROM audit_logs WHERE event='STUDENT_HEALTH_DATA_RESET'/.test(sql)) return { rows: [], rowCount: 0 };
      if (/SELECT id FROM patients WHERE patient_type='student' FOR UPDATE/.test(sql)) return { rows: [{ id: 'student-1' }, { id: 'student-2' }] };
      if (/SELECT DISTINCT guardian_user_id AS id FROM guardian_patient_links/.test(sql)) return { rows: [{ id: 'guardian-1' }] };
      return { rows: [], rowCount: 0 };
    },
  };

  const result = await applyStudentHealthReset(client);
  assert.deepEqual(result, { deletedStudents: 2, suspendedGuardians: 1 });
  assert.ok(statements.some(({ sql }) => sql.startsWith('DELETE FROM patients')));
  assert.match(statements[0].sql, /pg_advisory_xact_lock/);
  assert.ok(statements.some(({ sql }) => sql.startsWith('DELETE FROM report_snapshots')));
  assert.ok(statements.some(({ sql }) => sql.startsWith('DELETE FROM notifications') && !sql.includes('user_id=ANY')));
  assert.ok(statements.some(({ sql }) => sql.includes("UPDATE users SET status='suspended'") && sql.includes("AND role='guardian'")));
  assert.ok(statements.some(({ sql }) => sql.startsWith('INSERT INTO audit_logs') && sql.includes('STUDENT_HEALTH_DATA_RESET')));
  assert.ok(!statements.some(({ sql }) => /DELETE FROM (users|faculty|clinic_settings|inventory_items|audit_logs)/i.test(sql)));
});

test('student reset cannot be applied twice to the same database', async () => {
  const client = { query: async () => ({ rows: [{ id: 'prior-reset' }], rowCount: 1 }) };
  await assert.rejects(applyStudentHealthReset(client), { code: 'RESET_ALREADY_APPLIED' });
});
