CREATE TABLE IF NOT EXISTS guardian_health_record_drafts (
  id UUID PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  guardian_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  school_year VARCHAR(40) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (patient_id, guardian_user_id, school_year)
);

CREATE TABLE IF NOT EXISTS health_record_submissions (
  id UUID PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  guardian_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  school_year VARCHAR(40) NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  source VARCHAR(20) NOT NULL CHECK (source IN ('guardian', 'paper')),
  status VARCHAR(30) NOT NULL CHECK (status IN ('pending_review', 'changes_requested', 'accepted', 'superseded')),
  payload JSONB NOT NULL,
  draft_version INTEGER,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  guardian_attested_at TIMESTAMPTZ,
  attestation_text TEXT,
  paper_signature_presence JSONB NOT NULL DEFAULT '{}'::jsonb,
  documents_received JSONB NOT NULL DEFAULT '{"psychiatricEvaluation":false,"diagnosticAssessment":false,"medicationRecords":false}'::jsonb,
  nurse_reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  nurse_reviewed_at TIMESTAMPTZ,
  nurse_notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (patient_id, school_year, revision),
  UNIQUE (patient_id, school_year, guardian_user_id, draft_version)
);
CREATE INDEX IF NOT EXISTS health_record_submissions_review_idx
  ON health_record_submissions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS health_record_submissions_patient_idx
  ON health_record_submissions(patient_id, school_year, revision DESC);

-- Student patient rows remain available to staff, but students no longer authenticate.
WITH disabled_accounts AS (
  UPDATE users
  SET status='deactivated',updated_at=NOW()
  WHERE role='student' AND status <> 'deactivated'
  RETURNING id,email
)
INSERT INTO audit_logs(actor_user_id,event,subject_type,subject_id,details)
SELECT NULL,'STUDENT_ACCOUNT_DEACTIVATED','user',id::text,
       jsonb_build_object('reason','guardian_led_health_record_transition','email',email)
FROM disabled_accounts;

UPDATE patients SET user_id=NULL,updated_at=NOW()
WHERE user_id IN (SELECT id FROM users WHERE role='student');
DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE role='student');
WITH invalidated_invitations AS (
  UPDATE invitations
  SET accepted_at=NOW()
  WHERE role='student' AND accepted_at IS NULL
  RETURNING id,email
)
INSERT INTO audit_logs(actor_user_id,event,subject_type,subject_id,details)
SELECT NULL,'STUDENT_INVITATION_INVALIDATED','invitation',id::text,
       jsonb_build_object('reason','guardian_led_health_record_transition','email',email)
FROM invalidated_invitations;
