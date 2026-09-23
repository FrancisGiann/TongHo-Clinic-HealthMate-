import test from 'node:test';
import assert from 'node:assert/strict';
import { applyStockAdjustment, validateDispenseAvailability, validateInventoryArchive, validateInventoryItem, validateStockAdjustment } from './inventory.js';

test('inventory item validation bounds fields and keeps stock separate on updates', () => {
  const create = validateInventoryItem({ name: '  Salbutamol  ', category: 'Respiratory', unit: 'inhalers', expiryDate: '2027-08-31', reorderLevel: 5, quantity: 4 }, { create: true });
  assert.deepEqual(create, { valid: true, value: { name: 'Salbutamol', category: 'Respiratory', unit: 'inhalers', expiryDate: '2027-08-31', reorderLevel: 5, quantity: 4 } });
  const update = validateInventoryItem({ name: 'Salbutamol', category: 'Respiratory', unit: 'inhalers', expiryDate: '', reorderLevel: 6, quantity: 999 });
  assert.deepEqual(update, { valid: true, value: { name: 'Salbutamol', category: 'Respiratory', unit: 'inhalers', expiryDate: '', reorderLevel: 6 } });
  assert.equal(validateInventoryItem({ name: 'A', category: 'Other', unit: 'pieces', expiryDate: '', reorderLevel: 0 }).valid, false);
  assert.equal(validateInventoryItem({ name: 'A', category: 'First Aid', unit: 'pieces', expiryDate: '2026-02-30', reorderLevel: 0 }).valid, false);
});

test('stock adjustments require a bounded nonzero delta and a reason', () => {
  assert.deepEqual(validateStockAdjustment({ quantityDelta: -1, reason: 'Stock correction' }), { valid: true, value: { quantityDelta: -1, reason: 'Stock correction' } });
  assert.equal(validateStockAdjustment({ quantityDelta: 0, reason: 'Correction' }).valid, false);
  assert.equal(validateStockAdjustment({ quantityDelta: 2, reason: '' }).valid, false);
  assert.equal(validateStockAdjustment({ quantityDelta: 1.5, reason: 'Correction' }).valid, false);
});

test('stock adjustment math rejects negative and over-limit inventory balances', () => {
  assert.deepEqual(applyStockAdjustment(1, -1), { valid: true, quantity: 0 });
  assert.equal(applyStockAdjustment(0, -1).valid, false);
  assert.equal(applyStockAdjustment(1_000_000, 1).valid, false);
});

test('archive updates require an explicit boolean state', () => {
  assert.deepEqual(validateInventoryArchive({ archived: true }), { valid: true, value: { archived: true } });
  assert.equal(validateInventoryArchive({ archived: 'true' }).valid, false);
});

test('archived inventory cannot be dispensed even while stored quantity remains', () => {
  assert.deepEqual(validateDispenseAvailability({ quantity: 10, data: { archived: true } }, 1), {
    valid: false,
    status: 409,
    code: 'MEDICINE_ARCHIVED',
    message: 'The selected medicine is archived and cannot be dispensed.',
  });
  assert.deepEqual(validateDispenseAvailability({ quantity: 10, data: { archived: false } }, 2), { valid: true });
});

test('expired medicine is rejected using the clinic calendar date', () => {
  const afterManilaMidnight = new Date('2026-09-22T16:00:00.000Z');
  assert.deepEqual(validateDispenseAvailability({ quantity: 3, data: { expiryDate: '2026-09-22' } }, 1, afterManilaMidnight), {
    valid: false,
    status: 409,
    code: 'MEDICINE_EXPIRED',
    message: 'The selected medicine is past its expiry date and cannot be dispensed.',
  });
  assert.deepEqual(validateDispenseAvailability({ quantity: 3, data: { expiryDate: '2026-09-23' } }, 1, afterManilaMidnight), { valid: true });
});
