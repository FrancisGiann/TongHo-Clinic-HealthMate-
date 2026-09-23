import test from 'node:test';
import assert from 'node:assert/strict';
import { persistVisitAndDispensations, resolveInventoryDispensations } from './dispensing.js';

function createInventory() {
  return {
    items: new Map([
      ['a-med', { id: 'a-med', quantity: 4, data: { name: 'Bandage', itemType: 'supply', expiryDate: '' } }],
      ['z-med', { id: 'z-med', quantity: 5, data: { name: 'Acetaminophen', itemType: 'medication', expiryDate: '' } }],
    ]),
    logs: [],
    visits: new Set(),
    locks: new Map(),
    nextVisitId: 0,
  };
}

async function acquireLock(store, id) {
  const previous = store.locks.get(id) || Promise.resolve();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const tail = previous.then(() => gate);
  store.locks.set(id, tail);
  await previous;
  return () => {
    release();
    if (store.locks.get(id) === tail) store.locks.delete(id);
  };
}

function makeTransaction(store, { failUpdateFor = '', delayAfterLock = 0 } = {}) {
  return async (operation) => {
    const releases = [];
    const undo = [];
    const insertedVisits = [];
    const visitId = `visit-${++store.nextVisitId}`;
    const client = {
      async query(sql, params) {
        if (sql.startsWith('INSERT INTO visits')) {
          const visitId = params[0];
          store.visits.add(visitId);
          insertedVisits.push(visitId);
          return { rowCount: 1 };
        }
        if (sql.includes('SELECT id,quantity,data FROM inventory_items')) {
          assert.match(sql, /ORDER BY id FOR UPDATE/);
          const ids = params[0];
          for (const id of ids) releases.push(await acquireLock(store, id));
          if (delayAfterLock) await new Promise((resolve) => setTimeout(resolve, delayAfterLock));
          return { rows: ids.flatMap((id) => store.items.has(id) ? [structuredClone(store.items.get(id))] : []) };
        }
        if (sql.startsWith('UPDATE inventory_items SET quantity=quantity-')) {
          const [quantity, id] = params;
          if (id === failUpdateFor) return { rowCount: 0 };
          const item = store.items.get(id);
          if (!item || item.quantity < quantity) return { rowCount: 0 };
          undo.push({ id, item: structuredClone(item) });
          item.quantity -= quantity;
          item.data.quantity = item.quantity;
          return { rowCount: 1 };
        }
        if (sql.startsWith('INSERT INTO dispense_logs')) {
          assert.ok(store.visits.has(params[1]), 'dispense log visit foreign key must exist before log insert');
          store.logs.push({ visitId: params[1], itemId: params[2], quantity: params[3] });
          return { rowCount: 1 };
        }
        assert.fail(`Unexpected query: ${sql}`);
      },
    };
    try {
      return await operation(client, visitId);
    } catch (error) {
      for (const previous of undo.reverse()) store.items.set(previous.id, previous.item);
      store.logs = store.logs.filter((log) => log.visitId !== visitId);
      insertedVisits.forEach((id) => store.visits.delete(id));
      throw error;
    } finally {
      releases.reverse().forEach((release) => release());
    }
  };
}

test('multi-item dispense locks IDs consistently, decrements each item and writes a log per item', async () => {
  const store = createInventory();
  const createdAt = new Date('2026-09-23T01:00:00.000Z');
  const resolved = await makeTransaction(store)(async (client, visitId) => {
    const locked = await resolveInventoryDispensations(client, [
      { itemId: 'z-med', quantity: 2 }, { itemId: 'a-med', quantity: 1 },
    ]);
    await persistVisitAndDispensations(client, {
      persistVisit: () => client.query('INSERT INTO visits(id) VALUES($1)', [visitId]),
      ...locked,
      visitId,
      createdAt,
      userId: 'nurse-1',
    });
    return locked.resolved;
  });

  assert.deepEqual(resolved.map(({ itemId, itemName, itemType, quantity }) => ({ itemId, itemName, itemType, quantity })), [
    { itemId: 'z-med', itemName: 'Acetaminophen', itemType: 'medication', quantity: 2 },
    { itemId: 'a-med', itemName: 'Bandage', itemType: 'supply', quantity: 1 },
  ]);
  assert.equal(store.items.get('a-med').quantity, 3);
  assert.equal(store.items.get('z-med').quantity, 3);
  assert.deepEqual(store.logs.map(({ itemId, quantity }) => [itemId, quantity]), [['a-med', 1], ['z-med', 2]]);
});

test('failure during a later item write rolls back earlier decrements and dispense logs', async () => {
  const store = createInventory();
  await assert.rejects(makeTransaction(store, { failUpdateFor: 'z-med' })(async (client, visitId) => {
    const locked = await resolveInventoryDispensations(client, [
      { itemId: 'a-med', quantity: 1 }, { itemId: 'z-med', quantity: 2 },
    ]);
    return persistVisitAndDispensations(client, {
      persistVisit: () => client.query('INSERT INTO visits(id) VALUES($1)', [visitId]),
      ...locked,
      visitId,
      userId: 'nurse-1',
    });
  }), { code: 'INSUFFICIENT_STOCK', status: 409 });
  assert.equal(store.items.get('a-med').quantity, 4);
  assert.equal(store.items.get('z-med').quantity, 5);
  assert.deepEqual(store.logs, []);
  assert.deepEqual(store.visits, new Set(), 'the transaction rolls back visit creation when a dispense fails');
});

test('concurrent dispenses serialize on inventory row locks and only one consumes the final unit', async () => {
  const store = createInventory();
  store.items.get('a-med').quantity = 1;
  store.items.get('a-med').data.quantity = 1;
  const transact = makeTransaction(store, { delayAfterLock: 10 });
  const attempt = () => transact(async (client, visitId) => {
    const locked = await resolveInventoryDispensations(client, [{ itemId: 'a-med', quantity: 1 }]);
    return persistVisitAndDispensations(client, {
      persistVisit: () => client.query('INSERT INTO visits(id) VALUES($1)', [visitId]),
      ...locked,
      visitId,
      userId: 'nurse-1',
    });
  });

  const results = await Promise.allSettled([attempt(), attempt()]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  assert.equal(store.items.get('a-med').quantity, 0);
  assert.equal(store.logs.length, 1);
  assert.equal(store.visits.size, 1);
});
