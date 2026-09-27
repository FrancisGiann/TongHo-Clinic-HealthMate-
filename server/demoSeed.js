import { DEMO_DATASET_KEY } from '../src/db/demoData.js';

const COLLECTIONS = [
  ['students', 'patients'],
  ['visits', 'visits'],
  ['appointments', 'appointments'],
  ['inventory', 'inventory_items'],
  ['dispenseLogs', 'dispense_logs'],
  ['stockAdjustments', 'stock_adjustments'],
];

function parseData(value) {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value && typeof value === 'object' ? value : null;
}

function recordId(record, collection) {
  if (typeof record?.id !== 'string' || !record.id.startsWith('demo-')) {
    throw new Error(`Demo ${collection} record is missing a namespaced ID.`);
  }
  return record.id;
}

function validateCollections(data) {
  if (!data || typeof data !== 'object') throw new TypeError('Demo data must be an object.');
  for (const [key] of COLLECTIONS) {
    if (!Array.isArray(data[key])) throw new TypeError(`Demo data is missing the ${key} collection.`);
    const ids = new Set();
    for (const record of data[key]) {
      const id = recordId(record, key);
      if (ids.has(id)) throw new Error(`Demo ${key} contains duplicate ID ${id}.`);
      ids.add(id);
    }
  }
}

async function preflightIds(client, data) {
  const existingByCollection = new Map();
  for (const [key, table] of COLLECTIONS) {
    const records = data[key];
    if (!records.length) {
      existingByCollection.set(key, new Map());
      continue;
    }
    const result = await client.query(`SELECT id, data FROM ${table} WHERE id=ANY($1::text[])`, [records.map((record) => record.id)]);
    const existing = new Map(result.rows.map((row) => [String(row.id), row]));
    for (const [id, row] of existing) {
      if (parseData(row.data)?.demoDataset !== DEMO_DATASET_KEY) {
        throw new Error(`Refusing to seed demo data: ${table} already contains an unowned record with ID ${id}. No data was changed.`);
      }
    }
    existingByCollection.set(key, existing);
  }
  return existingByCollection;
}

function assertReferences(data) {
  const patientIds = new Set(data.students.map((record) => record.id));
  const visitIds = new Set(data.visits.map((record) => record.id));
  const inventoryIds = new Set(data.inventory.map((record) => record.id));
  for (const visit of data.visits) {
    if (!patientIds.has(String(visit.patientId ?? visit.studentId ?? ''))) throw new Error(`Demo visit ${visit.id} refers to an unknown patient.`);
  }
  for (const appointment of data.appointments) {
    if (!patientIds.has(String(appointment.patientId ?? appointment.studentId ?? ''))) throw new Error(`Demo appointment ${appointment.id} refers to an unknown patient.`);
  }
  for (const log of data.dispenseLogs) {
    if (!visitIds.has(String(log.visitId ?? '')) || !inventoryIds.has(String(log.medicineId ?? log.inventoryItemId ?? ''))) {
      throw new Error(`Demo dispense log ${log.id} has a missing visit or inventory reference.`);
    }
    const quantity = Number(log.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) throw new Error(`Demo dispense log ${log.id} has an invalid quantity.`);
  }
  for (const adjustment of data.stockAdjustments) {
    if (adjustment.medicineId && !inventoryIds.has(String(adjustment.medicineId))) {
      throw new Error(`Demo stock adjustment ${adjustment.id} refers to an unknown inventory item.`);
    }
    if (!Number.isInteger(Number(adjustment.quantity))) throw new Error(`Demo stock adjustment ${adjustment.id} has an invalid quantity.`);
  }
}

async function insertMissing(client, key, table, records, existing, actorId) {
  let inserted = 0;
  for (const original of records) {
    if (existing.has(original.id)) continue;
    const record = { ...original, demoDataset: DEMO_DATASET_KEY };
    const json = JSON.stringify(record);
    if (key === 'students') {
      const patientType = record.patientType === 'faculty' ? 'faculty' : 'student';
      await client.query('INSERT INTO patients(id,patient_type,data) VALUES($1,$2,$3::jsonb)', [record.id, patientType, json]);
    } else if (key === 'visits') {
      const patientId = String(record.patientId ?? record.studentId);
      await client.query('INSERT INTO visits(id,patient_id,data,created_by) VALUES($1,$2,$3::jsonb,$4)', [record.id, patientId, json, actorId]);
    } else if (key === 'appointments') {
      const patientId = String(record.patientId ?? record.studentId);
      const startsAt = record.startsAt || (record.date ? `${record.date}T00:00:00+08:00` : null);
      await client.query('INSERT INTO appointments(id,patient_id,starts_at,status,data,created_by) VALUES($1,$2,$3,$4,$5::jsonb,$6)', [record.id, patientId, startsAt, record.status || 'Requested', json, actorId]);
    } else if (key === 'inventory') {
      const quantity = Number(record.quantity);
      if (!Number.isInteger(quantity) || quantity < 0) throw new Error(`Demo inventory item ${record.id} has an invalid quantity.`);
      await client.query('INSERT INTO inventory_items(id,quantity,data) VALUES($1,$2,$3::jsonb)', [record.id, quantity, json]);
    } else if (key === 'dispenseLogs') {
      await client.query('INSERT INTO dispense_logs(id,visit_id,inventory_item_id,quantity,data,created_by) VALUES($1,$2,$3,$4,$5::jsonb,$6)', [record.id, record.visitId, String(record.medicineId ?? record.inventoryItemId), Number(record.quantity), json, actorId]);
    } else if (key === 'stockAdjustments') {
      await client.query('INSERT INTO stock_adjustments(id,inventory_item_id,quantity,data,created_by) VALUES($1,$2,$3,$4::jsonb,$5)', [record.id, record.medicineId ? String(record.medicineId) : null, Number(record.quantity), json, actorId]);
    }
    inserted += 1;
  }
  return { inserted, alreadyPresent: existing.size };
}

/** Add demo rows without changing existing records. Call inside a database transaction. */
export async function addDemoData(client, data, actorId) {
  validateCollections(data);
  assertReferences(data);
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [DEMO_DATASET_KEY]);
  const settings = await client.query('SELECT version FROM clinic_settings WHERE id=1 FOR UPDATE');
  if (!settings.rows[0]) throw new Error('Clinic settings row is missing. Run database migrations before seeding demo data.');
  const existing = await preflightIds(client, data);
  const counts = {};
  for (const [key, table] of COLLECTIONS) {
    counts[key] = await insertMissing(client, key, table, data[key], existing.get(key), actorId);
  }
  if (Object.values(counts).some((count) => count.inserted > 0)) {
    const result = await client.query('UPDATE clinic_settings SET version=version+1,updated_at=NOW() WHERE id=1 RETURNING version');
    if (!result.rows[0]) throw new Error('Clinic settings version could not be advanced.');
  }
  return counts;
}
