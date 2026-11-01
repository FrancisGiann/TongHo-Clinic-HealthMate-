import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { advanceClinicDataVersion, hydrateAuthoritativeRecord, loadClinicData, loadNurseDashboardData, loadPatientClinicReportData, loadPatientDirectory, loadPatientDirectoryExport, loadPatientPicker, saveClinicData, saveClinicDataInTransaction, studentRecordForUser, syncCollection, syncPatients, validateClinicDataPayload, validateRosterSnapshot, validateVersionAfterAdvance } from './repository.js';

function clinicReadResult(overrides = {}) {
  return { rows: [{
    settings: {},
    version: 48,
    students: [],
    visits: [],
    appointments: [],
    inventory: [],
    dispenseLogs: [],
    stockAdjustments: [],
    ...overrides,
  }] };
}

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

test('bulk sync accepts retired fields as absent and upsert-only writes preserve omitted records', async () => {
  const complete = { settings: {}, students: [], visits: [], immunizations: [], appointments: [], queue: [], inventory: [], dispenseLogs: [], stockAdjustments: [] };
  assert.equal(validateClinicDataPayload(complete, 3).valid, true);
  assert.equal(validateClinicDataPayload({ settings: {}, students: [] }, 3).valid, true);
  assert.equal(validateClinicDataPayload({ ...complete, visits: undefined }, 3, { internal: true }).valid, false);
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
  assert.match(queries.at(-1)[0], /\$3::jsonb - '_requestFingerprint'/);
  assert.match(queries.at(-1)[0], /visits\.data->'_requestFingerprint'/);
});

test('retired queue, immunization, screening, and incident collections cannot be synced', async () => {
  const queries = [];
  const client = { query: async (...args) => { queries.push(args); return { rows: [] }; } };
  await syncCollection(client, 'queue', [{ id: 'legacy-queue', patientId: 'student-1' }], 'nurse-1');
  await syncCollection(client, 'immunizations', [{ id: 'legacy-vaccine', patientId: 'student-1' }], 'nurse-1');
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
    settings: {}, students: [], visits: [], immunizations: [],
    appointments: [], queue: [], inventory: [], dispenseLogs: [], stockAdjustments: [],
  };

  await advanceClinicDataVersion(client);
  assert.equal(version, 5);
  await assert.rejects(
    () => saveClinicDataInTransaction(client, snapshot, { id: 'nurse-1', role: 'school_nurse' }, 4),
    (error) => error.status === 409 && error.code === 'VERSION_CONFLICT',
  );
  assert.equal(queries.length, 2, 'the stale snapshot stops before syncing any collections');

  const safeSnapshot = { ...snapshot, immunizations: [] };
  const savedVersion = await saveClinicDataInTransaction(client, safeSnapshot, { id: 'nurse-1', role: 'school_nurse' }, 5);
  assert.equal(savedVersion, 6);
  assert.equal(queries.some((sql) => /INSERT INTO (visits|appointments|queue_entries|inventory_items|dispense_logs|stock_adjustments)\(/i.test(sql)), false);
});

test('legacy snapshots cannot write visits, appointments, retired workflows, inventory or stock history', async () => {
  const protectedRecord = { id: 'should-not-persist', patientId: 'student-1', quantity: 999, status: 'Completed' };
  const snapshot = {
    settings: {}, students: [], immunizations: [],
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
  assert.equal(queries.some((sql) => /INSERT INTO (visits|appointments|queue_entries|immunizations|inventory_items|dispense_logs|stock_adjustments)\(/i.test(sql)), false);
  assert.equal(queries.filter((sql) => /INSERT INTO (screenings|immunizations|incidents)\(/i.test(sql)).length, 0);
});

test('internal demo snapshots do not write retired collections', async () => {
  const snapshot = {
    settings: {}, students: [], visits: [], screenings: [], incidents: [], appointments: [],
    immunizations: [{ id: 'legacy-vaccine', patientId: 'student-1' }],
    queue: [{ id: 'legacy-queue', patientId: 'student-1' }],
    inventory: [], dispenseLogs: [], stockAdjustments: [],
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

  await saveClinicDataInTransaction(client, snapshot, { id: 'seed-admin', role: 'system_administrator' }, 1, { internal: true });

  assert.equal(queries.some((sql) => /INSERT INTO (immunizations|queue_entries)\(/i.test(sql)), false);
});

test('roster bulk sync cannot set patient consent fields and preserves server values', async () => {
  const queries = [];
  const client = { query: async (...args) => {
    queries.push(args);
    if (/SELECT data FROM patients/.test(args[0])) return { rows: [{ data: { guardianHealthRecord: { allergies: 'Peanuts', allergiesStatus: 'reported' } } }] };
    return { rows: [] };
  } };
  await syncPatients(client, [{ id: 'student-1', name: 'Fictional Patient', consentStatus: 'received', consentDueDate: '2099-01-01' }]);
  const [sql, params] = queries.find(([statement]) => /INSERT INTO patients/.test(statement));
  assert.match(sql, /EXCLUDED\.data - 'consentStatus' - 'consentDueDate'/);
  assert.match(sql, /patients\.data->'consentStatus'/);
  assert.match(sql, /patients\.data->'consentDueDate'/);
  assert.deepEqual(JSON.parse(params[2]), {
    id: 'student-1', name: 'Fictional Patient', consentStatus: 'received', consentDueDate: '2099-01-01',
    allergies: 'Peanuts', allergiesStatus: 'reported',
    guardianHealthRecord: { allergies: 'Peanuts', allergiesStatus: 'reported' },
  }, 'canonical accepted answers come from the locked database row while SQL controls consent fields');
});

test('nurse clinic snapshots cannot overwrite accepted guardian health fields', async () => {
  const queries = [];
  const accepted = { allergies: 'Peanuts', allergiesStatus: 'reported', medicationAtHome: { pain: true, painName: 'Acetaminophen' } };
  const client = { query: async (...args) => {
    queries.push(args);
    if (/SELECT data FROM patients/.test(args[0])) return { rows: [{ data: { guardianHealthRecord: accepted } }] };
    return { rows: [] };
  } };
  await syncPatients(client, [{ id: 'student-1', patientType: 'student', name: 'Fictional Patient', allergies: '', allergiesStatus: 'none', medicationAtHome: { pain: false } }]);
  const [, params] = queries.find(([statement]) => /INSERT INTO patients/.test(statement));
  const stored = JSON.parse(params[2]);
  assert.equal(stored.allergies, 'Peanuts');
  assert.equal(stored.allergiesStatus, 'reported');
  assert.deepEqual(stored.medicationAtHome, { pain: true, painName: 'Acetaminophen' });
  assert.deepEqual(stored.guardianHealthRecord, accepted);
});

test('roster snapshot rejects a normalized student ID collision even when the existing student is omitted', async () => {
  let queryArgs;
  const client = { query: async (...args) => {
    queryArgs = args;
    return { rows: [{ id: 'existing-student', patient_type: 'student', data: { studentId: 'PTHI-42', name: 'Existing Student', gradeLevel: 'Grade 4' } }] };
  } };
  const rows = [{ id: 'new-student', patientType: 'student', studentId: '  pthi-42  ', name: 'New Student', gradeLevel: 'Grade 5', section: '', adviser: '' }];

  await assert.rejects(() => validateRosterSnapshot(client, rows), (error) => error.status === 409 && error.code === 'DUPLICATE_RECORD');
  assert.match(queryArgs[0], /LOWER\(CASE WHEN patient_type='faculty'/);
  assert.deepEqual(queryArgs[1].slice(0, 2), [['new-student'], ['pthi-42']]);
  assert.equal(rows[0].studentId, 'pthi-42');
});

test('roster snapshot accepts an unchanged self-update and does not require student fields for faculty', async () => {
  const student = { id: 'student-self', patientType: 'student', studentId: 'PTHI-11', name: 'Example Student', gradeLevel: 'Grade 3', section: 'A', adviser: 'Example Adviser' };
  const faculty = { id: 'faculty-self', patientType: 'faculty', facultyId: 'STAFF-11', studentId: 'STAFF-11', name: 'Example Faculty' };
  const currentRows = [
    { id: student.id, patient_type: 'student', data: { ...student } },
    { id: faculty.id, patient_type: 'faculty', data: { ...faculty } },
  ];
  const client = { query: async () => ({ rows: currentRows }) };

  await validateRosterSnapshot(client, [student, faculty]);
  assert.equal(student.studentId, 'PTHI-11');
  assert.equal(faculty.patientType, 'faculty');
});

test('roster snapshot rejects malformed student fields, duplicated record IDs, duplicate identities, and patient-type changes', async (t) => {
  const noPersistedRows = { query: async () => ({ rows: [] }) };
  const validStudent = (overrides = {}) => ({
    id: crypto.randomUUID(), patientType: 'student', studentId: 'PTHI-12', name: 'Example Student', gradeLevel: 'Grade 3', section: '', adviser: '', ...overrides,
  });
  for (const [label, record] of [
    ['missing ID', validStudent({ studentId: ' ' })],
    ['unsupported grade', validStudent({ gradeLevel: 'Grade 11' })],
    ['oversized name', validStudent({ name: 'N'.repeat(161) })],
    ['non-text section', validStudent({ section: { value: 'A' } })],
  ]) {
    await t.test(label, async () => assert.rejects(
      () => validateRosterSnapshot(noPersistedRows, [record]),
      (error) => error.status === 400 && error.code === 'VALIDATION_ERROR',
    ));
  }

  const sharedId = 'duplicate-row';
  await assert.rejects(
    () => validateRosterSnapshot(noPersistedRows, [validStudent({ id: sharedId }), validStudent({ id: sharedId, studentId: 'PTHI-13' })]),
    (error) => error.status === 409 && error.code === 'DUPLICATE_RECORD',
  );
  await assert.rejects(
    () => validateRosterSnapshot(noPersistedRows, [validStudent(), validStudent({ id: crypto.randomUUID(), studentId: ' pthi-12 ' })]),
    (error) => error.status === 409 && error.code === 'DUPLICATE_RECORD',
  );
  await assert.rejects(
    () => validateRosterSnapshot({ query: async () => ({ rows: [{ id: 'existing-student', patient_type: 'student', data: { studentId: 'PTHI-14' } }] }) }, [
      { id: 'new-faculty', patientType: 'faculty', facultyId: ' ', studentId: ' pthi-14 ', name: 'Example Faculty' },
    ]),
    (error) => error.status === 409 && error.code === 'DUPLICATE_RECORD',
  );
  await assert.rejects(
    () => validateRosterSnapshot(noPersistedRows, [
      { id: 'mismatched-faculty', patientType: 'faculty', facultyId: 'FAC-14', studentId: 'STUDENT-14', name: 'Example Faculty' },
    ]),
    (error) => error.status === 400 && error.code === 'VALIDATION_ERROR',
  );
  const currentFaculty = { id: 'faculty-type-lock', patientType: 'student', studentId: 'STAFF-12', name: 'Example Staff', gradeLevel: 'Grade 3' };
  await assert.rejects(
    () => validateRosterSnapshot({ query: async () => ({ rows: [{ id: currentFaculty.id, patient_type: 'faculty', data: { ...currentFaculty, patientType: 'faculty', facultyId: 'STAFF-12' } }] }) }, [currentFaculty]),
    (error) => error.status === 400 && error.code === 'VALIDATION_ERROR',
  );
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

test('administrator bootstrap projects the roster and settings in one read while preserving explicit nulls', async () => {
  const source = { name: 'Example Student', gradeLevel: 'Grade 4', birthDate: null, gender: false, allergies: 'Confidential clinical value' };
  const calls = [];
  const queryFn = async (sql, params = []) => {
    calls.push({ sql, params });
    const fields = params[0];
    const data = Object.fromEntries(fields.filter((field) => Object.hasOwn(source, field)).map((field) => [field, source[field]]));
    return clinicReadResult({ students: [{ id: 'student-1', patient_type: 'student', data }] });
  };

  const data = await loadClinicData({ id: 'admin-1', role: 'system_administrator' }, { queryFn });
  const [read] = calls;
  assert.equal(calls.length, 1);
  assert.match(read.sql, /clinic_settings/);
  assert.match(read.sql, /jsonb_object_agg/);
  assert.match(read.sql, /patients\.data \?/);
  assert.ok(read.params[0].includes('birthDate'));
  assert.ok(!read.params[0].includes('allergies'));
  assert.doesNotMatch(read.sql, /FROM (visits|appointments|inventory_items|dispense_logs|stock_adjustments)\b/);
  assert.deepEqual(data.students[0], { id: 'student-1', patientType: 'student', name: 'Example Student', gradeLevel: 'Grade 4', birthDate: null, gender: false });
  assert.deepEqual(data.visits, []);
  assert.deepEqual(data.appointments, []);
  assert.deepEqual(data.inventory, []);
});

test('guardian bootstrap resolves linked IDs first, then reads only parameter-scoped projected data', async () => {
  const source = {
    name: 'Example Student',
    allergies: null,
    allergiesStatus: 'none_reported',
    g6pdDeficiency: false,
    guardianHealthRecord: { allergies: null, allergiesStatus: 'none_reported' },
    email: 'private@example.test',
  };
  const calls = [];
  const queryFn = async (sql, params = []) => {
    calls.push({ sql, params });
    if (/FROM guardian_patient_links/.test(sql)) return { rows: [{ id: 'linked-student-1' }] };
    const fields = params[1];
    const data = Object.fromEntries(fields.filter((field) => Object.hasOwn(source, field)).map((field) => [field, source[field]]));
    return clinicReadResult({ students: [{ id: 'linked-student-1', patient_type: 'student', data }] });
  };

  const data = await loadClinicData({ id: 'guardian-1', role: 'guardian' }, { queryFn });
  assert.equal(calls.length, 2, 'guardian lookup remains a dependency before the single scoped bootstrap query');
  assert.match(calls[0].sql, /FROM guardian_patient_links/);
  const [read] = calls.slice(1);
  assert.match(read.sql, /FROM clinic_settings/);
  assert.match(read.sql, /patients\.id=ANY\(\$1::text\[\]\)/);
  assert.match(read.sql, /FROM visits WHERE patient_id=ANY\(\$1::text\[\]\)/);
  assert.match(read.sql, /FROM appointments WHERE patient_id=ANY\(\$1::text\[\]\)/);
  assert.deepEqual(read.params[0], ['linked-student-1']);
  assert.ok(read.params[1].includes('guardianHealthRecord'));
  assert.ok(!read.params[1].includes('email'));
  assert.doesNotMatch(read.sql, /linked-student-1/);
  assert.deepEqual(data.students[0], {
    id: 'linked-student-1',
    patientType: 'student',
    name: 'Example Student',
    allergies: null,
    allergiesStatus: 'none_reported',
    g6pdDeficiency: false,
    guardianHealthRecord: { allergies: null, allergiesStatus: 'none_reported' },
  });
});

test('nurse bootstrap reads all permitted groups once and preserves authoritative hydration and visit sanitization', async () => {
  const fullProfile = {
    name: 'Example Student',
    allergies: 'Peanuts',
    allergiesStatus: 'reported',
    guardianHealthRecord: { allergies: 'Peanuts', allergiesStatus: 'reported' },
    futureClinicalField: { value: 'preserved' },
  };
  const calls = [];
  const queryFn = async (sql, params = []) => {
    calls.push({ sql, params });
    return clinicReadResult({
      students: [{ id: 'student-1', patient_type: 'student', data: fullProfile }],
      visits: [{ data: { id: 'visit-1', _requestFingerprint: 'internal', chiefComplaint: 'Headache' } }],
      appointments: [{
        id: 'appointment-1', patient_id: 'student-1', status: 'Scheduled',
        starts_at: '2026-09-24T01:00:00+00:00', created_at: '2026-09-23T02:00:00+00:00', updated_at: '2026-09-23T02:10:00+00:00',
        data: { patientId: 'wrong-student', startsAt: 'legacy-time', status: 'Requested', reason: 'Follow-up' },
      }],
      inventory: [{ id: 'medicine-1', quantity: 3, data: { name: 'Bandages', quantity: 99, archived: true } }],
    });
  };

  const data = await loadClinicData({ id: 'nurse-1', role: 'school_nurse' }, { queryFn });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, []);
  for (const table of ['patients', 'visits', 'appointments', 'inventory_items', 'dispense_logs', 'stock_adjustments']) {
    assert.match(calls[0].sql, new RegExp(`FROM ${table}\\b`));
  }
  assert.deepEqual(data.students[0], { ...fullProfile, id: 'student-1', patientType: 'student' });
  assert.deepEqual(data.visits, [{ id: 'visit-1', chiefComplaint: 'Headache' }]);
  assert.deepEqual(data.appointments, [{
    patientId: 'student-1', startsAt: '2026-09-24T01:00:00.000Z', status: 'Scheduled',
    createdAt: '2026-09-23T02:00:00.000Z', updatedAt: '2026-09-23T02:10:00.000Z',
    id: 'appointment-1', reason: 'Follow-up',
  }]);
  assert.deepEqual(data.inventory, [{ id: 'medicine-1', quantity: 3, name: 'Bandages', archived: true }]);
});

test('administrator bootstrap omits restricted groups unless clinical access is explicitly requested', async () => {
  const calls = [];
  const queryFn = async (sql, params = []) => {
    calls.push({ sql, params });
    return clinicReadResult();
  };

  const defaultData = await loadClinicData({ id: 'admin-1', role: 'system_administrator' }, { queryFn });
  assert.equal(calls.length, 1);
  assert.doesNotMatch(calls[0].sql, /FROM (visits|appointments|inventory_items|dispense_logs|stock_adjustments)\b/);
  assert.deepEqual(defaultData.visits, []);
  assert.deepEqual(defaultData.appointments, []);
  assert.deepEqual(defaultData.inventory, []);
  assert.deepEqual(defaultData.dispenseLogs, []);
  assert.deepEqual(defaultData.stockAdjustments, []);

  calls.length = 0;
  await loadClinicData({ id: 'admin-1', role: 'system_administrator' }, { queryFn, includeClinical: true });
  assert.equal(calls.length, 1);
  for (const table of ['visits', 'appointments', 'inventory_items', 'dispense_logs', 'stock_adjustments']) {
    assert.match(calls[0].sql, new RegExp(`FROM ${table}\\b`));
  }
});

test('guardian bootstrap handles no linked students with one parameterized empty scope', async () => {
  const calls = [];
  const queryFn = async (sql, params = []) => {
    calls.push({ sql, params });
    if (/FROM guardian_patient_links/.test(sql)) return { rows: [] };
    return clinicReadResult();
  };

  const data = await loadClinicData({ id: 'guardian-1', role: 'guardian' }, { queryFn });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].params[0], []);
  assert.match(calls[1].sql, /patients\.id=ANY\(\$1::text\[\]\)/);
  assert.match(calls[1].sql, /FROM visits WHERE patient_id=ANY\(\$1::text\[\]\)/);
  assert.deepEqual(data.students, []);
  assert.deepEqual(data.visits, []);
  assert.deepEqual(data.appointments, []);
  assert.deepEqual(data.inventory, []);
});

test('nurse dashboard summary returns bounded rows and preserves appointment counts and Manila times', async () => {
  const now = new Date('2026-10-16T02:00:00.000Z');
  let queryArgs;
  const queryFn = async (...args) => {
    queryArgs = args;
    return { rows: [{
      settings: { schoolYear: '2026–2027', nurseName: 'Nurse Maya' },
      appointment_request_count: 2,
      upcoming_appointment_count: 4,
      scheduled_appointments: [
        { id: 'today-persisted', patient_id: 'student-1', starts_at: '2026-10-16T03:00:00.000Z', status: 'Scheduled', patient_name: 'Ari Santos', reason: 'Follow-up' },
        { id: 'today-legacy', patient_id: 'student-2', starts_at: null, date: '2026-10-16', time: '12:30', status: 'Scheduled', patient_name: 'Bea Cruz', reason: 'Check-in' },
        { id: 'past-legacy', patient_id: 'student-3', starts_at: null, date: '2026-10-15', time: '10:00', status: 'Scheduled', patient_name: 'Cal Tan' },
      ],
      recent_visits: [{
        id: 'visit-1', patient_id: 'student-1', created_at: '2026-10-16T01:00:00.000Z',
        date: '2026-10-16', time: '09:00 AM', chief_complaint: 'Headache', type: 'Illness',
        disposition: 'Returned to class', patient_name: 'Ari Santos',
      }],
      inventory_alerts: [{ id: 'stock-1', name: 'Bandages', quantity: 2, unit: 'pieces', reorderLevel: 5 }],
    }] };
  };

  const data = await loadNurseDashboardData({ queryFn, now });

  assert.equal(queryArgs.length, 2);
  assert.deepEqual(queryArgs[1], [now, new Date('2026-10-16T16:00:00.000Z'), '2026-10-16', '10:00:00.000']);
  assert.match(queryArgs[0], /COUNT\(\*\)::int FROM appointments/);
  assert.match(queryArgs[0], /data->>'date' > \$3/);
  assert.match(queryArgs[0], /data->>'date'=\$3/);
  assert.match(queryArgs[0], /ORDER BY candidates\.sort_time, candidates\.created_at\s+LIMIT 4/);
  assert.match(queryArgs[0], /LIMIT 4/);
  assert.match(queryArgs[0], /LIMIT 3/);
  assert.deepEqual(data.settings, { schoolYear: '2026–2027', nurseName: 'Nurse Maya' });
  assert.equal(data.dashboardSummary.appointmentRequestCount, 2);
  assert.equal(data.dashboardSummary.upcomingAppointmentCount, 4, 'the SQL count includes persisted and legacy scheduled appointments');
  assert.deepEqual(data.dashboardSummary.todayAppointments.map(({ appointment }) => appointment.id), ['today-persisted', 'today-legacy']);
  assert.deepEqual(data.dashboardSummary.recentVisits.map((visit) => visit.id), ['visit-1']);
  assert.deepEqual(data.dashboardSummary.inventoryAlerts.map((item) => item.id), ['stock-1']);
  assert.deepEqual(data.students, [
    { id: 'student-1', name: 'Ari Santos' },
    { id: 'student-2', name: 'Bea Cruz' },
  ]);
});

test('patient directory clamps pages, reads current-page visits, and uses one read-only snapshot', async () => {
  const calls = [];
  const queryFn = async (sql, params) => {
    calls.push({ sql, params });
    if (/^SET TRANSACTION/.test(sql)) return { rows: [] };
    if (/FROM visits/.test(sql)) return { rows: [] };
    return { rows: [{
      filtered_total: 26, page_no: 2, page_count: 2, roster_total: 99, schema_version: 12,
      settings: { schoolName: 'Synthetic clinic' },
      patients: [{ id: 'student-26', patient_type: 'student', data: { name: 'Student 26', gradeLevel: 'Grade 2' }, latestVisit: null }],
      grades: ['Kindergarten', 'Grade 1', 'Kinder 1'], sections: ['A'],
    }] };
  };
  let transactionInvocations = 0;
  const page = await loadPatientDirectory({ page: '9', pageSize: '25' }, {
    queryFn,
    transactionFn: async (work) => {
      transactionInvocations += 1;
      return work({ query: queryFn });
    },
  });
  assert.equal(transactionInvocations, 1);
  assert.equal(calls.length, 3, 'One SET, one directory query, and one narrow visit query are issued in the same transaction.');
  assert.match(calls[0].sql, /^SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY/);
  assert.deepEqual(calls[1].params, [null, null, null, '', 25, 9]);
  assert.match(calls[2].sql, /FROM visits/);
  assert.deepEqual(calls[2].params, [['student-26']]);
  assert.equal(page.page, 2);
  assert.equal(page.pageCount, 2);
  assert.equal(page.total, 26);
  assert.equal(page.patients[0].id, 'student-26');
});

test('patient export projects only the current CSV fields and includes the created_at sort column', async () => {
  let sqlSeen = '';
  const exported = await loadPatientDirectoryExport({ queryFn: async (sql) => {
    sqlSeen = sql;
    return { rows: [{ students: [{ id: 's1', patient_type: 'student', data: { name: 'Synthetic', studentId: 'ID-1' } }], visits: [{ patientId: 's1', studentId: 'ID-1', chiefComplaint: 'Cough' }] }] };
  } });
  assert.match(sqlSeen, /SELECT id,patient_type,data,created_at FROM patients/);
  assert.match(sqlSeen, /ORDER BY p\.created_at/);
  assert.match(sqlSeen, /FROM visits v JOIN patients_in_scope p ON p\.id=v\.patient_id/);
  assert.match(sqlSeen, /COALESCE\(NULLIF\(v\.data->>'studentId',''\),v\.data->>'patientId',''\)/);
  assert.doesNotMatch(sqlSeen, /requestFingerprint|guardianHealthRecord|profileImage/);
  assert.equal(exported.students[0].name, 'Synthetic');
  assert.equal(exported.visits[0].studentId, 'ID-1');
});

test('patient picker returns a bounded public projection and escapes literal LIKE wildcards', async () => {
  let queryArgs;
  const options = await loadPatientPicker({ q: 'A%_\\B', type: 'student', patientId: 'selected-id' }, {
    queryFn: async (...args) => {
      queryArgs = args;
      return { rows: [{ id: 'selected-id', patient_type: 'student', data: { name: 'Selected', studentId: 'S-1' } }] };
    },
  });
  assert.deepEqual(queryArgs[1], ['student', 'selected-id', 'A\\%\\_\\\\B']);
  assert.match(queryArgs[0], /LIMIT 30/);
  assert.match(queryArgs[0], /ESCAPE E'\\\\'/);
  assert.deepEqual(options, [{ id: 'selected-id', patientType: 'student', name: 'Selected', studentId: 'S-1' }]);
});

test('clinic report bootstrap bounds event reads and fetches only linked patient grade/type projections', async () => {
  const calls = [];
  const queryFn = async (sql, params = []) => {
    calls.push({ sql, params });
    if (/FROM visits/.test(sql)) return { rows: [{ data: { patientId: 'patient-1', date: '2026-10-15', chiefComplaint: 'Headache' } }] };
    if (/FROM patients/.test(sql)) return { rows: [{ id: 'patient-1', patient_type: 'faculty', data: { gradeLevel: null } }] };
    if (/FROM appointments/.test(sql)) return { rows: [{ data: { date: '2026-10-15' } }] };
    if (/FROM dispense_logs/.test(sql)) return { rows: [{ data: { date: '2026-10-15', quantity: 2, itemType: 'supply' } }] };
    if (/FROM clinic_settings/.test(sql)) return { rows: [{ settings: { schoolName: 'Synthetic clinic' } }] };
    throw new Error(`Unexpected query: ${sql}`);
  };
  const reportData = await loadPatientClinicReportData('2026-10-15', '2026-10-15', { queryFn });
  assert.equal(calls.length, 5);
  assert.deepEqual(calls[0].params, ['2026-10-14', '2026-10-16']);
  assert.deepEqual(calls[1].params, [['patient-1']]);
  assert.match(calls[0].sql, /left\(COALESCE\(NULLIF\(data->>'date'/);
  assert.match(calls[0].sql, /'riskAssessment',jsonb_build_object\('category'/);
  assert.doesNotMatch(calls[0].sql, /requestFingerprint/);
  assert.deepEqual(reportData.students, [{ id: 'patient-1', patientType: 'faculty', gradeLevel: null }]);
  assert.equal(reportData.settings.schoolName, 'Synthetic clinic');
  assert.equal(reportData.visits[0].chiefComplaint, 'Headache');
  assert.equal(reportData.dispenseLogs[0].quantity, 2);
});
