import test from 'node:test';
import assert from 'node:assert/strict';
import { assertCurrentBrandingVersion, BRANDING_SLOT_NAMES, projectBrandingAssets } from './branding.js';

test('public branding projection includes optional photo slots and ignores unknown assets', () => {
  const result = projectBrandingAssets([
    { slot: 'schoolSeal', asset_id: 'seal/one' },
    { slot: 'landingHeroPhoto', asset_id: 'hero one' },
    { slot: 'unapprovedSlot', asset_id: 'private' },
  ], 3);

  assert.deepEqual(BRANDING_SLOT_NAMES, ['applicationLogo', 'schoolSeal', 'landingHeroPhoto', 'landingCommunityPhoto']);
  assert.deepEqual(result, {
    version: 3,
    applicationLogo: null,
    schoolSeal: { assetId: 'seal/one', url: '/api/branding/assets/schoolSeal?v=seal%2Fone' },
    landingHeroPhoto: { assetId: 'hero one', url: '/api/branding/assets/landingHeroPhoto?v=hero%20one' },
    landingCommunityPhoto: null,
  });
  assert.deepEqual(projectBrandingAssets(null, 0), {
    version: 1,
    applicationLogo: null,
    schoolSeal: null,
    landingHeroPhoto: null,
    landingCommunityPhoto: null,
  });
});

test('branding saves and resets reject stale versions with a recoverable conflict', () => {
  assert.doesNotThrow(() => assertCurrentBrandingVersion(2, 2));
  assert.doesNotThrow(() => assertCurrentBrandingVersion(undefined, 1));
  assert.throws(() => assertCurrentBrandingVersion(3, 2), {
    status: 409,
    code: 'BRANDING_VERSION_CONFLICT',
    message: 'Branding changed in another session. Reload before saving.',
  });
  assert.throws(() => assertCurrentBrandingVersion(3, 2, 'reset'), {
    status: 409,
    code: 'BRANDING_VERSION_CONFLICT',
    message: 'Branding changed in another session. Reload before resetting.',
  });
});
