import test from 'node:test';
import assert from 'node:assert/strict';
import { applyStudentHealthReset, disposableStudentResetTargetAllowed, inspectStudentHealthReset, studentResetTargetFingerprint, validateStudentResetArguments } from './student-health-reset.js';

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

test('reset previews new incidents and queues private photo deletion before patient cascade', async () => {
  let previewSql = '';
  const preview = await inspectStudentHealthReset({
    async query(sql) {
      previewSql = sql.replace(/\s+/g, ' ').trim();
      return { rows: [{ legacy_incidents: 4, student_incidents: 2, incident_photos: 3 }], rowCount: 1 };
    },
  });
  assert.deepEqual(preview, { legacy_incidents: 4, student_incidents: 2, incident_photos: 3 });
  assert.match(previewSql, /FROM incidents WHERE patient_id IN \(SELECT id FROM student_patients\)\) AS legacy_incidents/);
  assert.match(previewSql, /FROM student_incidents i JOIN patients p ON p.id=i.patient_id/);
  assert.match(previewSql, /FROM incident_photos ip JOIN student_incidents i ON i.id=ip.incident_id/);

  const patients = new Set(['student-a', 'student-b']);
  const incidentRows = [
    { id: 'incident-a', patientId: 'student-a' },
    { id: 'incident-b', patientId: 'student-b' },
    { id: 'incident-faculty', patientId: 'faculty-a' },
  ];
  const photos = [
    { id: 'photo-a', incidentId: 'incident-a', storageKey: 'incidents/incident-a/photo-a.png', deleted: false },
    { id: 'photo-b', incidentId: 'incident-b', storageKey: 'incidents/incident-b/photo-b.webp', deleted: false },
    { id: 'photo-faculty', incidentId: 'incident-faculty', storageKey: 'incidents/incident-faculty/photo-f.png', deleted: false },
  ];
  const tasks = new Map();
  const order = [];
  let patientCascadeRan = false;
  const client = {
    async query(sql, values = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      order.push(normalized);
      if (/SELECT id FROM audit_logs WHERE event='STUDENT_HEALTH_DATA_RESET'/.test(normalized)) return { rows: [], rowCount: 0 };
      if (/SELECT id FROM patients WHERE patient_type='student' FOR UPDATE/.test(normalized)) return { rows: [...patients].map((id) => ({ id })), rowCount: patients.size };
      if (/SELECT DISTINCT guardian_user_id AS id FROM guardian_patient_links/.test(normalized)) return { rows: [], rowCount: 0 };
      if (/SELECT i.id FROM student_incidents i/.test(normalized)) return { rows: incidentRows.filter((incident) => values[0].includes(incident.patientId)).map(({ id }) => ({ id })), rowCount: 2 };
      if (/UPDATE incident_photos ip SET deletion_requested_at/.test(normalized)) {
        for (const photo of photos) {
          const incident = incidentRows.find((row) => row.id === photo.incidentId);
          if (incident && values[0].includes(incident.patientId) && !photo.deleted) photo.deletionRequested = true;
        }
        return { rows: [], rowCount: 2 };
      }
      if (/INSERT INTO incident_photo_deletion_tasks/.test(normalized)) {
        assert.equal(patientCascadeRan, false, 'photo keys are durably queued before the patient cascade');
        assert.match(normalized, /'student_reset'/);
        for (const photo of photos) {
          const incident = incidentRows.find((row) => row.id === photo.incidentId);
          if (incident && values[0].includes(incident.patientId) && !photo.deleted) {
            tasks.set(photo.storageKey, { storageKey: photo.storageKey, photoId: photo.id, reason: 'student_reset' });
          }
        }
        return { rows: [], rowCount: 2 };
      }
      if (/DELETE FROM patients WHERE id=ANY/.test(normalized)) {
        patientCascadeRan = true;
        for (const task of tasks.values()) task.photoId = null; // photo_id ON DELETE SET NULL preserves each storage key
        for (let index = photos.length - 1; index >= 0; index -= 1) {
          const incident = incidentRows.find((row) => row.id === photos[index].incidentId);
          if (incident && values[0].includes(incident.patientId)) photos.splice(index, 1);
        }
        return { rows: [], rowCount: 2 };
      }
      return { rows: [], rowCount: 1 };
    },
  };

  const result = await applyStudentHealthReset(client);
  assert.deepEqual(result, { deletedStudents: 2, suspendedGuardians: 0 });
  const queueIndex = order.findIndex((sql) => sql.startsWith('INSERT INTO incident_photo_deletion_tasks'));
  const cascadeIndex = order.findIndex((sql) => sql.startsWith('DELETE FROM patients'));
  assert.ok(queueIndex >= 0 && queueIndex < cascadeIndex);
  const incidentLockIndex = order.findIndex((sql) => sql.startsWith('SELECT i.id FROM student_incidents i') && sql.includes('FOR UPDATE'));
  const photoConsentAdvisoryIndex = order.findIndex((sql) => sql.includes('pg_advisory_xact_lock(hashtext($1))') && order.indexOf(sql) > 0);
  assert.ok(photoConsentAdvisoryIndex >= 0 && photoConsentAdvisoryIndex < incidentLockIndex, 'reset serializes with consent and upload finalization before locking incidents');
  assert.deepEqual([...tasks.values()], [
    { storageKey: 'incidents/incident-a/photo-a.png', photoId: null, reason: 'student_reset' },
    { storageKey: 'incidents/incident-b/photo-b.webp', photoId: null, reason: 'student_reset' },
  ]);
  assert.deepEqual(photos.map((photo) => photo.id), ['photo-faculty']);
  assert.ok(!order.some((sql) => /branding_settings|branding\//i.test(sql)), 'reset does not mutate branding assets or settings');
});

test('student reset cannot be applied twice to the same database', async () => {
  const client = { query: async () => ({ rows: [{ id: 'prior-reset' }], rowCount: 1 }) };
  await assert.rejects(applyStudentHealthReset(client), { code: 'RESET_ALREADY_APPLIED' });
});
