import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clinicArrivalNotice,
  clinicVisitCareSummary,
  formatClinicDateTime,
  notificationDeliveryCounts,
  recordClinicArrival,
  validateClinicArrivalPayload,
} from './clinicArrivals.js';

const eventId = '3a5b2d10-86d5-4b9e-93ea-89b2de563012';

test('arrival payload requires a bounded patient id and client UUID', () => {
  assert.deepEqual(validateClinicArrivalPayload({ patientId: 'student-17', eventId }), {
    valid: true,
    value: { patientId: 'student-17', eventId },
  });
  for (const payload of [
    null,
    { patientId: ' ', eventId },
    { patientId: 'student\n17', eventId },
    { patientId: 'x'.repeat(121), eventId },
    { patientId: 'student-17', eventId: 'not-a-uuid' },
  ]) {
    assert.equal(validateClinicArrivalPayload(payload).valid, false);
  }
});

test('arrival date and time are formatted in the Asia/Manila time zone', () => {
  assert.equal(formatClinicDateTime('2026-09-30T16:30:00.000Z'), 'Oct 1, 2026, 12:30 AM');
});

test('arrival notice contains only student, clinic, local time, and contact guidance', () => {
  const notice = clinicArrivalNotice({
    studentName: 'Mika Santos',
    clinicName: 'Campus Clinic',
    occurredAt: '2026-09-30T16:30:00.000Z',
  });
  assert.equal(notice.subject, 'Student arrival at the clinic');
  assert.match(notice.body, /Mika Santos arrived at Campus Clinic on Oct 1, 2026, 12:30 AM/);
  assert.match(notice.body, /contact the school clinic/);
  assert.doesNotMatch(notice.subject, /Mika Santos/);
});

test('care summary includes only the approved visit fields and uses a generic subject', () => {
  const notice = clinicVisitCareSummary({
    studentName: 'Mika Santos',
    visit: {
      createdAt: '2026-09-30T16:30:00.000Z',
      chiefComplaint: 'Headache',
      treatment: 'Rest and hydration',
      disposition: 'Returned to class',
      followUp: true,
      followUpDate: '2026-10-02',
      notes: 'PRIVATE INTERNAL NOTES',
      temperature: 39,
      pulse: 120,
      painScore: 8,
      riskAssessment: { category: 'high', rationale: 'PRIVATE RISK DATA' },
      diagnosis: 'PRIVATE DIAGNOSIS',
    },
  });
  assert.equal(notice.subject, 'Clinic visit care summary');
  assert.match(notice.body, /Student: Mika Santos/);
  assert.match(notice.body, /Visit date and time: Oct 1, 2026, 12:30 AM/);
  assert.match(notice.body, /Reason reported: Headache/);
  assert.match(notice.body, /Care provided: Rest and hydration/);
  assert.match(notice.body, /Disposition: Returned to class/);
  assert.match(notice.body, /Follow-up: Scheduled for 2026-10-02/);
  for (const privateValue of ['PRIVATE INTERNAL NOTES', 'PRIVATE RISK DATA', 'PRIVATE DIAGNOSIS', '39', '120', 'Pain score']) {
    assert.doesNotMatch(notice.body, new RegExp(privateValue));
  }
  assert.doesNotMatch(notice.subject, /Mika Santos/);
});

test('arrival persistence is idempotent and rejects an event id reused for another patient', async () => {
  const events = new Map();
  let insertCount = 0;
  const transaction = async (work) => work({
    async query(sql, params) {
      if (sql.startsWith('SELECT id,patient_id,occurred_at')) {
        const event = events.get(params[0]);
        return { rowCount: event ? 1 : 0, rows: event ? [event] : [] };
      }
      if (sql.startsWith('SELECT id,patient_type,data FROM patients')) {
        return { rowCount: 1, rows: [{ id: params[0], patient_type: 'student', data: { name: 'Mika Santos' } }] };
      }
      if (sql.startsWith('INSERT INTO clinic_arrivals')) {
        insertCount += 1;
        const event = { id: params[0], patient_id: params[1], occurred_at: new Date('2026-09-30T16:30:00.000Z') };
        events.set(params[0], event);
        return { rowCount: 1, rows: [event] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  });

  const first = await recordClinicArrival({ transaction, patientId: 'student-17', eventId, userId: 'nurse-1' });
  const retry = await recordClinicArrival({ transaction, patientId: 'student-17', eventId, userId: 'nurse-1' });
  const wrongPatient = await recordClinicArrival({ transaction, patientId: 'student-18', eventId, userId: 'nurse-1' });
  assert.equal(first.status, 'created');
  assert.equal(retry.status, 'existing');
  assert.equal(wrongPatient.status, 'conflict');
  assert.equal(insertCount, 1);
});

test('arrival persistence rejects faculty before inserting an event', async () => {
  const transaction = async (work) => work({
    async query(sql) {
      if (sql.startsWith('SELECT id,patient_id,occurred_at')) return { rowCount: 0, rows: [] };
      if (sql.startsWith('SELECT id,patient_type,data FROM patients')) {
        return { rowCount: 1, rows: [{ id: 'faculty-1', patient_type: 'faculty', data: {} }] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  });
  const result = await recordClinicArrival({ transaction, patientId: 'faculty-1', eventId, userId: 'nurse-1' });
  assert.equal(result.status, 'not_student');
});

test('delivery summary counts only explicit failures and leaves queued or unknown statuses pending', () => {
  assert.deepEqual(notificationDeliveryCounts(['sent', 'failed', 'queued'], 3), {
    recipientCount: 3,
    emailSentCount: 1,
    emailFailedCount: 1,
    emailPendingCount: 1,
    deliveryPending: true,
  });
  assert.deepEqual(notificationDeliveryCounts(['queued', 'unknown'], 3), {
    recipientCount: 3,
    emailSentCount: 0,
    emailFailedCount: 0,
    emailPendingCount: 3,
    deliveryPending: true,
  });
  assert.deepEqual(notificationDeliveryCounts(['unknown'], 1), {
    recipientCount: 1,
    emailSentCount: 0,
    emailFailedCount: 0,
    emailPendingCount: 1,
    deliveryPending: true,
  });
  assert.deepEqual(notificationDeliveryCounts([], 0), {
    recipientCount: 0,
    emailSentCount: 0,
    emailFailedCount: 0,
    emailPendingCount: 0,
    deliveryPending: false,
  });
});
