import { randomUUID } from 'node:crypto';
import { validateDispenseAvailability } from './inventory.js';

function availabilityError(availability) {
  const error = new Error(availability.message);
  error.status = availability.status;
  error.code = availability.code;
  return error;
}

export async function resolveInventoryDispensations(client, dispensations = [], { now = new Date() } = {}) {
  if (!dispensations.length) return { resolved: [], lockOrder: [] };
  const inventoryIds = dispensations.map((entry) => entry.itemId);
  const inventoryResult = await client.query(
    'SELECT id,quantity,data FROM inventory_items WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE',
    [[...inventoryIds].sort()],
  );
  const inventoryById = new Map(inventoryResult.rows.map((item) => [String(item.id), item]));
  const resolved = dispensations.map((entry) => {
    const item = inventoryById.get(String(entry.itemId)) || null;
    const availability = validateDispenseAvailability(item, entry.quantity, now);
    if (!availability.valid) throw availabilityError(availability);
    return {
      itemId: String(entry.itemId),
      itemName: item.data?.name || 'Unknown item',
      itemType: item.data?.itemType,
      quantity: entry.quantity,
      item,
    };
  });
  return { resolved, lockOrder: inventoryResult.rows.map((item) => String(item.id)) };
}

export async function applyInventoryDispensations(client, {
  resolved = [],
  lockOrder = [],
  visitId,
  createdAt = new Date(),
  userId,
}) {
  const resolvedById = new Map(resolved.map((entry) => [entry.itemId, entry]));

  // The rows are returned in the same deterministic order used for row locks.
  for (const itemId of lockOrder) {
    const entry = resolvedById.get(String(itemId));
    if (!entry) throw new Error('A locked inventory item is missing its validated dispense details.');
    const updated = await client.query(
      "UPDATE inventory_items SET quantity=quantity-$1,data=jsonb_set(data,'{quantity}',to_jsonb(quantity-$1),true),updated_at=NOW() WHERE id=$2 AND quantity >= $1",
      [entry.quantity, entry.itemId],
    );
    if (!updated.rowCount) {
      const error = new Error('Inventory stock changed before the visit could be saved. Review stock and try again.');
      error.status = 409;
      error.code = 'INSUFFICIENT_STOCK';
      throw error;
    }
    await client.query(
      'INSERT INTO dispense_logs(id,visit_id,inventory_item_id,quantity,data,created_by) VALUES($1,$2,$3,$4,$5::jsonb,$6)',
      [randomUUID(), visitId, entry.itemId, entry.quantity, JSON.stringify({ visitId, medicineId: entry.itemId, itemId: entry.itemId, itemName: entry.itemName, inventoryItemName: entry.itemName, medicineName: entry.itemName, itemType: entry.itemType, quantity: entry.quantity, date: createdAt.toISOString() }), userId],
    );
  }
  return resolved;
}

export async function persistVisitAndDispensations(client, {
  persistVisit,
  resolved = [],
  lockOrder = [],
  visitId,
  createdAt = new Date(),
  userId,
}) {
  if (typeof persistVisit !== 'function') throw new TypeError('A visit persistence callback is required.');
  await persistVisit();
  return applyInventoryDispensations(client, { resolved, lockOrder, visitId, createdAt, userId });
}
