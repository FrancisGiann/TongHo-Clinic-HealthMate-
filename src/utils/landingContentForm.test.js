import test from 'node:test';
import assert from 'node:assert/strict';
import { announcementFromForm, announcementToForm } from './landingContentForm.js';

test('loading and editing announcement copy preserves stored seconds and milliseconds until that date field changes', () => {
  const saved = {
    title: 'Clinic update',
    body: 'The clinic will be open.',
    startsAt: '2026-10-22T01:15:37.456Z',
    expiresAt: '2026-10-22T03:45:51.789Z',
  };
  const form = announcementToForm(saved);
  assert.equal(form.startsAt, '2026-10-22T09:15');
  assert.equal(form.expiresAt, '2026-10-22T11:45');

  form.title = 'Updated clinic update';
  assert.deepEqual(announcementFromForm(form), {
    title: 'Updated clinic update',
    body: 'The clinic will be open.',
    startsAt: saved.startsAt,
    expiresAt: saved.expiresAt,
  });

  form.startsAt = '2026-10-22T09:16';
  assert.equal(announcementFromForm(form).startsAt, '2026-10-22T09:16:00+08:00');
  assert.equal(announcementFromForm(form).expiresAt, saved.expiresAt);
});
