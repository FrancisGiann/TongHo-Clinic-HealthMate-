import crypto from 'node:crypto';
import { query, transaction } from './db.js';
import { publicVisitRecord } from './domain/visitRequests.js';

const collectionMap = {
  visits: { table: 'visits', patient: true },
  appointments: { table: 'appointments', patient: true },
  inventory: { table: 'inventory_items', staffOnly: true },
  dispenseLogs: { table: 'dispense_logs', staffOnly: true },
  stockAdjustments: { table: 'stock_adjustments', staffOnly: true },
};

const staffRoles = new Set(['school_nurse', 'system_administrator']);
const clinicalCollections = new Set(['visits', 'appointments', 'dispenseLogs', 'stockAdjustments']);
const adminRestrictedCollections = new Set([...clinicalCollections, 'inventory']);
const snapshotWritableCollections = [];

function recordId(record) {
  const value = record?.id;
  if (value === undefined || value === null || value === '') {
    const generated = crypto.randomUUID();
    record.id = generated;
    return generated;
  }
  return String(value);
}

function patientId(record) {
  return String(record?.patientId ?? record?.studentId ?? record?.student?.id ?? '');
}

function timestampValue(value) {
  return value instanceof Date ? value.toISOString() : value || null;
}

export function studentRecordForUser(record, user) {
  if (user.role === 'school_nurse') return { ...record, id: record.id };
  if (user.role === 'guardian') {
    const fields = [
      'patientType', 'studentId', 'name', 'gradeLevel', 'section', 'birthDate', 'gender',
      'motherName', 'fatherName', 'guardianName', 'guardianPhone', 'guardianRelation',
      'bloodType', 'allergies', 'allergiesStatus', 'conditions', 'conditionsStatus', 'medications', 'medicationsStatus', 'pastIllness', 'presentIllness',
      'hospitalizationHistory', 'hospitalizationDetails', 'g6pdDeficiency', 'medicationAtHome',
      'takingRegularMedication', 'regularMedicationName', 'onTherapy', 'lastTreatmentDate',
      'therapistName', 'therapyInterventions', 'hasConcerns', 'concernsDetails', 'documentsSubmitted', 'documentsReceived', 'guardianHealthRecord',
    ];
    return { id: record.id, ...Object.fromEntries(fields.filter((field) => record[field] !== undefined).map((field) => [field, record[field]])) };
  }
  const fields = ['patientType', 'studentId', 'facultyId', 'name', 'gradeLevel', 'section', 'adviser', 'department', 'position', 'email', 'contactNumber', 'birthDate', 'gender', 'guardianName', 'guardianPhone', 'guardianRelation'];
  return { id: record.id, ...Object.fromEntries(fields.filter((field) => record[field] !== undefined).map((field) => [field, record[field]])) };
}

export function hydrateAuthoritativeRecord(key, row) {
  const record = row.data || {};
  if (key === 'appointments') {
    return {
      ...record,
      id: row.id,
      patientId: row.patient_id,
      startsAt: timestampValue(row.starts_at),
      status: row.status,
      createdAt: timestampValue(row.created_at),
      updatedAt: timestampValue(row.updated_at),
    };
  }
  if (key === 'inventory') {
    return { ...record, id: row.id, quantity: row.quantity };
  }
  return record;
}

async function accessiblePatientIds(user, client = { query }) {
  if (staffRoles.has(user.role)) return null;
  if (user.role !== 'guardian') return [];
  const result = await client.query(
    `SELECT l.patient_id AS id FROM guardian_patient_links l JOIN patients p ON p.id=l.patient_id
     WHERE l.guardian_user_id=$1 AND p.patient_type='student'`,
    [user.id],
  );
  return result.rows.map((row) => String(row.id));
}

export async function loadClinicData(user, { includeClinical = false } = {}) {
  const settingsResult = await query('SELECT data,version FROM clinic_settings WHERE id=1');
  const ids = await accessiblePatientIds(user);
  const staff = staffRoles.has(user.role);
  const patientResult = ids === null
    ? await query('SELECT id,patient_type,data FROM patients ORDER BY created_at')
    : await query('SELECT id,patient_type,data FROM patients WHERE id=ANY($1::text[]) ORDER BY created_at', [ids]);
  const data = {
    schemaVersion: settingsResult.rows[0]?.version || 1,
    settings: settingsResult.rows[0]?.data || {},
    students: patientResult.rows.map((row) => studentRecordForUser({ ...row.data, id: row.id, patientType: row.patient_type }, user)),
  };

  for (const [key, config] of Object.entries(collectionMap)) {
    if (user.role === 'system_administrator' && adminRestrictedCollections.has(key) && !includeClinical) {
      data[key] = [];
      continue;
    }
    if (config.staffOnly && !staff) {
      data[key] = [];
      continue;
    }
    if (key === 'appointments') {
      const scope = ids !== null ? ' WHERE patient_id=ANY($1::text[])' : '';
      const result = await query(`SELECT id,patient_id,status,starts_at,created_at,updated_at,data FROM appointments${scope} ORDER BY created_at`, ids !== null ? [ids] : []);
      data[key] = result.rows.map((row) => hydrateAuthoritativeRecord(key, row));
      continue;
    }
    if (key === 'inventory') {
      const result = await query('SELECT id,quantity,data FROM inventory_items ORDER BY created_at');
      data[key] = result.rows.map((row) => hydrateAuthoritativeRecord(key, row));
      continue;
    }
    const result = config.patient && ids !== null
      ? await query(`SELECT data FROM ${config.table} WHERE patient_id=ANY($1::text[]) ORDER BY created_at`, [ids])
      : await query(`SELECT data FROM ${config.table} ORDER BY created_at`);
    data[key] = result.rows.map((row) => key === 'visits' ? publicVisitRecord(row.data) : row.data);
  }
  return data;
}

export function validateClinicDataPayload(nextData, expectedVersion, { internal = false } = {}) {
  if (!nextData || typeof nextData !== 'object' || !Array.isArray(nextData.students) || !nextData.settings || typeof nextData.settings !== 'object') {
    return { valid: false, message: 'Clinic data must include settings and a student collection.' };
  }
  if (!Number.isInteger(Number(expectedVersion)) || Number(expectedVersion) < 1) {
    return { valid: false, message: 'A current clinic data version is required.' };
  }
  const requiredCollections = internal ? Object.keys(collectionMap) : snapshotWritableCollections;
  const missing = requiredCollections.filter((key) => !Array.isArray(nextData[key]));
  if (missing.length) return { valid: false, message: `Clinic data is missing required collections: ${missing.join(', ')}.` };
  return { valid: true };
}

export async function advanceClinicDataVersion(client) {
  const result = await client.query(
    'UPDATE clinic_settings SET version=version+1,updated_at=NOW() WHERE id=1 RETURNING version',
  );
  if (!result.rowCount) throw new Error('Clinic data version row is missing.');
  return result.rows[0].version;
}

export async function validateVersionAfterAdvance(client, expectedVersion) {
  const expected = Number(expectedVersion);
  if (!Number.isInteger(expected) || expected < 1) {
    const error = new Error('A current clinic data version is required. Reload and try again.');
    error.status = 400;
    error.code = 'VERSION_REQUIRED';
    throw error;
  }
  const result = await client.query('SELECT version FROM clinic_settings WHERE id=1');
  const currentVersion = Number(result.rows[0]?.version || 1);
  if (currentVersion !== expected + 1) {
    const error = new Error('Clinic data changed in another session. Reload and try again.');
    error.status = 409;
    error.code = 'VERSION_CONFLICT';
    throw error;
  }
  return currentVersion;
}

export function clinicDataTransaction(work) {
  return transaction(async (client) => {
    // Acquire the snapshot lock before any table or advisory locks; rollback also rolls back this version bump.
    await advanceClinicDataVersion(client);
    return work(client);
  });
}

function validateSaveClinicData(nextData, user, expectedVersion, internal) {
  if (!internal && user.role !== 'school_nurse') {
    const error = new Error('Only school nurses can update clinical data.');
    error.status = 403;
    throw error;
  }
  const validation = validateClinicDataPayload(nextData, expectedVersion, { internal });
  if (!validation.valid) {
    const error = new Error(validation.message);
    error.status = 400;
    throw error;
  }
}

export async function syncPatients(client, records) {
  for (const record of records) {
    const id = recordId(record);
    const current = await client.query('SELECT data FROM patients WHERE id=$1 FOR UPDATE', [id]);
    const canonicalGuardianAnswers = current.rows[0]?.data?.guardianHealthRecord;
    const storedRecord = canonicalGuardianAnswers && typeof canonicalGuardianAnswers === 'object'
      ? { ...record, ...canonicalGuardianAnswers, guardianHealthRecord: canonicalGuardianAnswers }
      : record;
    await client.query(
      `INSERT INTO patients(id,patient_type,data) VALUES($1,$2,$3::jsonb - 'consentStatus' - 'consentDueDate')
       ON CONFLICT(id) DO UPDATE SET patient_type=EXCLUDED.patient_type,
         data=(EXCLUDED.data - 'consentStatus' - 'consentDueDate') || jsonb_strip_nulls(jsonb_build_object(
           'consentStatus',patients.data->'consentStatus',
           'consentDueDate',patients.data->'consentDueDate'
         )),updated_at=NOW()`,
      [id, record.patientType === 'faculty' ? 'faculty' : 'student', JSON.stringify(storedRecord)],
    );
  }
}

export async function syncCollection(client, key, records, actorId) {
  if (!collectionMap[key]) return;
  for (const record of records) {
    const id = recordId(record);
    const json = JSON.stringify(record);
    if (key === 'visits') {
      const table = collectionMap[key].table;
      const pid = patientId(record);
      if (!pid) throw new Error(`${key} record ${id} is missing a patient id.`);
      await client.query(
        `INSERT INTO ${table}(id,patient_id,data,created_by) VALUES($1,$2,$3::jsonb - '_requestFingerprint',$4)
         ON CONFLICT(id) DO UPDATE SET patient_id=EXCLUDED.patient_id,
           data=(EXCLUDED.data - '_requestFingerprint') || jsonb_strip_nulls(jsonb_build_object('_requestFingerprint',visits.data->'_requestFingerprint')),
           updated_at=NOW()`,
        [id, pid, json, actorId],
      );
    } else if (key === 'appointments') {
      const pid = patientId(record);
      if (!pid) throw new Error(`appointments record ${id} is missing a patient id.`);
      const startsAt = record.startsAt || (record.date ? `${record.date} ${record.time || '00:00'}` : null);
      await client.query(
        `INSERT INTO appointments(id,patient_id,starts_at,status,data,created_by) VALUES($1,$2,$3,$4,$5::jsonb,$6)
         ON CONFLICT(id) DO UPDATE SET patient_id=EXCLUDED.patient_id,starts_at=EXCLUDED.starts_at,status=EXCLUDED.status,data=EXCLUDED.data,updated_at=NOW()`,
        [id, pid, startsAt || null, record.status || 'Requested', json, actorId],
      );
    } else if (key === 'inventory') {
      const quantity = Number(record.quantity);
      if (!Number.isInteger(quantity) || quantity < 0) throw new Error(`Inventory item ${id} has an invalid quantity.`);
      await client.query(
        `INSERT INTO inventory_items(id,quantity,data) VALUES($1,$2,$3::jsonb)
         ON CONFLICT(id) DO UPDATE SET quantity=EXCLUDED.quantity,data=EXCLUDED.data,updated_at=NOW()`,
        [id, quantity, json],
      );
    } else if (key === 'dispenseLogs') {
      await client.query(
        `INSERT INTO dispense_logs(id,visit_id,inventory_item_id,quantity,data,created_by) VALUES($1,$2,$3,$4,$5::jsonb,$6)
         ON CONFLICT(id) DO UPDATE SET visit_id=EXCLUDED.visit_id,inventory_item_id=EXCLUDED.inventory_item_id,quantity=EXCLUDED.quantity,data=EXCLUDED.data`,
        [id, record.visitId ? String(record.visitId) : null, record.medicineId ? String(record.medicineId) : null, Number(record.quantity || 1), json, actorId],
      );
    } else if (key === 'stockAdjustments') {
      await client.query(
        `INSERT INTO stock_adjustments(id,inventory_item_id,quantity,data,created_by) VALUES($1,$2,$3,$4::jsonb,$5)
         ON CONFLICT(id) DO UPDATE SET inventory_item_id=EXCLUDED.inventory_item_id,quantity=EXCLUDED.quantity,data=EXCLUDED.data`,
        [id, record.medicineId ? String(record.medicineId) : null, Number(record.quantity || 0), json, actorId],
      );
    }
  }
}

export async function saveClinicDataInTransaction(client, nextData, user, expectedVersion, { internal = false } = {}) {
  validateSaveClinicData(nextData, user, expectedVersion, internal);
  const locked = await client.query('SELECT data, version FROM clinic_settings WHERE id=1 FOR UPDATE');
  const currentVersion = locked.rows[0]?.version || 1;
  const currentSettings = locked.rows[0]?.data || {};
  if (expectedVersion && Number(expectedVersion) !== currentVersion) {
    const error = new Error('Clinic data changed in another session. Reload and try again.');
    error.status = 409;
    error.code = 'VERSION_CONFLICT';
    throw error;
  }
  await syncPatients(client, nextData.students);
  const writableCollections = internal ? Object.keys(collectionMap) : snapshotWritableCollections;
  for (const key of writableCollections) await syncCollection(client, key, nextData[key], user.id);

  const settingsToSave = currentSettings;

  const result = await client.query(
    'UPDATE clinic_settings SET data=$1::jsonb,version=version+1,updated_at=NOW() WHERE id=1 RETURNING version',
    [JSON.stringify(settingsToSave)],
  );
  return result.rows[0].version;
}

export async function saveClinicData(nextData, user, expectedVersion, options = {}) {
  validateSaveClinicData(nextData, user, expectedVersion, options.internal || false);
  return transaction((client) => saveClinicDataInTransaction(client, nextData, user, expectedVersion, options));
}

export async function linkUserToPatient(userId, patientId, role, relationship = 'Guardian') {
  if (role === 'guardian') {
    return query(
      `INSERT INTO guardian_patient_links(guardian_user_id,patient_id,relationship) VALUES($1,$2,$3)
       ON CONFLICT(guardian_user_id,patient_id) DO UPDATE SET relationship=EXCLUDED.relationship`,
      [userId, String(patientId), relationship],
    );
  }
}

export async function listUsers() {
  const result = await query(
    `SELECT id,username,email,name,role,status,school_id,prc_license_number,prc_license_verified_at,prc_license_verified_by,contact_number,school_name,last_login_at,created_at,
            EXISTS(SELECT 1 FROM invitations i WHERE LOWER(i.email)=LOWER(users.email) AND i.accepted_at IS NOT NULL) AS invitation_accepted
     FROM users ORDER BY created_at DESC`,
  );
  return result.rows;
}
