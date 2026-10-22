import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertCurrentLandingContentVersion,
  createDefaultLandingContent,
  projectAdminLandingContent,
  projectPublicLandingContent,
  validateLandingContent,
} from './landingContent.js';
import { isoToManilaLocalDateTime, manilaLocalDateTimeToIso } from '../../shared/landingContent.js';

test('landing content defaults preserve the current hero copy and leave unprovided clinic details empty', () => {
  const content = createDefaultLandingContent();
  assert.deepEqual(content.hero, {
    headline: 'School clinic care, connected.',
    introduction: 'A secure clinic workspace for Philippine Tong Ho Institute staff, with linked health records and appointment access for guardians.',
    primaryActionLabel: 'Sign in to HealthMate+',
    secondaryActionLabel: 'How access works',
  });
  assert.deepEqual(content.clinic, { location: '', hours: '', contact: '', services: [] });
  assert.deepEqual(content.announcements, []);
  assert.deepEqual(content.faqs, []);
});

test('landing content validation trims plain text and rejects unsupported fields, unsafe control characters, and oversized collections', () => {
  const content = createDefaultLandingContent();
  content.hero.headline = '  Clinic care  ';
  content.clinic.services = Array.from({ length: 9 }, (_, index) => `Service ${index}`);
  const invalid = validateLandingContent(content);
  assert.equal(invalid.valid, false);
  assert.equal(invalid.errors['clinic.services'], 'Add no more than 8 services.');

  content.clinic.services = ['  Appointment access  '];
  content.hero.internalHtml = '<script>alert(1)</script>';
  assert.equal(validateLandingContent(content).errors.hero, 'This section has unsupported fields.');
  delete content.hero.internalHtml;
  content.clinic.contact = 'Phone\u0000number';
  assert.equal(validateLandingContent(content).errors['clinic.contact'], 'Use plain text with no more than 200 characters.');

  content.clinic.contact = 'Phone or email';
  const valid = validateLandingContent(content);
  assert.equal(valid.valid, true);
  assert.equal(valid.value.hero.headline, 'Clinic care');
  assert.deepEqual(valid.value.clinic.services, ['Appointment access']);
});

test('announcement dates require an explicit valid timezone and expiry after start', () => {
  const content = createDefaultLandingContent();
  content.announcements = [{
    title: 'Clinic reminder',
    body: 'Bring the completed school form.',
    startsAt: '2026-02-31T09:00+08:00',
    expiresAt: '2026-02-28T09:00+08:00',
  }];
  let validation = validateLandingContent(content);
  assert.equal(validation.valid, false);
  assert.equal(validation.errors['announcements.0.startsAt'], 'Choose a valid date and time in Philippine time.');

  content.announcements[0] = {
    ...content.announcements[0],
    startsAt: '2026-02-28T10:00+08:00',
    expiresAt: '2026-02-28T09:00+08:00',
  };
  validation = validateLandingContent(content);
  assert.equal(validation.errors['announcements.0.expiresAt'], 'Expiry must be later than the start time.');
  content.announcements[0].startsAt = '2026-02-28T09:00';
  content.announcements[0].expiresAt = '2026-02-28T10:00+08:00';
  validation = validateLandingContent(content);
  assert.equal(validation.errors['announcements.0.startsAt'], 'Choose a date and time in Philippine time.');
});

test('public projection returns published-shaped content only and applies section order, visibility, and server-time announcement windows', () => {
  const content = createDefaultLandingContent();
  content.clinic.location = 'School clinic';
  content.announcements = [
    { title: 'Active', body: 'Visible now.', startsAt: '2026-10-22T09:00:00+08:00', expiresAt: '2026-10-22T11:00:00+08:00' },
    { title: 'Starts later', body: 'Not yet visible.', startsAt: '2026-10-22T10:01:00+08:00', expiresAt: '2026-10-22T11:00:00+08:00' },
    { title: 'Expired', body: 'No longer visible.', startsAt: '2026-10-22T08:00:00+08:00', expiresAt: '2026-10-22T10:00:00+08:00' },
  ];
  content.faqs = [{ question: 'Where?', answer: 'At the clinic.' }];
  content.sectionOrder = ['faqs', 'clinic', 'announcements'];
  content.sectionVisibility.clinic = false;
  const response = projectPublicLandingContent(content, new Date('2026-10-22T02:00:00.000Z'));
  assert.deepEqual(response.sections, [
    { id: 'faqs', faqs: [{ question: 'Where?', answer: 'At the clinic.' }] },
    { id: 'announcements', announcements: [{ title: 'Active', body: 'Visible now.' }] },
  ]);
  assert.equal('draftContent' in response, false);
  assert.equal('publishedAt' in response, false);
  assert.equal('startsAt' in response.sections[1].announcements[0], false);
});

test('admin projection keeps draft and publication separate and content version conflicts are recoverable', () => {
  const draft = createDefaultLandingContent();
  draft.hero.headline = 'Draft headline';
  const published = createDefaultLandingContent();
  const response = projectAdminLandingContent({ content_version: 4, draft_content: draft, published_content: published, published_at: '2026-10-21T04:00:00Z' });
  assert.equal(response.contentVersion, 4);
  assert.equal(response.draftContent.hero.headline, 'Draft headline');
  assert.equal(response.publishedContent.hero.headline, 'School clinic care, connected.');
  assert.doesNotThrow(() => assertCurrentLandingContentVersion(4, 4));
  assert.throws(() => assertCurrentLandingContentVersion(5, 4, 'publish'), {
    status: 409,
    code: 'LANDING_CONTENT_VERSION_CONFLICT',
    message: 'Landing-page content changed in another session. Reload before publishing.',
  });
});

test('datetime-local editor conversion is pinned to Philippine time regardless of browser timezone', () => {
  assert.equal(manilaLocalDateTimeToIso('2026-10-22T10:15'), '2026-10-22T10:15:00+08:00');
  assert.equal(manilaLocalDateTimeToIso('2026-02-31T10:15'), '');
  assert.equal(isoToManilaLocalDateTime('2026-10-22T02:15:00.000Z'), '2026-10-22T10:15');
});
