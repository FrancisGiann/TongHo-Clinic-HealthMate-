const ALLOWED_FLAGS = new Set(['--apply', '--confirm-incident-photos', '--bucket', '--defense-ended']);

export function parseIncidentPhotoCleanupArguments(args = []) {
  const seen = new Set();
  let requestedBucket = '';
  let bucketSeen = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!ALLOWED_FLAGS.has(argument) || seen.has(argument)) {
      const error = new Error('Invalid cleanup arguments.');
      error.code = 'INVALID_ARGUMENTS';
      throw error;
    }
    seen.add(argument);
    if (argument === '--bucket') {
      const candidate = args[index + 1];
      if (bucketSeen || !candidate || candidate.startsWith('--') || candidate.length > 100 || /[\s/]/.test(candidate)) {
        const error = new Error('Invalid cleanup bucket argument.');
        error.code = 'INVALID_ARGUMENTS';
        throw error;
      }
      bucketSeen = true;
      requestedBucket = candidate;
      index += 1;
    }
  }
  const apply = seen.has('--apply');
  const confirm = seen.has('--confirm-incident-photos');
  if (confirm && !apply) {
    const error = new Error('Photo cleanup confirmation requires --apply.');
    error.code = 'INVALID_ARGUMENTS';
    throw error;
  }
  return { apply, confirm, requestedBucket, bucketSeen, defenseEnded: seen.has('--defense-ended') };
}

export function validateIncidentPhotoCleanupOptions(options, { storageConfigured, configuredBucket, photosEnabled }) {
  if (options.apply && photosEnabled) return { valid: false, code: 'PHOTO_FEATURE_MUST_BE_DISABLED' };
  if (options.apply && (!options.confirm || !options.requestedBucket || options.requestedBucket !== configuredBucket || !storageConfigured)) {
    return { valid: false, code: 'APPLY_CONFIRMATION_REQUIRED' };
  }
  return { valid: true };
}
