import crypto from 'node:crypto';

const guardianCopy = {
  pending_review: {
    subject: 'Health record submitted',
    body: 'Your health record was submitted for nurse review. Sign in to HealthMate+ for details.',
  },
  changes_requested: {
    subject: 'Health record needs an update',
    body: 'Your health record needs changes. Sign in to HealthMate+ for details.',
  },
  accepted: {
    subject: 'Health record accepted',
    body: 'Your health record was accepted. Sign in to HealthMate+ for details.',
  },
};

export function healthRecordStatusNotice(submission) {
  const status = String(submission?.status || '');
  const version = Number(submission?.version);
  const id = String(submission?.id || '');
  const copy = guardianCopy[status];
  if (!copy || !id || !Number.isInteger(version) || version < 1) {
    throw new Error('A persisted health record submission status is required for notification.');
  }
  return {
    type: 'health_record_status',
    ...copy,
    dedupeKey: `health-record-submission:${id}:${status}:v${version}`,
  };
}

async function insertInAppNotice(client, userId, notice, audience, submissionId) {
  const eventKey = `${notice.dedupeKey}:in-app:${userId}`;
  await client.query(
    `INSERT INTO notifications(id,user_id,channel,type,subject,body,dedupe_key,metadata)
     VALUES($1,$2,'in_app',$3,$4,$5,$6,$7::jsonb)
     ON CONFLICT(dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
    [crypto.randomUUID(), userId, notice.type, notice.subject, notice.body, eventKey, JSON.stringify({ submissionId, audience })],
  );
}

export async function persistHealthRecordStatusNotifications(client, submission, { includeNurses = false } = {}) {
  const notice = healthRecordStatusNotice(submission);
  const guardians = await client.query(
    `SELECT DISTINCT u.id FROM users u
     JOIN guardian_patient_links l ON l.guardian_user_id=u.id
     WHERE u.status='active' AND u.role='guardian' AND l.patient_id=$1
     ORDER BY u.id`,
    [String(submission.patient_id)],
  );
  for (const guardian of guardians.rows) {
    await insertInAppNotice(client, guardian.id, notice, 'guardian', String(submission.id));
  }

  if (includeNurses) {
    const nurses = await client.query("SELECT id FROM users WHERE status='active' AND role='school_nurse' ORDER BY id");
    const nurseNotice = {
      ...notice,
      subject: 'Health record awaiting review',
      body: 'A health record submission is ready for nurse review. Sign in to HealthMate+ for details.',
    };
    for (const nurse of nurses.rows) {
      await insertInAppNotice(client, nurse.id, nurseNotice, 'school_nurse', String(submission.id));
    }
  }

  return { ...notice, patientId: String(submission.patient_id) };
}
