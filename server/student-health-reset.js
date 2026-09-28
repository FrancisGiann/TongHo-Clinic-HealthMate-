const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export function studentResetTargetFingerprint(databaseUrl) {
  try {
    const url = new URL(databaseUrl);
    const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ''));
    return `${url.host.toLowerCase()}/${databaseName}`;
  } catch {
    return null;
  }
}

export function disposableStudentResetTargetAllowed(databaseUrl, env = process.env) {
  if (!databaseUrl) return false;
  try {
    const url = new URL(databaseUrl);
    const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ''));
    const isDisposable = env.HEALTHMATE_RESET_DISPOSABLE === 'true'
      && LOCAL_HOSTS.has(url.hostname.toLowerCase())
      && /^(healthmate|hm)[-_a-z0-9]*(disposable|reset)$/i.test(databaseName);
    let allowlisted = false;
    try {
      const allowlist = JSON.parse(env.HEALTHMATE_RESET_ALLOWED_TARGETS || '[]');
      allowlisted = Array.isArray(allowlist) && allowlist.includes(studentResetTargetFingerprint(databaseUrl));
    } catch {
      allowlisted = false;
    }
    return isDisposable || allowlisted;
  } catch {
    return false;
  }
}

export function validateStudentResetArguments(args = [], env = process.env, databaseUrl = env.DATABASE_URL) {
  const allowed = new Set(['--apply', '--dry-run', '--backup-confirmed']);
  if (args.some((argument) => !allowed.has(argument))) return { valid: false, error: 'Use --dry-run (default), or --apply --backup-confirmed.' };
  if (args.includes('--apply') && args.includes('--dry-run')) return { valid: false, error: 'Choose either --dry-run or --apply.' };
  if (!disposableStudentResetTargetAllowed(databaseUrl, env)) {
    return { valid: false, error: 'Student health reset is limited to a local database named with a healthmate/hm prefix and reset/disposable suffix, with HEALTHMATE_RESET_DISPOSABLE=true.' };
  }
  if (args.includes('--apply') && (!args.includes('--backup-confirmed') || !String(env.HEALTHMATE_RESET_BACKUP_REFERENCE || '').trim())) {
    return { valid: false, error: 'Apply requires --backup-confirmed and HEALTHMATE_RESET_BACKUP_REFERENCE naming the verified backup.' };
  }
  return { valid: true, apply: args.includes('--apply') };
}

export async function inspectStudentHealthReset(client) {
  const result = await client.query(`
    WITH student_patients AS (SELECT id FROM patients WHERE patient_type='student'),
    linked_guardians AS (
      SELECT DISTINCT guardian_user_id AS id FROM guardian_patient_links WHERE patient_id IN (SELECT id FROM student_patients)
    )
    SELECT
      (SELECT COUNT(*)::int FROM student_patients) AS students,
      (SELECT COUNT(*)::int FROM linked_guardians) AS linked_guardians,
      (SELECT COUNT(*)::int FROM visits WHERE patient_id IN (SELECT id FROM student_patients)) AS visits,
      (SELECT COUNT(*)::int FROM appointments WHERE patient_id IN (SELECT id FROM student_patients)) AS appointments,
      (SELECT COUNT(*)::int FROM queue_entries WHERE patient_id IN (SELECT id FROM student_patients)) AS queue_entries,
      (SELECT COUNT(*)::int FROM screenings WHERE patient_id IN (SELECT id FROM student_patients)) AS screenings,
      (SELECT COUNT(*)::int FROM immunizations WHERE patient_id IN (SELECT id FROM student_patients)) AS immunizations,
      (SELECT COUNT(*)::int FROM incidents WHERE patient_id IN (SELECT id FROM student_patients)) AS incidents,
      (SELECT COUNT(*)::int FROM risk_assessments WHERE visit_id IN (SELECT id FROM visits WHERE patient_id IN (SELECT id FROM student_patients))) AS risk_assessments,
      (SELECT COUNT(*)::int FROM dispense_logs WHERE visit_id IN (SELECT id FROM visits WHERE patient_id IN (SELECT id FROM student_patients))) AS dispense_logs,
      (SELECT COUNT(*)::int FROM guardian_health_record_drafts WHERE patient_id IN (SELECT id FROM student_patients)) AS health_record_drafts,
      (SELECT COUNT(*)::int FROM health_record_submissions WHERE patient_id IN (SELECT id FROM student_patients)) AS health_record_submissions,
      (SELECT COUNT(*)::int FROM import_batch_items WHERE (entity_type='patient' AND entity_id IN (SELECT id FROM student_patients))
        OR (entity_type='visit' AND entity_id IN (SELECT id FROM visits WHERE patient_id IN (SELECT id FROM student_patients)))) AS import_batch_items,
      (SELECT COUNT(*)::int FROM report_snapshots) AS report_snapshots,
      (SELECT COUNT(*)::int FROM notifications WHERE metadata->>'patientId' IN (SELECT id FROM student_patients)
        OR user_id IN (SELECT id FROM users WHERE role='student')) AS stale_notifications
  `);
  return result.rows[0];
}

export async function applyStudentHealthReset(client) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext('healthmate_student_health_reset'))");
  const priorReset = await client.query("SELECT id FROM audit_logs WHERE event='STUDENT_HEALTH_DATA_RESET' LIMIT 1");
  if (priorReset.rowCount) {
    const error = new Error('A student health data reset has already been recorded for this database.');
    error.code = 'RESET_ALREADY_APPLIED';
    throw error;
  }
  await client.query('LOCK TABLE patients IN SHARE ROW EXCLUSIVE MODE');
  const patientResult = await client.query("SELECT id FROM patients WHERE patient_type='student' FOR UPDATE");
  const patientIds = patientResult.rows.map((row) => String(row.id));

  const guardianResult = await client.query(
    'SELECT DISTINCT guardian_user_id AS id FROM guardian_patient_links WHERE patient_id=ANY($1::text[])',
    [patientIds],
  );
  const guardianIds = guardianResult.rows.map((row) => row.id);

  await client.query(
    `UPDATE invitations SET accepted_at=COALESCE(accepted_at,NOW())
     WHERE accepted_at IS NULL AND role='guardian' AND patient_id=ANY($1::text[])`,
    [patientIds],
  );
  if (guardianIds.length) {
    await client.query("UPDATE users SET status='suspended',updated_at=NOW() WHERE id=ANY($1::uuid[]) AND role='guardian'", [guardianIds]);
    await client.query('DELETE FROM sessions WHERE user_id=ANY($1::uuid[])', [guardianIds]);
  }
  await client.query("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE role='student')");
  await client.query(
    `DELETE FROM notifications WHERE metadata->>'patientId'=ANY($1::text[])
       OR user_id IN (SELECT id FROM users WHERE role='student')`,
    [patientIds],
  );
  await client.query('DELETE FROM report_snapshots');
  await client.query(
    `DELETE FROM import_batch_items
     WHERE (entity_type='patient' AND entity_id=ANY($1::text[]))
        OR (entity_type='visit' AND entity_id IN (SELECT id FROM visits WHERE patient_id=ANY($1::text[])))`,
    [patientIds],
  );
  await client.query('DELETE FROM dispense_logs WHERE visit_id IN (SELECT id FROM visits WHERE patient_id=ANY($1::text[]))', [patientIds]);
  await client.query('DELETE FROM patients WHERE id=ANY($1::text[])', [patientIds]);
  const summary = { deletedStudents: patientIds.length, suspendedGuardians: guardianIds.length };
  await client.query(
    `INSERT INTO audit_logs(actor_user_id,event,subject_type,subject_id,details)
     VALUES(NULL,'STUDENT_HEALTH_DATA_RESET','system','student_health_reset',$1::jsonb)`,
    [JSON.stringify(summary)],
  );
  return summary;
}
