import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceClinicDataVersion, hydrateAuthoritativeRecord, saveClinicData, saveClinicDataInTransaction, studentRecordForUser, syncCollection, syncPatients, validateClinicDataPayload, validateVersionAfterAdvance } from './repository.js';

test('repository hydration prefers authoritative queue columns over legacy JSON', () => {
  const result = hydrateAuthoritativeRecord('queue', {
    id: 'queue-1',
    patient_id: 'student-1',
    status: 'Being Seen',
    priority: 3,
    created_at: new Date('2026-09-23T02:30:00.000Z'),
    updated_at: new Date('2026-09-23T02:35:00.000Z'),
    data: { id: 'legacy-id', patientId: 'legacy-student', status: 'Waiting', priority: 0 },
  });

  assert.deepEqual(result, {
    id: 'queue-1',
    patientId: 'student-1',
    status: 'Being Seen',
    priority: 3,
    arrivalAt: '2026-09-23T02:30:00.000Z',
    updatedAt: '2026-09-23T02:35:00.000Z',
  });
});

test('repository hydration keeps appointment patient and scheduling state authoritative', () => {
  const result = hydrateAuthoritativeRecord('appointments', {
    id: 'appointment-1',
    patient_id: 'student-2',
    starts_at: new Date('2026-09-24T01:00:00.000Z'),
    status: 'Scheduled',
    created_at: new Date('2026-09-23T02:00:00.000Z'),
    updated_at: new Date('2026-09-23T02:10:00.000Z'),
    data: { patientId: 'wrong-student', startsAt: 'legacy-time', status: 'Requested', reason: 'Follow-up' },
  });

  assert.equal(result.patientId, 'student-2');
  assert.equal(result.startsAt, '2026-09-24T01:00:00.000Z');
  assert.equal(result.status, 'Scheduled');
  assert.equal(result.reason, 'Follow-up');
});

test('repository hydration keeps inventory quantity authoritative and carries archive metadata', () => {
  const result = hydrateAuthoritativeRecord('inventory', { id: 'medicine-1', quantity: 3, data: { name: 'Bandages', quantity: 99, archived: true } });
  assert.deepEqual(result, { id: 'medicine-1', quantity: 3, name: 'Bandages', archived: true });
});

test('immunization hydration adds authoritative patient and creation timestamps', () => {
  const result = hydrateAuthoritativeRecord('immunizations', {
    id: 'immunization-1',
    patient_id: 'student-1',
    created_at: new Date('2026-09-23T02:00:00.000Z'),
    data: { id: 'legacy-id', studentId: 99, vaccineName: 'MMR', dateAdministered: '2026-09-01' },
  });
  assert.deepEqual(result, {
    id: 'immunization-1',
    patientId: 'student-1',
    createdAt: '2026-09-23T02:00:00.000Z',
    studentId: 99,
    vaccineName: 'MMR',
    dateAdministered: '2026-09-01',
  });
});

test('bulk sync validation is complete and upsert-only writes preserve omitted records', async () => {
  const complete = { settings: {}, students: [], visits: [], screenings: [], immunizations: [], incidents: [], appointments: [], queue: [], inventory: [], dispenseLogs: [], stockAdjustments: [] };
  assert.equal(validateClinicDataPayload(complete, 3).valid, true);
  assert.equal(validateClinicDataPayload({ ...complete, screenings: undefined, incidents: undefined }, 3).valid, true);
  assert.equal(validateClinicDataPayload({ ...complete, immunizations: undefined }, 3).valid, false);
  assert.equal(validateClinicDataPayload({ settings: {}, students: [], screenings: [], immunizations: [], incidents: [] }, 3).valid, true);
  await assert.rejects(
    () => saveClinicData(complete, { role: 'system_administrator' }, 3),
    (error) => error.status === 403,
  );
  const queries = [];
  const client = { query: async (...args) => { queries.push(args); return { rows: [] }; } };
  await syncPatients(client, []);
  await syncCollection(client, 'visits', [], 'nurse-1');
  await syncCollection(client, 'visits', [{ id: 'visit-1', patientId: 'student-1', chiefComplaint: 'Headache' }], 'nurse-1');
  assert.equal(queries.some(([sql]) => /\bDELETE\b/i.test(sql)), false);
  assert.match(queries.at(-1)[0], /INSERT INTO visits\(/);
});

test('removed screening and incident collections are not written by repository sync', async () => {
  const queries = [];
  const client = { query: async (...args) => { queries.push(args); return { rows: [] }; } };
  await syncCollection(client, 'screenings', [{ id: 'legacy-screen', patientId: 'student-1' }], 'nurse-1');
  await syncCollection(client, 'incidents', [{ id: 'legacy-incident', patientId: 'student-1' }], 'nurse-1');
  assert.deepEqual(queries, []);
});

test('snapshot writes reject versions made stale by a transactional API write', async () => {
  const queries = [];
  let version = 4;
  const client = {
    query: async (sql) => {
      queries.push(sql);
      if (/UPDATE clinic_settings SET version=version\+1/.test(sql)) {
        version += 1;
        return { rowCount: 1, rows: [{ version }] };
      }
      if (/SELECT data, version FROM clinic_settings WHERE id=1 FOR UPDATE/.test(sql)) {
        return { rowCount: 1, rows: [{ data: { schoolName: 'Example School' }, version }] };
      }
      if (/UPDATE clinic_settings SET data=/.test(sql)) {
        version += 1;
        return { rowCount: 1, rows: [{ version }] };
      }
      throw new Error(`Unexpected query in snapshot version test: ${sql}`);
    },
  };
  const snapshot = {
    settings: {}, students: [], visits: [], screenings: [], immunizations: [], incidents: [],
    appointments: [], queue: [], inventory: [], dispenseLogs: [], stockAdjustments: [],
  };

  await advanceClinicDataVersion(client);
  assert.equal(version, 5);
  await assert.rejects(
    () => saveClinicDataInTransaction(client, snapshot, { id: 'nurse-1', role: 'school_nurse' }, 4),
    (error) => error.status === 409 && error.code === 'VERSION_CONFLICT',
  );
  assert.equal(queries.length, 2, 'the stale snapshot stops before syncing any collections');

  const safeSnapshot = { ...snapshot, screenings: [], immunizations: [], incidents: [] };
  const savedVersion = await saveClinicDataInTransaction(client, safeSnapshot, { id: 'nurse-1', role: 'school_nurse' }, 5);
  assert.equal(savedVersion, 6);
  assert.equal(queries.some((sql) => /INSERT INTO (visits|appointments|queue_entries|inventory_items|dispense_logs|stock_adjustments)\(/i.test(sql)), false);
});

test('legacy snapshots never upsert visits, appointments, queue, inventory or stock history', async () => {
  const protectedRecord = { id: 'should-not-persist', patientId: 'student-1', quantity: 999, status: 'Completed' };
  const snapshot = {
    settings: {}, students: [], screenings: [], immunizations: [], incidents: [],
    visits: [protectedRecord], appointments: [protectedRecord], queue: [protectedRecord],
    inventory: [protectedRecord], dispenseLogs: [protectedRecord], stockAdjustments: [protectedRecord],
  };
  const queries = [];
  const client = {
    query: async (sql) => {
      queries.push(sql);
      if (/SELECT data, version FROM clinic_settings/.test(sql)) return { rows: [{ data: {}, version: 1 }] };
      if (/UPDATE clinic_settings SET data=/.test(sql)) return { rows: [{ version: 2 }] };
      return { rows: [] };
    },
  };

  await saveClinicDataInTransaction(client, snapshot, { id: 'nurse-1', role: 'school_nurse' }, 1);

  assert.ok(queries.some((sql) => /INSERT INTO patients/.test(sql)) === false);
  assert.equal(queries.some((sql) => /INSERT INTO (visits|appointments|queue_entries|inventory_items|dispense_logs|stock_adjustments)\(/i.test(sql)), false);
  assert.equal(queries.filter((sql) => /INSERT INTO (screenings|immunizations|incidents)\(/i.test(sql)).length, 0);
});

test('roster bulk sync cannot set patient consent fields and preserves server values', async () => {
  const queries = [];
  const client = { query: async (...args) => { queries.push(args); return { rows: [] }; } };
  await syncPatients(client, [{ id: 'student-1', name: 'Fictional Patient', consentStatus: 'received', consentDueDate: '2099-01-01' }]);
  const [sql, params] = queries[0];
  assert.match(sql, /EXCLUDED\.data - 'consentStatus' - 'consentDueDate'/);
  assert.match(sql, /patients\.data->'consentStatus'/);
  assert.match(sql, /patients\.data->'consentDueDate'/);
  assert.deepEqual(JSON.parse(params[2]), { id: 'student-1', name: 'Fictional Patient', consentStatus: 'received', consentDueDate: '2099-01-01' }, 'database expression, not client JSON, controls consent fields');
});

test('dedicated transactional writes reject a stale clinic snapshot version', async () => {
  const client = { query: async () => ({ rows: [{ version: 8 }] }) };
  assert.equal(await validateVersionAfterAdvance(client, 7), 8);
  await assert.rejects(
    () => validateVersionAfterAdvance(client, 6),
    (error) => error.status === 409 && error.code === 'VERSION_CONFLICT',
  );
});

test('administrator clinic snapshots expose demographic linkage fields without clinical details', () => {
  const result = studentRecordForUser({ id: 'student-1', studentId: 'PTHI-1', name: 'Fictional Student', gradeLevel: 'Grade 4', allergies: 'Peanuts', conditions: 'Asthma' }, { role: 'system_administrator' });
  assert.deepEqual(result, { id: 'student-1', studentId: 'PTHI-1', name: 'Fictional Student', gradeLevel: 'Grade 4' });
});
