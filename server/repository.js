import crypto from 'node:crypto';
import { query, transaction } from './db.js';

const collectionMap = {
  visits: { table: 'visits', patient: true },
  screenings: { table: 'screenings', patient: true },
  immunizations: { table: 'immunizations', patient: true },
  incidents: { table: 'incidents', patient: true },
  appointments: { table: 'appointments', patient: true },
  queue: { table: 'queue_entries', patient: true },
  inventory: { table: 'inventory_items', staffOnly: true },
  dispenseLogs: { table: 'dispense_logs', staffOnly: true },
  stockAdjustments: { table: 'stock_adjustments', staffOnly: true },
};

const staffRoles = new Set(['school_nurse', 'system_administrator']);

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

async function accessiblePatientIds(user, client = { query }) {
  if (staffRoles.has(user.role)) return null;
  if (user.role === 'student') {
    const result = await client.query('SELECT id FROM patients WHERE user_id=$1', [user.id]);
    return result.rows.map((row) => String(row.id));
  }
  const result = await client.query('SELECT patient_id AS id FROM guardian_patient_links WHERE guardian_user_id=$1', [user.id]);
  return result.rows.map((row) => String(row.id));
}

export async function loadClinicData(user) {
  const settingsResult = await query('SELECT data,version FROM clinic_settings WHERE id=1');
  const ids = await accessiblePatientIds(user);
  const staff = staffRoles.has(user.role);
  const patientResult = ids === null
    ? await query('SELECT data FROM patients ORDER BY created_at')
    : await query('SELECT data FROM patients WHERE id=ANY($1::text[]) ORDER BY created_at', [ids]);
  const data = {
    schemaVersion: settingsResult.rows[0]?.version || 1,
    settings: settingsResult.rows[0]?.data || {},
    students: patientResult.rows.map((row) => row.data),
  };

  for (const [key, config] of Object.entries(collectionMap)) {
    if (config.staffOnly && !staff) {
      data[key] = [];
      continue;
    }
    const result = config.patient && ids !== null
      ? await query(`SELECT data FROM ${config.table} WHERE patient_id=ANY($1::text[]) ORDER BY created_at`, [ids])
      : await query(`SELECT data FROM ${config.table} ORDER BY created_at`);
    data[key] = result.rows.map((row) => row.data);
  }
  return data;
}

async function removeMissing(client, table, ids) {
  if (!ids.length) return client.query(`DELETE FROM ${table}`);
  return client.query(`DELETE FROM ${table} WHERE NOT (id=ANY($1::text[]))`, [ids]);
}

async function syncPatients(client, records) {
  const ids = [];
  for (const record of records) {
    const id = recordId(record);
    ids.push(id);
    await client.query(
      `INSERT INTO patients(id,patient_type,data) VALUES($1,$2,$3::jsonb)
       ON CONFLICT(id) DO UPDATE SET patient_type=EXCLUDED.patient_type,data=EXCLUDED.data,updated_at=NOW()`,
      [id, record.patientType === 'faculty' ? 'faculty' : 'student', JSON.stringify(record)],
    );
  }
  await removeMissing(client, 'patients', ids);
}

async function syncCollection(client, key, records, actorId) {
  const { table } = collectionMap[key];
  const ids = [];
  for (const record of records) {
    const id = recordId(record);
    ids.push(id);
    const json = JSON.stringify(record);
    if (['visits', 'screenings', 'immunizations', 'incidents'].includes(key)) {
      const pid = patientId(record);
      if (!pid) throw new Error(`${key} record ${id} is missing a patient id.`);
      await client.query(
        `INSERT INTO ${table}(id,patient_id,data,created_by) VALUES($1,$2,$3::jsonb,$4)
         ON CONFLICT(id) DO UPDATE SET patient_id=EXCLUDED.patient_id,data=EXCLUDED.data,updated_at=NOW()`,
        [id, pid, json, actorId],
      );
    } else if (key === 'appointments') {
      const pid = patientId(record);
      const startsAt = record.startsAt || (record.date ? `${record.date} ${record.time || '00:00'}` : null);
      await client.query(
        `INSERT INTO appointments(id,patient_id,starts_at,status,data,created_by) VALUES($1,$2,$3,$4,$5::jsonb,$6)
         ON CONFLICT(id) DO UPDATE SET patient_id=EXCLUDED.patient_id,starts_at=EXCLUDED.starts_at,status=EXCLUDED.status,data=EXCLUDED.data,updated_at=NOW()`,
        [id, pid, startsAt || null, record.status || 'Requested', json, actorId],
      );
    } else if (key === 'queue') {
      const pid = patientId(record);
      await client.query(
        `INSERT INTO queue_entries(id,patient_id,status,priority,data) VALUES($1,$2,$3,$4,$5::jsonb)
         ON CONFLICT(id) DO UPDATE SET patient_id=EXCLUDED.patient_id,status=EXCLUDED.status,priority=EXCLUDED.priority,data=EXCLUDED.data,updated_at=NOW()`,
        [id, pid, record.status || 'Waiting', Number(record.priority || (record.urgent ? 10 : 0)), json],
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
  await removeMissing(client, table, ids);
}

export async function saveClinicData(nextData, user, expectedVersion) {
  if (!staffRoles.has(user.role)) {
    const error = new Error('Only clinic staff can update clinical data.');
    error.status = 403;
    throw error;
  }
  if (!nextData || typeof nextData !== 'object' || !Array.isArray(nextData.students)) {
    const error = new Error('Invalid clinic data payload.');
    error.status = 400;
    throw error;
  }
  return transaction(async (client) => {
    const locked = await client.query('SELECT version FROM clinic_settings WHERE id=1 FOR UPDATE');
    const currentVersion = locked.rows[0]?.version || 1;
    if (expectedVersion && Number(expectedVersion) !== currentVersion) {
      const error = new Error('Clinic data changed in another session. Reload and try again.');
      error.status = 409;
      error.code = 'VERSION_CONFLICT';
      throw error;
    }
    await syncPatients(client, nextData.students);
    for (const key of Object.keys(collectionMap)) await syncCollection(client, key, Array.isArray(nextData[key]) ? nextData[key] : [], user.id);
    const result = await client.query(
      'UPDATE clinic_settings SET data=$1::jsonb,version=version+1,updated_at=NOW() WHERE id=1 RETURNING version',
      [JSON.stringify(nextData.settings || {})],
    );
    return result.rows[0].version;
  });
}

export async function linkUserToPatient(userId, patientId, role, relationship = 'Guardian') {
  if (role === 'student') return query('UPDATE patients SET user_id=$1,updated_at=NOW() WHERE id=$2', [userId, String(patientId)]);
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
    `SELECT id,username,email,name,role,status,mfa_enabled,school_id,prc_license_number,contact_number,school_name,last_login_at,created_at
     FROM users ORDER BY created_at DESC`,
  );
  return result.rows;
}
