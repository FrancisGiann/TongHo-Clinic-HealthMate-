import test from 'node:test';
import assert from 'node:assert/strict';
import { reminderDateWindow, runClinicReminderSweep } from './reminders.js';

test('reminder date window uses Asia/Manila calendar days', () => {
  assert.deepEqual(reminderDateWindow(new Date('2026-08-15T17:00:00.000Z')), {
    today: '2026-08-16',
    horizon: '2026-09-15',
  });
  assert.throws(() => reminderDateWindow('not-a-date'), RangeError);
  assert.throws(() => reminderDateWindow(new Date(), 366), RangeError);
});

test('reminder sweep skips missing or invalid follow-up dates and deduplicates recurring review monthly', async () => {
  const queryTexts = [];
  const notices = [];
  const logs = [];
  const results = [
    { rows: [
      { id: 'visit-due', patient_id: 'patient-1', data: { followUp: true, followUpDate: '2026-08-25' } },
      { id: 'visit-no-date', patient_id: 'patient-2', data: { followUp: true, date: '2026-08-01' } },
      { id: 'visit-invalid', patient_id: 'patient-3', data: { followUp: true, followUpDate: '2026-02-30' } },
      { id: 'visit-too-late', patient_id: 'patient-4', data: { followUp: true, followUpDate: '2026-09-20' } },
      { id: 'visit-string-true', patient_id: 'patient-5', data: { followUp: 'true', followUpDate: '2026-08-16' } },
    ] },
    { rows: [
      { id: 'immunization-due', patient_id: 'patient-6', data: { nextDueDate: '2026-09-01' } },
      { id: 'immunization-invalid', patient_id: 'patient-7', data: { nextDueDate: '2026-02-30' } },
    ] },
    { rows: [{ patient_id: 'patient-8', count: 3 }] },
    { rows: [
      { id: 'patient-consent-due', data: { consentStatus: 'pending', consentDueDate: '2026-08-19' } },
      { id: 'patient-consent-upcoming', data: { consentStatus: 'pending', consentDueDate: '2026-09-19' } },
      { id: 'patient-consent-invalid', data: { consentStatus: 'pending', consentDueDate: '2026-02-30' } },
      { id: 'patient-consent-undated', data: { consentStatus: 'pending' } },
      { id: 'patient-consent-received', data: { consentStatus: 'received', consentDueDate: '2026-08-19' } },
    ] },
  ];
  let queryIndex = 0;
  const result = await runClinicReminderSweep({
    now: new Date('2026-08-20T02:00:00.000Z'),
    queryFn: async (sql, values) => {
      queryTexts.push(sql);
      if (queryIndex < 2) assert.deepEqual(values, ['2026-09-19']);
      return results[queryIndex++];
    },
    notifyPatient: async (patientId, notice) => {
      notices.push({ patientId, ...notice });
      if (patientId === 'patient-1') throw Object.assign(new Error('private recipient detail'), { code: 'SMTP_ERROR' });
    },
    logger: { error: (...args) => logs.push(args) },
  });

  assert.deepEqual(result, {
    triggered: 6,
    followUps: 2,
    immunizations: 1,
    recurring: 1,
    consents: 2,
    notificationFailures: 1,
    today: '2026-08-20',
    horizon: '2026-09-19',
  });
  assert.ok(queryTexts[0].includes("data->>'followUpDate'"));
  assert.ok(!queryTexts[0].includes('COALESCE'));
  assert.equal(notices.length, 6);
  assert.equal(notices[0].body.includes('2026-08-25'), true);
  assert.equal(notices[0].dedupeKey, 'follow-up:visit-due:2026-08-25');
  assert.equal(notices[1].dedupeKey, 'follow-up:visit-string-true:2026-08-16');
  assert.equal(notices[3].dedupeKey, 'recurring-visits:patient-8:2026-08');
  assert.equal(notices[4].patientId, 'patient-consent-due');
  assert.equal(notices[4].dedupeKey, 'consent-reminder:patient-consent-due:2026-08-19');
  assert.match(notices[4].body, /due on 2026-08-19/);
  assert.doesNotMatch(notices[4].body, /student-consent-due|guardian|grade|diagnosis/i);
  assert.equal(notices[5].dedupeKey, 'consent-reminder:patient-consent-upcoming:2026-09-19');
  assert.equal(notices[3].body.includes('recurring clinic visits'), false);
  assert.ok(queryTexts[3].includes("data->>'consentStatus'='pending'"));
  assert.ok(queryTexts[3].includes("data->>'consentDueDate'"));
  assert.deepEqual(logs, [['Follow-up reminder failed.', { code: 'SMTP_ERROR' }]]);
});

test('manual reminder sweeps in the same month reuse the recurring-review dedupe key', async () => {
  const keys = [];
  for (const now of ['2026-08-01T00:00:00Z', '2026-08-31T00:00:00Z']) {
    let queryIndex = 0;
    await runClinicReminderSweep({
      now,
      queryFn: async () => [{ rows: [] }, { rows: [] }, { rows: [{ patient_id: 'patient-1', count: 3 }] }, { rows: [] }][queryIndex++],
      notifyPatient: async (_patientId, notification) => keys.push(notification.dedupeKey),
    });
  }
  assert.deepEqual(keys, ['recurring-visits:patient-1:2026-08', 'recurring-visits:patient-1:2026-08']);
});

test('consent reminders dedupe by patient and due date across repeated sweeps', async () => {
  const keys = [];
  for (const now of ['2026-08-20T00:00:00Z', '2026-08-21T00:00:00Z']) {
    let queryIndex = 0;
    const rows = [
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [{ id: 'patient-1', data: { consentStatus: 'pending', consentDueDate: '2026-08-30' } }] },
    ];
    await runClinicReminderSweep({
      now,
      queryFn: async () => rows[queryIndex++],
      notifyPatient: async (_patientId, notification) => keys.push(notification.dedupeKey),
    });
  }
  assert.deepEqual(keys, [
    'consent-reminder:patient-1:2026-08-30',
    'consent-reminder:patient-1:2026-08-30',
  ]);
});
