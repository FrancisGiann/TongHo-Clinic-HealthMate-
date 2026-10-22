import {
  createDefaultLandingContent,
  normalizeStoredLandingContent,
  projectPublicLandingContent,
  validateLandingContent,
} from '../../shared/landingContent.js';

export {
  createDefaultLandingContent,
  normalizeStoredLandingContent,
  projectPublicLandingContent,
  validateLandingContent,
};

export function projectAdminLandingContent(row = {}) {
  return {
    contentVersion: Number.isSafeInteger(row.content_version) && row.content_version > 0 ? row.content_version : 1,
    draftContent: normalizeStoredLandingContent(row.draft_content),
    publishedContent: normalizeStoredLandingContent(row.published_content),
    draftUpdatedAt: row.draft_updated_at || null,
    publishedAt: row.published_at || null,
  };
}

export function assertCurrentLandingContentVersion(currentVersion, expectedVersion, action = 'saving') {
  if ((currentVersion || 1) === expectedVersion) return;
  const operation = action === 'publish' ? 'publishing' : 'saving';
  const error = new Error(`Landing-page content changed in another session. Reload before ${operation}.`);
  error.status = 409;
  error.code = 'LANDING_CONTENT_VERSION_CONFLICT';
  throw error;
}
