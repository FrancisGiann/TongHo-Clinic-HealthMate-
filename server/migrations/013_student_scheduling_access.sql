CREATE TABLE IF NOT EXISTS guardian_student_scheduling_permissions (
  patient_id TEXT PRIMARY KEY REFERENCES patients(id) ON DELETE CASCADE,
  guardian_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  allowed BOOLEAN NOT NULL DEFAULT FALSE,
  granted_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS guardian_student_scheduling_patient_idx
  ON guardian_student_scheduling_permissions(patient_id, allowed, guardian_user_id);

-- Student identities created by older releases are not grandfathered into access.
-- They remain attached to their roster records but require a fresh authorized invite.
UPDATE users SET status='deactivated',updated_at=NOW()
WHERE role='student' AND status<>'deactivated';
DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE role='student');
UPDATE invitations SET expires_at=LEAST(expires_at,NOW())
WHERE role='student' AND accepted_at IS NULL;
