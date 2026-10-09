import test from 'node:test';
import assert from 'node:assert/strict';
import { healthRecordStatusNotice, persistHealthRecordStatusNotifications } from './healthRecordNotifications.js';

test('new pending submissions create safe in-app notices for active linked guardians and nurses', async () => {
  const calls = [];
  const client = { query: async (sql, params = []) => {
    calls.push({ sql, params });
    if (/JOIN guardian_patient_links/.test(sql)) return { rows: [{ id: 'guardian-a' }, { id: 'guardian-b' }] };
    if (/role='school_nurse'/.test(sql)) return { rows: [{ id: 'nurse-a' }] };
    return { rows: [] };
  } };
  const notification = await persistHealthRecordStatusNotifications(client, {
    id: 'submission-1', patient_id: 'student-1', status: 'pending_review', version: 1,
    payload: { allergies: 'sensitive answer' }, nurse_notes: 'sensitive note',
  }, { includeNurses: true });

  const inserts = calls.filter(({ sql }) => /INSERT INTO notifications/.test(sql));
  assert.equal(inserts.length, 3);
  assert.deepEqual(inserts.map(({ params }) => [params[1], params[3], params[4]]), [
    ['guardian-a', 'Health record submitted', 'Your health record was submitted for nurse review. Sign in to HealthMate+ for details.'],
    ['guardian-b', 'Health record submitted', 'Your health record was submitted for nurse review. Sign in to HealthMate+ for details.'],
    ['nurse-a', 'Health record awaiting review', 'A health record submission is ready for nurse review. Sign in to HealthMate+ for details.'],
  ]);
  assert.ok(inserts.every(({ params }) => !params[4].includes('sensitive')));
  assert.deepEqual(JSON.parse(inserts[0].params[6]), { submissionId: 'submission-1', audience: 'guardian' });
  assert.match(inserts[0].params[5], /^health-record-submission:submission-1:pending_review:v1:in-app:guardian-a$/);
  assert.match(calls[0].sql, /u\.status='active' AND u\.role='guardian'/);
  assert.match(calls.find(({ sql }) => /role='school_nurse'/.test(sql)).sql, /status='active' AND role='school_nurse'/);
  assert.equal(notification.patientId, 'student-1');
});

test('review notices target linked guardians and use status plus reviewed version for dedupe', async () => {
  const run = async (version) => {
    const inserts = [];
    const client = { query: async (sql, params = []) => {
      if (/JOIN guardian_patient_links/.test(sql)) return { rows: [{ id: 'guardian-a' }] };
      if (/INSERT INTO notifications/.test(sql)) inserts.push(params);
      return { rows: [] };
    } };
    await persistHealthRecordStatusNotifications(client, {
      id: 'submission-2', patient_id: 'student-1', status: 'changes_requested', version,
      nurse_notes: 'Do not include this note', payload: { diagnosis: 'Do not include this answer' },
    });
    return inserts[0];
  };

  const first = await run(2);
  const second = await run(3);
  assert.match(first[5], /changes_requested:v2:in-app:guardian-a$/);
  assert.match(second[5], /changes_requested:v3:in-app:guardian-a$/);
  assert.notEqual(first[5], second[5]);
  assert.equal(first[4], 'Your health record needs changes. Sign in to HealthMate+ for details.');
  assert.doesNotMatch(first[4], /diagnosis|note|contact/i);
});

test('status notice keys are immutable to submission ID, status, and version and contain no clinical data', () => {
  const notice = healthRecordStatusNotice({
    id: 'submission-3', status: 'accepted', version: 4,
    payload: { medications: 'private' }, nurse_notes: 'private',
  });
  assert.equal(notice.dedupeKey, 'health-record-submission:submission-3:accepted:v4');
  assert.equal(notice.subject, 'Health record accepted');
  assert.equal(notice.body, 'Your health record was accepted. Sign in to HealthMate+ for details.');
  assert.doesNotMatch(JSON.stringify(notice), /private|medications|nurse_notes/);
  assert.throws(() => healthRecordStatusNotice({ id: 'submission-3', status: 'superseded', version: 5 }));
});
