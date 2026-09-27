import test from 'node:test';
import assert from 'node:assert/strict';
import { generateDemoData, DEMO_DATASET_KEY } from '../src/db/demoData.js';
import { validateInventoryItem } from './domain/inventory.js';
import { addDemoData } from './demoSeed.js';
import { assertDemoSeedAllowed } from './demoSeedSafety.js';

const REFERENCE_DATE = '2026-09-27';

function asDate(value) {
  return new Date(`${value}T12:00:00.000Z`);
}

function makeMemoryDatabase() {
  const tables = new Map(['patients', 'visits', 'appointments', 'inventory_items', 'dispense_logs', 'stock_adjustments']
    .map((name) => [name, new Map()]));
  const inserts = [];
  return {
    tables,
    inserts,
    version: 1,
    async query(sql, params = []) {
      if (sql.startsWith('SELECT pg_advisory_xact_lock')) return { rows: [] };
      if (sql.startsWith('SELECT version FROM clinic_settings')) return { rows: [{ version: this.version }] };
      if (sql.startsWith('UPDATE clinic_settings SET version=version+1')) {
        this.version += 1;
        return { rowCount: 1, rows: [{ version: this.version }] };
      }
      const select = /^SELECT id, data FROM (\w+) WHERE id=ANY/.exec(sql);
      if (select) {
        const table = tables.get(select[1]);
        return { rows: params[0].filter((id) => table.has(id)).map((id) => ({ id, data: table.get(id).data })) };
      }
      const insert = /^INSERT INTO (\w+)/.exec(sql);
      assert.ok(insert, `Unexpected SQL in demo seeder: ${sql}`);
      const table = tables.get(insert[1]);
      const id = String(params[0]);
      assert.ok(!table.has(id), `seed attempted to replace ${insert[1]} ${id}`);
      const dataIndex = insert[1] === 'appointments' || insert[1] === 'dispense_logs' ? 4
        : insert[1] === 'stock_adjustments' ? 3
          : 2;
      const data = JSON.parse(params[dataIndex]);
      if (insert[1] === 'visits') assert.ok(tables.get('patients').has(String(params[1])));
      if (insert[1] === 'appointments') assert.ok(tables.get('patients').has(String(params[1])));
      if (insert[1] === 'dispense_logs') {
        assert.ok(tables.get('visits').has(String(params[1])));
        assert.ok(tables.get('inventory_items').has(String(params[2])));
      }
      table.set(id, { data });
      inserts.push({ table: insert[1], id });
      return { rowCount: 1 };
    },
  };
}

test('demo fixture has useful clinic-sized volumes and is deterministic for a fixed date and seed', () => {
  const first = generateDemoData({ asOf: REFERENCE_DATE, seed: 42 });
  const second = generateDemoData({ asOf: REFERENCE_DATE, seed: 42 });
  assert.deepEqual(second, first);
  assert.equal(first.students.length, 210);
  assert.equal(first.students.filter((patient) => patient.patientType === 'student').length, 190);
  assert.equal(first.students.filter((patient) => patient.patientType === 'faculty').length, 20);
  assert.equal(first.visits.length, 480);
  assert.equal(first.appointments.length, 42);
  assert.equal(first.inventory.length, 34);
  assert.equal(first.dispenseLogs.length, 120);
  assert.equal(first.settings.demoNotice.includes('fictional'), true);
});

test('demo fixture uses namespaced unique IDs, valid references, and plausible dates and quantities', () => {
  const data = generateDemoData({ asOf: REFERENCE_DATE });
  const patients = new Map(data.students.map((record) => [record.id, record]));
  const visits = new Map(data.visits.map((record) => [record.id, record]));
  const inventory = new Map(data.inventory.map((record) => [record.id, record]));
  const uniqueIds = (records) => assert.equal(new Set(records.map(({ id }) => id)).size, records.length);
  uniqueIds(data.students);
  uniqueIds(data.visits);
  uniqueIds(data.appointments);
  uniqueIds(data.inventory);
  uniqueIds(data.dispenseLogs);
  for (const [key, records] of Object.entries({ ...data, settings: undefined })) {
    if (!Array.isArray(records)) continue;
    for (const record of records) {
      assert.ok(record.id.startsWith('demo-'), `${key} IDs must be namespaced`);
      assert.equal(record.demoDataset, DEMO_DATASET_KEY);
    }
  }

  const oldestVisitDate = asDate(REFERENCE_DATE);
  oldestVisitDate.setUTCDate(oldestVisitDate.getUTCDate() - 212);
  for (const visit of data.visits) {
    assert.ok(patients.has(visit.studentId), `visit ${visit.id} has a patient`);
    const date = asDate(visit.date);
    assert.ok(date >= oldestVisitDate && date <= asDate(REFERENCE_DATE));
    assert.ok(![0, 6].includes(date.getUTCDay()), 'school visits fall on weekdays');
    assert.ok(visit.chiefComplaint.length > 0 && visit.treatment.length > 0);
  }

  for (const appointment of data.appointments) {
    assert.ok(patients.has(appointment.studentId), `appointment ${appointment.id} has a patient`);
    assert.ok(['Completed', 'Cancelled', 'Scheduled', 'Requested'].includes(appointment.status));
    assert.ok(![0, 6].includes(asDate(appointment.date).getUTCDay()));
    assert.match(appointment.startsAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\+08:00$/);
  }

  for (const item of data.inventory) {
    assert.ok(Number.isInteger(item.quantity) && item.quantity >= 0);
    assert.ok(item.expiryDate > REFERENCE_DATE);
    assert.equal(validateInventoryItem(item, { create: true }).valid, true, item.name);
  }
  const dispensedByItem = new Map();
  for (const log of data.dispenseLogs) {
    assert.ok(visits.has(log.visitId), `dispense ${log.id} has a visit`);
    assert.ok(inventory.has(log.medicineId), `dispense ${log.id} has an inventory item`);
    assert.ok(Number.isInteger(log.quantity) && log.quantity > 0);
    dispensedByItem.set(log.medicineId, (dispensedByItem.get(log.medicineId) || 0) + log.quantity);
  }
  for (const item of data.inventory) {
    assert.equal(item.quantity + (dispensedByItem.get(item.id) || 0), item.startingQuantity);
  }
  assert.ok(data.inventory.some((item) => item.quantity <= item.reorderLevel), 'sample stock includes a plausible restock warning');
  assert.ok(data.students.every((patient) => patient.guardianPhone === 'DEMO-NO-CONTACT'));
  assert.ok(data.students.filter((patient) => patient.email).every((patient) => patient.email.endsWith('@example.test')));
  assert.ok(data.students.filter((patient) => patient.patientType === 'faculty').every((patient) => patient.email.endsWith('@example.test')));
});

test('additive demo seed inserts namespaced records once and skips its own rows on repeat', async () => {
  const data = generateDemoData({ asOf: REFERENCE_DATE, seed: 23 });
  const database = makeMemoryDatabase();
  const first = await addDemoData(database, data, 'test-admin-id');
  assert.equal(Object.values(first).reduce((sum, count) => sum + count.inserted, 0), 210 + 480 + 42 + 34 + 120);
  assert.equal(database.inserts.length, 886);
  assert.equal(database.version, 2, 'a seed write advances the clinic concurrency version exactly once');
  const second = await addDemoData(database, data, 'test-admin-id');
  assert.equal(Object.values(second).reduce((sum, count) => sum + count.inserted, 0), 0);
  assert.equal(Object.values(second).reduce((sum, count) => sum + count.alreadyPresent, 0), 886);
  assert.equal(database.inserts.length, 886);
  assert.equal(database.version, 2, 'an idempotent no-op does not advance the clinic version');
});

test('additive demo seed refuses an unowned ID collision before inserting any records', async () => {
  const data = generateDemoData({ asOf: REFERENCE_DATE, seed: 24 });
  const database = makeMemoryDatabase();
  database.tables.get('patients').set('demo-patient-0001', { data: { name: 'Existing patient', demoDataset: 'other' } });
  await assert.rejects(addDemoData(database, data, 'test-admin-id'), /unowned record.*No data was changed/);
  assert.deepEqual(database.inserts, []);
  assert.deepEqual(database.tables.get('patients').get('demo-patient-0001').data, { name: 'Existing patient', demoDataset: 'other' });
});

test('demo seed commands require opt-in and reject production', () => {
  assert.throws(() => assertDemoSeedAllowed({ NODE_ENV: undefined, SEED_DEMO_DATA: 'true' }), /NODE_ENV=development/);
  assert.throws(() => assertDemoSeedAllowed({ NODE_ENV: 'development' }), /SEED_DEMO_DATA=true/);
  assert.throws(() => assertDemoSeedAllowed({ NODE_ENV: 'production', SEED_DEMO_DATA: 'true' }), /NODE_ENV=development/);
  assert.doesNotThrow(() => assertDemoSeedAllowed({ NODE_ENV: 'development', SEED_DEMO_DATA: 'true' }));
});
