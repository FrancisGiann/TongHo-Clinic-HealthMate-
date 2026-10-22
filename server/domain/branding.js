export const BRANDING_SLOT_NAMES = Object.freeze([
  'applicationLogo',
  'schoolSeal',
  'landingHeroPhoto',
  'landingCommunityPhoto',
]);

const brandingSlotSet = new Set(BRANDING_SLOT_NAMES);

export function projectBrandingAssets(rows, version = 1) {
  const assetsBySlot = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!brandingSlotSet.has(row?.slot) || typeof row.asset_id !== 'string' || !row.asset_id) continue;
    assetsBySlot.set(row.slot, {
      assetId: row.asset_id,
      url: `/api/branding/assets/${row.slot}?v=${encodeURIComponent(row.asset_id)}`,
    });
  }

  return {
    version: Number.isSafeInteger(version) && version > 0 ? version : 1,
    ...Object.fromEntries(BRANDING_SLOT_NAMES.map((slot) => [slot, assetsBySlot.get(slot) || null])),
  };
}

export function assertCurrentBrandingVersion(currentVersion, expectedVersion, action = 'saving') {
  if ((currentVersion || 1) === expectedVersion) return;
  const operation = action === 'reset' ? 'resetting' : 'saving';
  const error = new Error(`Branding changed in another session. Reload before ${operation}.`);
  error.status = 409;
  error.code = 'BRANDING_VERSION_CONFLICT';
  throw error;
}
