const CLINIC_TIME_ZONE = 'Asia/Manila';

function boundedText(value, maxLength, { required = false } = {}) {
  if (typeof value !== 'string') return required ? null : '';
  const normalized = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  if ((required && !normalized) || normalized.length > maxLength) return null;
  return normalized;
}

function validUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function validateClinicArrivalPayload(payload = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { valid: false, fields: { patientId: 'Select a student and try again.', eventId: 'A valid request id is required.' } };
  }
  const patientId = typeof payload.patientId === 'string' && !/[\u0000-\u001f\u007f]/.test(payload.patientId)
    ? boundedText(payload.patientId, 120, { required: true })
    : null;
  const eventId = payload.eventId;
  const fields = {};
  if (!patientId) fields.patientId = 'Select a valid student record.';
  if (!validUuid(eventId)) fields.eventId = 'A valid request id is required.';
  if (Object.keys(fields).length) return { valid: false, fields };
  return { valid: true, value: { patientId, eventId } };
}

export function formatClinicDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return 'time unavailable';
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: CLINIC_TIME_ZONE,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function clinicArrivalNotice({ studentName, clinicName, occurredAt }) {
  const safeName = boundedText(String(studentName || ''), 160, { required: true }) || 'Student';
  const safeClinicName = boundedText(String(clinicName || ''), 160, { required: true }) || 'Campus Clinic';
  return {
    type: 'clinic_arrival',
    subject: 'Student arrival at the clinic',
    body: `${safeName} arrived at ${safeClinicName} on ${formatClinicDateTime(occurredAt)}. For questions or relevant information, contact the school clinic through the usual school contact channel.`,
  };
}

function visitDateTime(visit) {
  if (visit.createdAt) {
    const formatted = formatClinicDateTime(visit.createdAt);
    if (formatted !== 'time unavailable') return formatted;
  }
  const date = boundedText(String(visit.date || ''), 40) || 'date unavailable';
  const time = boundedText(String(visit.time || ''), 40);
  return time ? `${date} at ${time}` : date;
}

export function clinicVisitCareSummary({ studentName, visit }) {
  const name = boundedText(String(studentName || ''), 160, { required: true }) || 'Student';
  const reason = boundedText(String(visit?.chiefComplaint || ''), 300) || 'Not recorded';
  const care = boundedText(String(visit?.treatment || ''), 300) || 'Not recorded';
  const disposition = boundedText(String(visit?.disposition || ''), 120) || 'Not recorded';
  const followUp = visit?.followUp
    ? `Scheduled${visit.followUpDate ? ` for ${boundedText(String(visit.followUpDate), 10) || 'a later date'}` : ''}.`
    : 'None scheduled.';
  return {
    type: 'clinic_visit',
    subject: 'Clinic visit care summary',
    body: [
      `Student: ${name}`,
      `Visit date and time: ${visitDateTime(visit || {})}`,
      `Reason reported: ${reason}`,
      `Care provided: ${care}`,
      `Disposition: ${disposition}`,
      `Follow-up: ${followUp}`,
    ].join('\n'),
  };
}

export async function recordClinicArrival({ transaction, patientId, eventId, userId }) {
  return transaction(async (client) => {
    const prior = await client.query(
      'SELECT id,patient_id,occurred_at FROM clinic_arrivals WHERE id=$1 FOR SHARE',
      [eventId],
    );
    if (prior.rowCount) {
      if (String(prior.rows[0].patient_id) !== String(patientId)) return { status: 'conflict' };
      return { status: 'existing', arrival: prior.rows[0] };
    }

    const patient = await client.query(
      'SELECT id,patient_type,data FROM patients WHERE id=$1 FOR SHARE',
      [patientId],
    );
    if (!patient.rowCount) return { status: 'not_found' };
    if (patient.rows[0].patient_type !== 'student') return { status: 'not_student' };

    const inserted = await client.query(
      `INSERT INTO clinic_arrivals(id,patient_id,created_by)
       VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING
       RETURNING id,patient_id,occurred_at`,
      [eventId, patientId, userId],
    );
    if (inserted.rowCount) return { status: 'created', arrival: inserted.rows[0], patient: patient.rows[0] };

    // A concurrent retry may have inserted the same UUID after our first read.
    const concurrent = await client.query(
      'SELECT id,patient_id,occurred_at FROM clinic_arrivals WHERE id=$1 FOR SHARE',
      [eventId],
    );
    if (!concurrent.rowCount) throw new Error('Arrival event could not be read after a duplicate insert.');
    if (String(concurrent.rows[0].patient_id) !== String(patientId)) return { status: 'conflict' };
    return { status: 'existing', arrival: concurrent.rows[0] };
  });
}

export function notificationDeliveryCounts(statuses, recipientCount = statuses.length) {
  const emailSentCount = statuses.filter((status) => status === 'sent').length;
  const emailFailedCount = statuses.filter((status) => status === 'failed').length;
  const emailPendingCount = Math.max(0, recipientCount - emailSentCount - emailFailedCount);
  return {
    recipientCount,
    emailSentCount,
    emailFailedCount,
    emailPendingCount,
    deliveryPending: emailPendingCount > 0,
  };
}
