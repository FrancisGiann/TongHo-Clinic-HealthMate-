CREATE TABLE IF NOT EXISTS guardian_signup_requests (
  id UUID PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  email VARCHAR(254) NOT NULL,
  username VARCHAR(80) NOT NULL,
  password_hash TEXT,
  student_id VARCHAR(80) NOT NULL,
  relationship VARCHAR(40) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review', 'approved', 'rejected')),
  decision_by UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  relationship_verified BOOLEAN NOT NULL DEFAULT FALSE,
  decision_reason VARCHAR(500) NOT NULL DEFAULT '',
  decision_email_status VARCHAR(20) NOT NULL DEFAULT 'not_sent'
    CHECK (decision_email_status IN ('not_sent', 'queued', 'sent', 'failed')),
  decision_email_attempted_at TIMESTAMPTZ,
  decision_email_error_code VARCHAR(60),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((status = 'pending_review' AND password_hash IS NOT NULL)
      OR (status <> 'pending_review' AND password_hash IS NULL)),
  CHECK (status <> 'approved' OR relationship_verified),
  CHECK (status <> 'rejected' OR length(trim(decision_reason)) > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS guardian_signup_pending_email_uidx
  ON guardian_signup_requests(LOWER(email)) WHERE status = 'pending_review';
CREATE UNIQUE INDEX IF NOT EXISTS guardian_signup_pending_username_uidx
  ON guardian_signup_requests(LOWER(username)) WHERE status = 'pending_review';
CREATE INDEX IF NOT EXISTS guardian_signup_review_idx
  ON guardian_signup_requests(status, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS appointment_unavailable_periods (
  id UUID PRIMARY KEY,
  clinic_date DATE NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  reason VARCHAR(500) NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_at > starts_at),
  CHECK (length(trim(reason)) BETWEEN 1 AND 500)
);
CREATE INDEX IF NOT EXISTS appointment_unavailable_date_idx
  ON appointment_unavailable_periods(clinic_date, starts_at, ends_at);

ALTER TABLE appointments ADD COLUMN IF NOT EXISTS decision_reason VARCHAR(500) NOT NULL DEFAULT '';
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS decided_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS student_incidents (
  id UUID PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  incident_date DATE NOT NULL,
  incident_time TIME NOT NULL,
  location VARCHAR(160) NOT NULL,
  description TEXT NOT NULL,
  action_taken TEXT NOT NULL DEFAULT '',
  visit_id TEXT REFERENCES visits(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (length(trim(location)) BETWEEN 1 AND 160),
  CHECK (length(trim(description)) BETWEEN 1 AND 5000),
  CHECK (length(action_taken) <= 5000)
);
CREATE INDEX IF NOT EXISTS student_incidents_patient_date_idx
  ON student_incidents(patient_id, incident_date DESC, incident_time DESC, id DESC);
CREATE INDEX IF NOT EXISTS student_incidents_date_idx
  ON student_incidents(incident_date DESC, incident_time DESC, id DESC);

CREATE TABLE IF NOT EXISTS incident_photo_consent_events (
  id UUID PRIMARY KEY,
  incident_id UUID NOT NULL REFERENCES student_incidents(id) ON DELETE CASCADE,
  guardian_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  event_type VARCHAR(20) NOT NULL CHECK (event_type IN ('requested', 'granted', 'declined', 'revoked')),
  notice_version VARCHAR(40) NOT NULL,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS incident_photo_consent_events_history_idx
  ON incident_photo_consent_events(incident_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS incident_photo_consents (
  incident_id UUID PRIMARY KEY REFERENCES student_incidents(id) ON DELETE CASCADE,
  guardian_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'granted', 'declined', 'revoked')),
  notice_version VARCHAR(40) NOT NULL,
  granted_event_id UUID REFERENCES incident_photo_consent_events(id) ON DELETE CASCADE,
  last_event_id UUID NOT NULL REFERENCES incident_photo_consent_events(id) ON DELETE CASCADE,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((status = 'granted' AND granted_event_id IS NOT NULL)
      OR (status <> 'granted' AND granted_event_id IS NULL))
);

CREATE TABLE IF NOT EXISTS incident_photos (
  id UUID PRIMARY KEY,
  incident_id UUID NOT NULL REFERENCES student_incidents(id) ON DELETE CASCADE,
  consent_event_id UUID NOT NULL REFERENCES incident_photo_consent_events(id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL UNIQUE,
  content_type VARCHAR(40) NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg', 'image/webp')),
  size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 2097152),
  width INTEGER NOT NULL CHECK (width BETWEEN 1 AND 12000),
  height INTEGER NOT NULL CHECK (height BETWEEN 1 AND 12000),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '1 year'),
  deletion_requested_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  CHECK (storage_key LIKE 'incidents/%')
);
CREATE INDEX IF NOT EXISTS incident_photos_expiry_idx
  ON incident_photos(expires_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS incident_photos_incident_idx
  ON incident_photos(incident_id, created_at, id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS incident_photo_deletion_tasks (
  id UUID PRIMARY KEY,
  photo_id UUID REFERENCES incident_photos(id) ON DELETE SET NULL,
  storage_key TEXT NOT NULL UNIQUE,
  reason VARCHAR(30) NOT NULL CHECK (reason IN ('revoked', 'nurse_removed', 'expired', 'orphan_upload', 'defense_cleanup', 'student_reset')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  leased_at TIMESTAMPTZ,
  last_attempt_at TIMESTAMPTZ,
  last_error_code VARCHAR(60),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CHECK (storage_key LIKE 'incidents/%')
);
CREATE INDEX IF NOT EXISTS incident_photo_deletion_due_idx
  ON incident_photo_deletion_tasks(available_at, created_at) WHERE completed_at IS NULL;

CREATE TABLE IF NOT EXISTS branding_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO branding_settings(id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS branding_assets (
  slot VARCHAR(30) PRIMARY KEY CHECK (slot IN ('applicationLogo', 'schoolSeal')),
  asset_id UUID NOT NULL UNIQUE,
  storage_key TEXT NOT NULL UNIQUE,
  content_type VARCHAR(40) NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg', 'image/webp')),
  size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 1048576),
  width INTEGER NOT NULL CHECK (width BETWEEN 1 AND 12000),
  height INTEGER NOT NULL CHECK (height BETWEEN 1 AND 12000),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (storage_key LIKE 'branding/%')
);
