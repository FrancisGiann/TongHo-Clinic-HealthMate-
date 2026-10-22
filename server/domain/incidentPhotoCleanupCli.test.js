import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIncidentPhotoCleanupArguments, validateIncidentPhotoCleanupOptions } from './incidentPhotoCleanupCli.js';

test('incident photo cleanup accepts dry-run and defense-ended preview flags', () => {
  assert.deepEqual(parseIncidentPhotoCleanupArguments([]), { apply: false, confirm: false, requestedBucket: '', bucketSeen: false, defenseEnded: false });
  assert.equal(parseIncidentPhotoCleanupArguments(['--defense-ended']).defenseEnded, true);
  assert.equal(parseIncidentPhotoCleanupArguments(['--bucket', 'private-clinic']).requestedBucket, 'private-clinic');
});

test('incident photo cleanup rejects unknown, duplicate, missing, and ambiguous arguments', () => {
  for (const args of [
    ['--unknown'],
    ['--apply', '--apply'],
    ['--confirm-incident-photos'],
    ['--bucket'],
    ['--bucket', 'private', '--bucket', 'other'],
    ['--bucket', '../other'],
    ['--bucket', '--apply'],
  ]) assert.throws(() => parseIncidentPhotoCleanupArguments(args), { code: 'INVALID_ARGUMENTS' }, args.join(' '));
});

test('incident photo cleanup apply requires feature disabled, exact bucket and explicit confirmation', () => {
  const options = parseIncidentPhotoCleanupArguments(['--apply', '--confirm-incident-photos', '--bucket', 'clinic-private']);
  assert.deepEqual(validateIncidentPhotoCleanupOptions(options, { storageConfigured: true, configuredBucket: 'clinic-private', photosEnabled: false }), { valid: true });
  assert.equal(validateIncidentPhotoCleanupOptions(options, { storageConfigured: true, configuredBucket: 'clinic-private', photosEnabled: true }).code, 'PHOTO_FEATURE_MUST_BE_DISABLED');
  assert.equal(validateIncidentPhotoCleanupOptions(options, { storageConfigured: false, configuredBucket: 'clinic-private', photosEnabled: false }).code, 'APPLY_CONFIRMATION_REQUIRED');
  assert.equal(validateIncidentPhotoCleanupOptions(options, { storageConfigured: true, configuredBucket: 'other', photosEnabled: false }).code, 'APPLY_CONFIRMATION_REQUIRED');
});
