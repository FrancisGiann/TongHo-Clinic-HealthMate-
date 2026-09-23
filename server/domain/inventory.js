const categories = new Set(['Analgesics', 'First Aid', 'Supplies', 'Respiratory', 'Antibiotics', 'Vitamins', 'Emergency']);
const units = new Set(['tablets', 'pieces', 'packs', 'sachets', 'inhalers', 'bottles', 'boxes', 'ml']);
const maxStock = 1_000_000;

function validIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validateInventoryItem(payload, { create = false } = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { valid: false, message: 'Enter valid inventory details.' };
  const name = String(payload.name || '').trim();
  const category = String(payload.category || '');
  const unit = String(payload.unit || '');
  const expiryDate = payload.expiryDate == null ? '' : String(payload.expiryDate);
  const reorderLevel = Number(payload.reorderLevel);
  const quantity = Number(payload.quantity);
  if (!name || name.length > 120) return { valid: false, message: 'Item name must be between 1 and 120 characters.' };
  if (!categories.has(category)) return { valid: false, message: 'Choose a supported inventory category.' };
  if (!units.has(unit)) return { valid: false, message: 'Choose a supported inventory unit.' };
  if (expiryDate && !validIsoDate(expiryDate)) return { valid: false, message: 'Expiry date must be a real date in YYYY-MM-DD format.' };
  if (!Number.isInteger(reorderLevel) || reorderLevel < 0 || reorderLevel > maxStock) return { valid: false, message: 'Reorder level must be a whole number from 0 to 1,000,000.' };
  if (create && (!Number.isInteger(quantity) || quantity < 0 || quantity > maxStock)) return { valid: false, message: 'Starting stock must be a whole number from 0 to 1,000,000.' };
  return {
    valid: true,
    value: {
      name,
      category,
      unit,
      expiryDate,
      reorderLevel,
      ...(create ? { quantity } : {}),
    },
  };
}

export function validateStockAdjustment(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { valid: false, message: 'Enter a valid stock adjustment.' };
  const quantityDelta = Number(payload.quantityDelta);
  const reason = String(payload.reason || '').trim();
  if (!Number.isInteger(quantityDelta) || quantityDelta === 0 || Math.abs(quantityDelta) > maxStock) {
    return { valid: false, message: 'Adjustment must be a non-zero whole number up to 1,000,000 units.' };
  }
  if (!reason || reason.length > 160) return { valid: false, message: 'Reason must be between 1 and 160 characters.' };
  return { valid: true, value: { quantityDelta, reason } };
}

export function applyStockAdjustment(currentQuantity, quantityDelta) {
  const current = Number(currentQuantity);
  const delta = Number(quantityDelta);
  const nextQuantity = current + delta;
  if (!Number.isInteger(current) || current < 0 || !Number.isInteger(delta) || delta === 0 || Math.abs(delta) > maxStock || nextQuantity < 0 || nextQuantity > maxStock) {
    return { valid: false, code: 'STOCK_ADJUSTMENT_OUT_OF_RANGE', message: nextQuantity < 0 ? 'Stock cannot be reduced below zero.' : 'Stock cannot exceed 1,000,000 units.' };
  }
  return { valid: true, quantity: nextQuantity };
}

export function validateInventoryArchive(payload) {
  if (!payload || typeof payload.archived !== 'boolean') return { valid: false, message: 'Choose whether to archive this item.' };
  return { valid: true, value: { archived: payload.archived } };
}

function clinicDateKey(now) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function validateDispenseAvailability(item, quantity, now = new Date()) {
  if (item?.data?.archived) return { valid: false, status: 409, code: 'MEDICINE_ARCHIVED', message: 'The selected medicine is archived and cannot be dispensed.' };
  if (!item || !Number.isInteger(Number(quantity)) || Number(quantity) < 1 || Number(item.quantity) < Number(quantity)) {
    return { valid: false, status: 409, code: 'INSUFFICIENT_STOCK', message: 'The selected medicine does not have enough stock.' };
  }
  const expiryDate = String(item.data?.expiryDate || '');
  if (expiryDate && !validIsoDate(expiryDate)) return { valid: false, status: 409, code: 'MEDICINE_EXPIRY_INVALID', message: 'The expiry date is invalid. Correct it before dispensing.' };
  if (expiryDate && expiryDate < clinicDateKey(now)) return { valid: false, status: 409, code: 'MEDICINE_EXPIRED', message: 'The selected medicine is past its expiry date and cannot be dispensed.' };
  return { valid: true };
}
