import { query } from './db.js';
import { isValidCalendarDate, latestImmunizationsByStudentVaccine } from '../shared/immunizationOrder.js';

const REMINDER_LOOKAHEAD_DAYS = 30;

function isoDate(value) {
  return isValidCalendarDate(value);
}

function clinicDate(value) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function reminderDateWindow(now = new Date(), lookaheadDays = REMINDER_LOOKAHEAD_DAYS) {
  const instant = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(instant.getTime())) throw new RangeError('Reminder date must be valid.');
  if (!Number.isInteger(lookaheadDays) || lookaheadDays < 0 || lookaheadDays > 365) throw new RangeError('Reminder lookahead must be between 0 and 365 days.');
  const today = clinicDate(instant);
  const horizon = new Date(`${today}T00:00:00.000Z`);
  horizon.setUTCDate(horizon.getUTCDate() + lookaheadDays);
  return { today, horizon: horizon.toISOString().slice(0, 10) };
}

export async function runClinicReminderSweep({
  now = new Date(),
  queryFn = query,
  notifyPatient,
  logger = console,
} = {}) {
  if (typeof notifyPatient !== 'function') throw new TypeError('A patient notification handler is required.');
  const { today, horizon } = reminderDateWindow(now);
  const [followUpResult, immunizationResult, recurringResult, consentResult] = await Promise.all([
    queryFn(
      `SELECT id,patient_id,data FROM visits
       WHERE data->>'followUp'='true'
         AND data->>'followUpDate' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
         AND data->>'followUpDate' <= $1
       ORDER BY created_at DESC LIMIT 500`,
      [horizon],
    ),
    queryFn(
      `WITH immunization_dates AS (
         SELECT id,patient_id,data,created_at,
                CASE WHEN data->>'dateAdministered' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
                  CASE WHEN SUBSTRING(data->>'dateAdministered',6,2)::int BETWEEN 1 AND 12 THEN
                    CASE WHEN SUBSTRING(data->>'dateAdministered',9,2)::int BETWEEN 1 AND
                      CASE
                        WHEN SUBSTRING(data->>'dateAdministered',6,2)::int=2 THEN
                          CASE WHEN (SUBSTRING(data->>'dateAdministered',1,4)::int % 4=0
                                     AND (SUBSTRING(data->>'dateAdministered',1,4)::int % 100<>0
                                          OR SUBSTRING(data->>'dateAdministered',1,4)::int % 400=0))
                               THEN 29 ELSE 28 END
                        WHEN SUBSTRING(data->>'dateAdministered',6,2)::int IN (4,6,9,11) THEN 30
                        ELSE 31
                      END
                      THEN data->>'dateAdministered' ELSE NULL END
                  ELSE NULL END
                ELSE NULL END AS valid_administered_date
         FROM immunizations
       ), latest_by_vaccine AS (
         SELECT id,patient_id,data,created_at,
                ROW_NUMBER() OVER (
                  PARTITION BY patient_id,
                    CASE WHEN BTRIM(COALESCE(data->>'vaccineName','')) = ''
                         THEN 'legacy:' || id
                         ELSE LOWER(BTRIM(data->>'vaccineName')) END
                  ORDER BY valid_administered_date DESC NULLS LAST,
                           created_at DESC, id COLLATE "C" DESC
                ) AS vaccine_rank
         FROM immunization_dates
       )
       SELECT id,patient_id,data,created_at FROM latest_by_vaccine
       WHERE vaccine_rank=1
         AND data->>'nextDueDate' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
         AND data->>'nextDueDate' <= $1`,
      [horizon],
    ),
    queryFn(
      `SELECT patient_id,COUNT(*)::int AS count FROM visits
       WHERE created_at >= NOW()-INTERVAL '90 days'
       GROUP BY patient_id HAVING COUNT(*) >= 3`,
    ),
    queryFn(
      `SELECT id,data FROM patients
       WHERE data->>'consentStatus'='pending'
         AND data->>'consentDueDate' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
         AND data->>'consentDueDate' <= $1
       ORDER BY data->>'consentDueDate' LIMIT 500`,
      [horizon],
    ),
  ]);

  const followUps = followUpResult.rows.filter((visit) => (
    (visit.data?.followUp === true || visit.data?.followUp === 'true')
    && isoDate(visit.data?.followUpDate)
    && visit.data.followUpDate <= horizon
  ));
  const latestImmunizations = latestImmunizationsByStudentVaccine(immunizationResult.rows.map((record) => ({
    ...record,
    ...record.data,
    id: record.id,
    patientId: record.patient_id,
    createdAt: record.created_at instanceof Date ? record.created_at.toISOString() : record.created_at,
  })));
  const immunizations = latestImmunizations.filter((record) => (
    isoDate(record.data?.nextDueDate)
    && record.data.nextDueDate <= horizon
  ));
  const pendingConsents = consentResult.rows.filter((patient) => (
    patient.data?.consentStatus === 'pending'
    && isoDate(patient.data?.consentDueDate)
    && patient.data.consentDueDate <= horizon
  ));
  let notificationFailures = 0;
  const notifySafely = async (patientId, notification, label) => {
    try {
      await notifyPatient(patientId, notification);
    } catch (error) {
      notificationFailures += 1;
      logger.error(`${label} reminder failed.`, { code: error.code || 'DELIVERY_ERROR' });
    }
  };

  for (const visit of followUps) {
    const dueDate = visit.data.followUpDate;
    await notifySafely(visit.patient_id, {
      type: 'follow_up_reminder',
      subject: 'Follow-up reminder',
      body: `A clinic follow-up is scheduled for ${dueDate}. Sign in to view the authorized details.`,
      dedupeKey: `follow-up:${visit.id}:${dueDate}`,
    }, 'Follow-up');
  }
  for (const immunization of immunizations) {
    const dueDate = immunization.data.nextDueDate;
    const vaccineName = String(immunization.data.vaccineName || 'A recorded vaccine dose');
    await notifySafely(immunization.patient_id, {
      type: 'immunization_reminder',
      subject: 'Vaccine due date reminder',
      body: `A vaccine dose has a recorded due date of ${dueDate}. Sign in to view the authorized details.`,
      dedupeKey: `immunization-reminder:${immunization.patient_id}:${vaccineName.toLocaleLowerCase()}:${dueDate}`,
    }, 'Immunization');
  }
  const recurringMonth = today.slice(0, 7);
  for (const patient of recurringResult.rows) {
    await notifySafely(patient.patient_id, {
      type: 'recurring_visit_reminder',
      subject: 'Clinic review reminder',
      body: 'A clinic review reminder is available. Sign in to view the details you are authorized to access.',
      dedupeKey: `recurring-visits:${patient.patient_id}:${recurringMonth}`,
    }, 'Recurring visit');
  }
  for (const patient of pendingConsents) {
    const dueDate = patient.data.consentDueDate;
    const dueWording = dueDate < today ? 'was due on' : 'is due on';
    await notifySafely(patient.id, {
      type: 'consent_reminder',
      subject: 'Consent form reminder',
      body: `A consent form ${dueWording} ${dueDate}. Sign in to view information for your linked student.`,
      dedupeKey: `consent-reminder:${patient.id}:${dueDate}`,
    }, 'Consent');
  }

  const followUpCount = followUps.length;
  const immunizationCount = immunizations.length;
  const recurringCount = recurringResult.rows.length;
  const consentCount = pendingConsents.length;
  return {
    triggered: followUpCount + immunizationCount + recurringCount + consentCount,
    followUps: followUpCount,
    immunizations: immunizationCount,
    recurring: recurringCount,
    consents: consentCount,
    notificationFailures,
    today,
    horizon,
  };
}
