import crypto from 'node:crypto';
import { query, transaction } from './db.js';
import { normalizeRosterIdentifier, patientRosterIdentitySql, rosterIdTrimCharacters } from './domain/roster.js';
import { publicVisitRecord } from './domain/visitRequests.js';
import { isStudentGradeLevel } from '../shared/grades.js';

const collectionMap = {
  visits: { table: 'visits', patient: true },
  appointments: { table: 'appointments', patient: true },
  inventory: { table: 'inventory_items', staffOnly: true },
  dispenseLogs: { table: 'dispense_logs', staffOnly: true },
  stockAdjustments: { table: 'stock_adjustments', staffOnly: true },
};

const staffRoles = new Set(['school_nurse', 'system_administrator']);
const clinicalCollections = new Set(['visits', 'appointments', 'dispenseLogs', 'stockAdjustments']);
const adminRestrictedCollections = new Set([...clinicalCollections, 'inventory']);
const snapshotWritableCollections = [];
const guardianPatientFields = [
  'patientType', 'studentId', 'name', 'gradeLevel', 'section', 'birthDate', 'gender',
  'motherName', 'fatherName', 'guardianName', 'guardianPhone', 'guardianRelation',
  'bloodType', 'allergies', 'allergiesStatus', 'conditions', 'conditionsStatus', 'medications', 'medicationsStatus', 'pastIllness', 'presentIllness',
  'hospitalizationHistory', 'hospitalizationDetails', 'g6pdDeficiency', 'medicationAtHome',
  'takingRegularMedication', 'regularMedicationName', 'onTherapy', 'lastTreatmentDate',
  'therapistName', 'therapyInterventions', 'hasConcerns', 'concernsDetails', 'documentsSubmitted', 'documentsReceived', 'guardianHealthRecord',
];
const administratorPatientFields = [
  'patientType', 'studentId', 'facultyId', 'name', 'gradeLevel', 'section', 'adviser', 'department', 'position', 'email', 'contactNumber', 'birthDate', 'gender', 'guardianName', 'guardianPhone', 'guardianRelation',
];
const studentRosterFields = ['studentId', 'name', 'gradeLevel', 'section', 'adviser'];
function rosterError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function rosterIdentity(record, patientType) {
  const studentId = normalizeRosterIdentifier(record.studentId);
  const facultyId = normalizeRosterIdentifier(record.facultyId);
  return patientType === 'faculty' ? facultyId || studentId : studentId;
}

function sameRosterValue(field, current, next) {
  return Object.is(current?.[field] ?? '', next?.[field] ?? '');
}

function validateChangedStudentRoster(record) {
  const values = {};
  for (const [field, maxLength] of Object.entries({ studentId: 80, name: 160, gradeLevel: 40, section: 80, adviser: 160 })) {
    const value = record[field] ?? '';
    if (typeof value !== 'string') {
      throw rosterError(400, 'VALIDATION_ERROR', `${field} must be text.`);
    }
    values[field] = value.trim();
    if (values[field].length > maxLength) {
      throw rosterError(400, 'VALIDATION_ERROR', `${field} must be ${maxLength} characters or fewer.`);
    }
  }
  if (!values.studentId) throw rosterError(400, 'VALIDATION_ERROR', 'Student ID is required.');
  if (!values.name) throw rosterError(400, 'VALIDATION_ERROR', 'Student name is required.');
  if (!values.gradeLevel) throw rosterError(400, 'VALIDATION_ERROR', 'Grade level is required.');
  if (!isStudentGradeLevel(values.gradeLevel)) {
    throw rosterError(400, 'VALIDATION_ERROR', 'Grade level must be Kindergarten or Grade 1 through Grade 10.');
  }
  Object.assign(record, values);
}

function validateChangedFacultyRoster(record) {
  for (const field of ['facultyId', 'studentId']) {
    if (record[field] !== undefined && record[field] !== null && typeof record[field] !== 'string') {
      throw rosterError(400, 'VALIDATION_ERROR', 'Faculty ID fields must be text.');
    }
  }
  if (typeof record.facultyId === 'string') record.facultyId = record.facultyId.trim();
  if (typeof record.studentId === 'string') record.studentId = record.studentId.trim();
  const identifierField = typeof record.facultyId === 'string' && record.facultyId.trim() ? 'facultyId' : 'studentId';
  const identifier = record[identifierField];
  const name = record.name ?? '';
  if (typeof identifier !== 'string' || !identifier.trim() || identifier.trim().length > 80) {
    throw rosterError(400, 'VALIDATION_ERROR', 'Faculty ID must be between 1 and 80 characters.');
  }
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 160) {
    throw rosterError(400, 'VALIDATION_ERROR', 'Faculty name must be between 1 and 160 characters.');
  }
  if (record.facultyId && record.studentId && record.facultyId.toLowerCase() !== record.studentId.toLowerCase()) {
    throw rosterError(400, 'VALIDATION_ERROR', 'Faculty ID fields must match.');
  }
  record[identifierField] = identifier.trim();
  record.name = name.trim();
}

export async function validateRosterSnapshot(client, records) {
  if (!records.length) return;
  const recordIds = new Set();
  const ids = [];
  const identityKeys = [];
  for (const record of records) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw rosterError(400, 'VALIDATION_ERROR', 'Each patient record must be an object.');
    }
    if (record.id !== undefined && record.id !== null && record.id !== '') {
      if (typeof record.id !== 'string' || !record.id.trim() || record.id.length > 120 || record.id !== record.id.trim()) {
        throw rosterError(400, 'VALIDATION_ERROR', 'Patient record IDs must be non-empty text of 120 characters or fewer.');
      }
      if (recordIds.has(record.id)) throw rosterError(409, 'DUPLICATE_RECORD', 'The snapshot contains the same patient record more than once.');
      recordIds.add(record.id);
      ids.push(record.id);
    }
    if (record.patientType !== undefined && !['student', 'faculty'].includes(record.patientType)) {
      throw rosterError(400, 'VALIDATION_ERROR', 'Patient type must be student or faculty.');
    }
    for (const field of ['studentId', 'facultyId']) {
      const identity = normalizeRosterIdentifier(record[field]);
      if (identity) identityKeys.push(identity);
    }
  }

  const persisted = await client.query(
    `SELECT id,patient_type,data FROM patients
     WHERE id=ANY($1::text[])
        OR LOWER(${patientRosterIdentitySql(3)})=ANY($2::text[])`,
    [ids, [...new Set(identityKeys)], rosterIdTrimCharacters],
  );
  const existingById = new Map(persisted.rows.map((row) => [String(row.id), row]));
  const duplicateCandidates = new Map();
  const changedEntries = [];

  for (const record of records) {
    const existing = record.id ? existingById.get(record.id) : null;
    const currentType = existing?.patient_type || null;
    const patientType = record.patientType || currentType || 'student';
    if (currentType && patientType !== currentType) {
      throw rosterError(400, 'VALIDATION_ERROR', 'A patient record cannot change between student and faculty.');
    }
    record.patientType = patientType;

    const identity = rosterIdentity(record, patientType);
    const rosterChanged = !existing || (patientType === 'student'
      ? studentRosterFields.some((field) => !sameRosterValue(field, existing.data || {}, record))
      : ['facultyId', 'studentId', 'name'].some((field) => !sameRosterValue(field, existing.data || {}, record)));
    if (!identity) {
      if (patientType === 'student' && rosterChanged) validateChangedStudentRoster(record);
      if (patientType === 'faculty' && rosterChanged) validateChangedFacultyRoster(record);
      continue;
    }

    const currentIdentity = existing ? rosterIdentity(existing.data || {}, currentType) : '';
    const identityChanged = !existing || identity !== currentIdentity;
    if (patientType === 'student' && rosterChanged) validateChangedStudentRoster(record);
    if (patientType === 'faculty' && rosterChanged) validateChangedFacultyRoster(record);
    if (identityChanged) {
      const previous = duplicateCandidates.get(identity);
      if (previous && previous !== record) throw rosterError(409, 'DUPLICATE_RECORD', 'A student or faculty ID is repeated in the submitted snapshot.');
      duplicateCandidates.set(identity, record);
      changedEntries.push({ record, identity, existing });
    }
  }

  for (const { record, identity, existing } of changedEntries) {
    const collision = persisted.rows.find((row) => {
      if (String(row.id) === String(existing?.id || record.id || '')) return false;
      const rowIdentity = rosterIdentity(row.data || {}, row.patient_type);
      return rowIdentity === identity;
    });
    if (collision) throw rosterError(409, 'DUPLICATE_RECORD', 'A student or faculty record already uses this ID.');
  }
}

function recordId(record) {
  const value = record?.id;
  if (value === undefined || value === null || value === '') {
    const generated = crypto.randomUUID();
    record.id = generated;
    return generated;
  }
  return String(value);
}

function patientId(record) {
  return String(record?.patientId ?? record?.studentId ?? record?.student?.id ?? '');
}

function timestampValue(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.valueOf()) ? value : parsed.toISOString();
  }
  return value || null;
}

export function studentRecordForUser(record, user) {
  if (user.role === 'school_nurse') return { ...record, id: record.id };
  if (user.role === 'guardian') {
    return { id: record.id, ...Object.fromEntries(guardianPatientFields.filter((field) => record[field] !== undefined).map((field) => [field, record[field]])) };
  }
  return { id: record.id, ...Object.fromEntries(administratorPatientFields.filter((field) => record[field] !== undefined).map((field) => [field, record[field]])) };
}

export function hydrateAuthoritativeRecord(key, row) {
  const record = row.data || {};
  if (key === 'appointments') {
    return {
      ...record,
      id: row.id,
      patientId: row.patient_id,
      startsAt: timestampValue(row.starts_at),
      status: row.status,
      createdAt: timestampValue(row.created_at),
      updatedAt: timestampValue(row.updated_at),
    };
  }
  if (key === 'inventory') {
    return { ...record, id: row.id, quantity: row.quantity };
  }
  return record;
}

async function accessiblePatientIds(user, client = { query }) {
  if (staffRoles.has(user.role)) return null;
  if (user.role !== 'guardian') return [];
  const result = await client.query(
    `SELECT l.patient_id AS id FROM guardian_patient_links l JOIN patients p ON p.id=l.patient_id
     WHERE l.guardian_user_id=$1 AND p.patient_type='student'`,
    [user.id],
  );
  return result.rows.map((row) => String(row.id));
}

function patientDataProjection(fieldParameter) {
  return `(SELECT COALESCE(jsonb_object_agg(allowed_patient_field.key,patients.data->allowed_patient_field.key),'{}'::jsonb)
          FROM unnest($${fieldParameter}::text[]) AS allowed_patient_field(key)
          WHERE patients.data ? allowed_patient_field.key)`;
}

function clinicDataReadQuery(user, ids, includeClinical) {
  const params = [];
  const patientFields = user.role === 'guardian'
    ? guardianPatientFields
    : user.role === 'system_administrator' ? administratorPatientFields : null;
  const patientIdsParameter = ids === null ? null : (params.push(ids), `$${params.length}::text[]`);
  const fieldParameter = patientFields ? (params.push(patientFields), params.length) : null;
  const patientData = patientFields ? patientDataProjection(fieldParameter) : 'patients.data';
  const patientScope = patientIdsParameter ? ` WHERE patients.id=ANY(${patientIdsParameter})` : '';
  const columns = [
    `COALESCE((SELECT data FROM clinic_settings WHERE id=1),'{}'::jsonb) AS settings`,
    `COALESCE((SELECT version FROM clinic_settings WHERE id=1),1) AS version`,
    `COALESCE((SELECT jsonb_agg(jsonb_build_object('id',patients.id,'patient_type',patients.patient_type,'data',${patientData}) ORDER BY patients.created_at) FROM patients${patientScope}),'[]'::jsonb) AS students`,
  ];
  const staff = staffRoles.has(user.role);
  for (const [key, config] of Object.entries(collectionMap)) {
    if (user.role === 'system_administrator' && adminRestrictedCollections.has(key) && !includeClinical) continue;
    if (config.staffOnly && !staff) continue;
    const scope = config.patient && patientIdsParameter ? ` WHERE patient_id=ANY(${patientIdsParameter})` : '';
    const column = `"${key}"`;
    if (key === 'appointments') {
      columns.push(`COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'patient_id',patient_id,'status',status,'starts_at',starts_at,'created_at',created_at,'updated_at',updated_at,'data',data) ORDER BY created_at) FROM ${config.table}${scope}),'[]'::jsonb) AS ${column}`);
    } else if (key === 'inventory') {
      columns.push(`COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'quantity',quantity,'data',data) ORDER BY created_at) FROM ${config.table}),'[]'::jsonb) AS ${column}`);
    } else {
      columns.push(`COALESCE((SELECT jsonb_agg(jsonb_build_object('data',data) ORDER BY created_at) FROM ${config.table}${scope}),'[]'::jsonb) AS ${column}`);
    }
  }
  return { sql: `SELECT ${columns.join(',\n       ')}`, params };
}

export async function loadClinicData(user, { includeClinical = false, queryFn = query } = {}) {
  const ids = await accessiblePatientIds(user, { query: queryFn });
  const { sql, params } = clinicDataReadQuery(user, ids, includeClinical);
  const result = await queryFn(sql, params);
  const recordGroups = result.rows[0] || {};
  const data = {
    schemaVersion: recordGroups.version || 1,
    settings: recordGroups.settings || {},
    students: (recordGroups.students || []).map((row) => studentRecordForUser({ ...row.data, id: row.id, patientType: row.patient_type }, user)),
  };

  for (const key of Object.keys(collectionMap)) {
    data[key] = (recordGroups[key] || []).map((row) => key === 'appointments' || key === 'inventory'
      ? hydrateAuthoritativeRecord(key, row)
      : key === 'visits' ? publicVisitRecord(row.data) : row.data);
  }
  return data;
}

function appointmentTimestamp(appointment) {
  const value = appointment.startsAt || (appointment.date
    ? `${appointment.date}T${appointment.time || '00:00'}+08:00`
    : '');
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function manilaDateKey(value) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function manilaTimeKey(value) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(value).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${parts.hour}:${parts.minute}:${parts.second}.${String(value.getMilliseconds()).padStart(3, '0')}`;
}

export async function loadNurseDashboardData({ queryFn = query, now = new Date() } = {}) {
  const currentTime = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(currentTime)) throw new Error('A valid dashboard reference time is required.');
  const today = manilaDateKey(new Date(currentTime));
  const tomorrowStart = Date.parse(`${today}T00:00:00+08:00`) + 24 * 60 * 60 * 1000;
  const todayTime = manilaTimeKey(new Date(currentTime));
  const result = await queryFn(`
    SELECT
      COALESCE((SELECT jsonb_build_object(
        'schoolYear', data->'schoolYear', 'nurseName', data->'nurseName'
      ) FROM clinic_settings WHERE id=1), '{}'::jsonb) AS settings,
      COALESCE((SELECT COUNT(*)::int FROM appointments WHERE status IN ('Requested','Pending')), 0) AS appointment_request_count,
      COALESCE((
        SELECT COUNT(*)::int FROM appointments
        WHERE status='Scheduled' AND (
          starts_at >= $1
          OR (starts_at IS NULL AND (
            (data->>'date' > $3
              AND data->>'date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
              AND COALESCE(NULLIF(btrim(data->>'time'),''),'00:00') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
            OR (data->>'date'=$3
              AND COALESCE(NULLIF(btrim(data->>'time'),''),'00:00') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
              AND (COALESCE(NULLIF(btrim(data->>'time'),''),'00:00') || ':00.000') >= $4)
          ))
        )
      ), 0) AS upcoming_appointment_count,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', today.id, 'patient_id', today.patient_id, 'status', today.status,
          'starts_at', today.starts_at, 'date', today.data->'date',
          'time', COALESCE(NULLIF(btrim(today.data->>'time'),''),'00:00'),
          'reason', today.data->'reason', 'patient_name', p.data->'name'
        ) ORDER BY today.sort_time, today.created_at)
        FROM (
          SELECT candidates.*
          FROM (
            SELECT a.id, a.patient_id, a.status, a.starts_at, a.data, a.created_at,
              to_char(a.starts_at AT TIME ZONE 'Asia/Manila','HH24:MI:SS.MS') AS sort_time
            FROM appointments a
            WHERE a.status='Scheduled' AND a.starts_at >= $1 AND a.starts_at < $2
            UNION ALL
            SELECT a.id, a.patient_id, a.status, a.starts_at, a.data, a.created_at,
              COALESCE(NULLIF(btrim(a.data->>'time'),''),'00:00') || ':00.000' AS sort_time
            FROM appointments a
            WHERE a.status='Scheduled' AND a.starts_at IS NULL
              AND a.data->>'date'=$3
              AND COALESCE(NULLIF(btrim(a.data->>'time'),''),'00:00') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
              AND (COALESCE(NULLIF(btrim(a.data->>'time'),''),'00:00') || ':00.000') >= $4
          ) candidates
          ORDER BY candidates.sort_time, candidates.created_at
          LIMIT 4
        ) today
        LEFT JOIN patients p ON p.id=today.patient_id
      ), '[]'::jsonb) AS scheduled_appointments,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', recent.id, 'patient_id', recent.patient_id,
          'created_at', recent.created_at, 'date', recent.data->'date',
          'time', recent.data->'time', 'chief_complaint', recent.data->'chiefComplaint',
          'type', recent.data->'type', 'disposition', recent.data->'disposition',
          'patient_name', p.data->'name'
        ) ORDER BY recent.sort_date DESC, recent.created_at ASC)
        FROM (
          SELECT id, patient_id, data, created_at,
            COALESCE(NULLIF(data->>'date',''), NULLIF(data->>'createdAt',''), '2000-01-01T00:00:00.000Z') AS sort_date
          FROM visits
          ORDER BY COALESCE(NULLIF(data->>'date',''), NULLIF(data->>'createdAt',''), '2000-01-01T00:00:00.000Z') DESC,
            created_at ASC
          LIMIT 4
        ) recent
        LEFT JOIN patients p ON p.id=recent.patient_id
      ), '[]'::jsonb) AS recent_visits,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', low_stock.id, 'quantity', low_stock.quantity,
          'name', low_stock.data->'name', 'unit', low_stock.data->'unit',
          'reorderLevel', low_stock.data->'reorderLevel'
        ) ORDER BY low_stock.created_at)
        FROM (
          SELECT id, quantity, data, created_at
          FROM inventory_items
          WHERE COALESCE(data->>'archived','false') <> 'true'
            AND quantity <= CASE
              WHEN length(btrim(COALESCE(data->>'reorderLevel',''))) <= 16
                AND btrim(COALESCE(data->>'reorderLevel','')) ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)$'
                THEN (btrim(data->>'reorderLevel'))::numeric
              ELSE NULL
            END
          ORDER BY created_at
          LIMIT 3
        ) low_stock
      ), '[]'::jsonb) AS inventory_alerts
  `, [new Date(currentTime), new Date(tomorrowStart), today, todayTime]);
  const row = result.rows[0] || {};
  const todayAppointments = (row.scheduled_appointments || [])
    .map((appointment) => {
      const normalized = {
        id: appointment.id,
        patientId: appointment.patient_id,
        startsAt: timestampValue(appointment.starts_at),
        status: appointment.status,
        date: appointment.date,
        time: appointment.time,
        reason: appointment.reason,
        patientName: appointment.patient_name,
      };
      return { appointment: normalized, timestamp: appointmentTimestamp(normalized) };
    })
    .filter(({ timestamp }) => timestamp !== null && timestamp >= currentTime)
    .sort((first, second) => first.timestamp - second.timestamp)
    .filter(({ timestamp }) => manilaDateKey(new Date(timestamp)) === today)
    .slice(0, 4);
  const recentVisits = (row.recent_visits || []).map((visit) => ({
    id: visit.id,
    patientId: visit.patient_id,
    createdAt: timestampValue(visit.created_at),
    date: visit.date,
    time: visit.time,
    chiefComplaint: visit.chief_complaint,
    type: visit.type,
    disposition: visit.disposition,
    patientName: visit.patient_name,
  }));
  const studentsById = new Map();
  for (const record of [...recentVisits, ...todayAppointments.map(({ appointment }) => appointment)]) {
    const id = String(record.patientId || '');
    const name = record.patientName;
    if (id && name) studentsById.set(id, { id, name });
  }

  return {
    settings: row.settings || {},
    students: [...studentsById.values()],
    dashboardSummary: {
      appointmentRequestCount: Number(row.appointment_request_count) || 0,
      upcomingAppointmentCount: Number(row.upcoming_appointment_count) || 0,
      todayAppointments,
      recentVisits,
      inventoryAlerts: row.inventory_alerts || [],
    },
  };
}

export function validateClinicDataPayload(nextData, expectedVersion, { internal = false } = {}) {
  if (!nextData || typeof nextData !== 'object' || !Array.isArray(nextData.students) || !nextData.settings || typeof nextData.settings !== 'object') {
    return { valid: false, message: 'Clinic data must include settings and a student collection.' };
  }
  if (!Number.isInteger(Number(expectedVersion)) || Number(expectedVersion) < 1) {
    return { valid: false, message: 'A current clinic data version is required.' };
  }
  const requiredCollections = internal ? Object.keys(collectionMap) : snapshotWritableCollections;
  const missing = requiredCollections.filter((key) => !Array.isArray(nextData[key]));
  if (missing.length) return { valid: false, message: `Clinic data is missing required collections: ${missing.join(', ')}.` };
  return { valid: true };
}

export async function advanceClinicDataVersion(client) {
  const result = await client.query(
    'UPDATE clinic_settings SET version=version+1,updated_at=NOW() WHERE id=1 RETURNING version',
  );
  if (!result.rowCount) throw new Error('Clinic data version row is missing.');
  return result.rows[0].version;
}

export async function validateVersionAfterAdvance(client, expectedVersion) {
  const expected = Number(expectedVersion);
  if (!Number.isInteger(expected) || expected < 1) {
    const error = new Error('A current clinic data version is required. Reload and try again.');
    error.status = 400;
    error.code = 'VERSION_REQUIRED';
    throw error;
  }
  const result = await client.query('SELECT version FROM clinic_settings WHERE id=1');
  const currentVersion = Number(result.rows[0]?.version || 1);
  if (currentVersion !== expected + 1) {
    const error = new Error('Clinic data changed in another session. Reload and try again.');
    error.status = 409;
    error.code = 'VERSION_CONFLICT';
    throw error;
  }
  return currentVersion;
}

export function clinicDataTransaction(work) {
  return transaction(async (client) => {
    // Acquire the snapshot lock before any table or advisory locks; rollback also rolls back this version bump.
    await advanceClinicDataVersion(client);
    return work(client);
  });
}

function validateSaveClinicData(nextData, user, expectedVersion, internal) {
  if (!internal && user.role !== 'school_nurse') {
    const error = new Error('Only school nurses can update clinical data.');
    error.status = 403;
    throw error;
  }
  const validation = validateClinicDataPayload(nextData, expectedVersion, { internal });
  if (!validation.valid) {
    const error = new Error(validation.message);
    error.status = 400;
    throw error;
  }
}

export async function syncPatients(client, records) {
  for (const record of records) {
    const id = recordId(record);
    const current = await client.query('SELECT data FROM patients WHERE id=$1 FOR UPDATE', [id]);
    const canonicalGuardianAnswers = current.rows[0]?.data?.guardianHealthRecord;
    const storedRecord = canonicalGuardianAnswers && typeof canonicalGuardianAnswers === 'object'
      ? { ...record, ...canonicalGuardianAnswers, guardianHealthRecord: canonicalGuardianAnswers }
      : record;
    await client.query(
      `INSERT INTO patients(id,patient_type,data) VALUES($1,$2,$3::jsonb - 'consentStatus' - 'consentDueDate')
       ON CONFLICT(id) DO UPDATE SET patient_type=EXCLUDED.patient_type,
         data=(EXCLUDED.data - 'consentStatus' - 'consentDueDate') || jsonb_strip_nulls(jsonb_build_object(
           'consentStatus',patients.data->'consentStatus',
           'consentDueDate',patients.data->'consentDueDate'
         )),updated_at=NOW()`,
      [id, record.patientType === 'faculty' ? 'faculty' : 'student', JSON.stringify(storedRecord)],
    );
  }
}

export async function syncCollection(client, key, records, actorId) {
  if (!collectionMap[key]) return;
  for (const record of records) {
    const id = recordId(record);
    const json = JSON.stringify(record);
    if (key === 'visits') {
      const table = collectionMap[key].table;
      const pid = patientId(record);
      if (!pid) throw new Error(`${key} record ${id} is missing a patient id.`);
      await client.query(
        `INSERT INTO ${table}(id,patient_id,data,created_by) VALUES($1,$2,$3::jsonb - '_requestFingerprint',$4)
         ON CONFLICT(id) DO UPDATE SET patient_id=EXCLUDED.patient_id,
           data=(EXCLUDED.data - '_requestFingerprint') || jsonb_strip_nulls(jsonb_build_object('_requestFingerprint',visits.data->'_requestFingerprint')),
           updated_at=NOW()`,
        [id, pid, json, actorId],
      );
    } else if (key === 'appointments') {
      const pid = patientId(record);
      if (!pid) throw new Error(`appointments record ${id} is missing a patient id.`);
      const startsAt = record.startsAt || (record.date ? `${record.date} ${record.time || '00:00'}` : null);
      await client.query(
        `INSERT INTO appointments(id,patient_id,starts_at,status,data,created_by) VALUES($1,$2,$3,$4,$5::jsonb,$6)
         ON CONFLICT(id) DO UPDATE SET patient_id=EXCLUDED.patient_id,starts_at=EXCLUDED.starts_at,status=EXCLUDED.status,data=EXCLUDED.data,updated_at=NOW()`,
        [id, pid, startsAt || null, record.status || 'Requested', json, actorId],
      );
    } else if (key === 'inventory') {
      const quantity = Number(record.quantity);
      if (!Number.isInteger(quantity) || quantity < 0) throw new Error(`Inventory item ${id} has an invalid quantity.`);
      await client.query(
        `INSERT INTO inventory_items(id,quantity,data) VALUES($1,$2,$3::jsonb)
         ON CONFLICT(id) DO UPDATE SET quantity=EXCLUDED.quantity,data=EXCLUDED.data,updated_at=NOW()`,
        [id, quantity, json],
      );
    } else if (key === 'dispenseLogs') {
      await client.query(
        `INSERT INTO dispense_logs(id,visit_id,inventory_item_id,quantity,data,created_by) VALUES($1,$2,$3,$4,$5::jsonb,$6)
         ON CONFLICT(id) DO UPDATE SET visit_id=EXCLUDED.visit_id,inventory_item_id=EXCLUDED.inventory_item_id,quantity=EXCLUDED.quantity,data=EXCLUDED.data`,
        [id, record.visitId ? String(record.visitId) : null, record.medicineId ? String(record.medicineId) : null, Number(record.quantity || 1), json, actorId],
      );
    } else if (key === 'stockAdjustments') {
      await client.query(
        `INSERT INTO stock_adjustments(id,inventory_item_id,quantity,data,created_by) VALUES($1,$2,$3,$4::jsonb,$5)
         ON CONFLICT(id) DO UPDATE SET inventory_item_id=EXCLUDED.inventory_item_id,quantity=EXCLUDED.quantity,data=EXCLUDED.data`,
        [id, record.medicineId ? String(record.medicineId) : null, Number(record.quantity || 0), json, actorId],
      );
    }
  }
}

export async function saveClinicDataInTransaction(client, nextData, user, expectedVersion, { internal = false } = {}) {
  validateSaveClinicData(nextData, user, expectedVersion, internal);
  const locked = await client.query('SELECT data, version FROM clinic_settings WHERE id=1 FOR UPDATE');
  const currentVersion = locked.rows[0]?.version || 1;
  const currentSettings = locked.rows[0]?.data || {};
  if (expectedVersion && Number(expectedVersion) !== currentVersion) {
    const error = new Error('Clinic data changed in another session. Reload and try again.');
    error.status = 409;
    error.code = 'VERSION_CONFLICT';
    throw error;
  }
  await validateRosterSnapshot(client, nextData.students);
  await syncPatients(client, nextData.students);
  const writableCollections = internal ? Object.keys(collectionMap) : snapshotWritableCollections;
  for (const key of writableCollections) await syncCollection(client, key, nextData[key], user.id);

  const settingsToSave = currentSettings;

  const result = await client.query(
    'UPDATE clinic_settings SET data=$1::jsonb,version=version+1,updated_at=NOW() WHERE id=1 RETURNING version',
    [JSON.stringify(settingsToSave)],
  );
  return result.rows[0].version;
}

export async function saveClinicData(nextData, user, expectedVersion, options = {}) {
  validateSaveClinicData(nextData, user, expectedVersion, options.internal || false);
  return transaction((client) => saveClinicDataInTransaction(client, nextData, user, expectedVersion, options));
}

export async function linkUserToPatient(userId, patientId, role, relationship = 'Guardian') {
  if (role === 'guardian') {
    return query(
      `INSERT INTO guardian_patient_links(guardian_user_id,patient_id,relationship) VALUES($1,$2,$3)
       ON CONFLICT(guardian_user_id,patient_id) DO UPDATE SET relationship=EXCLUDED.relationship`,
      [userId, String(patientId), relationship],
    );
  }
}

export async function listUsers() {
  const result = await query(
    `SELECT id,username,email,name,role,status,school_id,prc_license_number,prc_license_verified_at,prc_license_verified_by,contact_number,school_name,last_login_at,created_at,
            EXISTS(SELECT 1 FROM invitations i WHERE LOWER(i.email)=LOWER(users.email) AND i.accepted_at IS NOT NULL) AS invitation_accepted
     FROM users ORDER BY created_at DESC`,
  );
  return result.rows;
}
