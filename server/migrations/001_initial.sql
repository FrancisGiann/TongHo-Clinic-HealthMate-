CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  username VARCHAR(80) NOT NULL,
  email VARCHAR(254) NOT NULL,
  password_hash TEXT NOT NULL,
  name VARCHAR(160) NOT NULL,
  role VARCHAR(40) NOT NULL CHECK (role IN ('student', 'guardian', 'school_nurse', 'system_administrator')),
  status VARCHAR(30) NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'suspended', 'deactivated')),
  mfa_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  school_id VARCHAR(80) NOT NULL DEFAULT '',
  prc_license_number VARCHAR(80) NOT NULL DEFAULT '',
  contact_number VARCHAR(40) NOT NULL DEFAULT '',
  school_name VARCHAR(180) NOT NULL DEFAULT 'Philippine Tong Ho Institute',
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_uidx ON users (LOWER(username));
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_uidx ON users (LOWER(email));

CREATE TABLE IF NOT EXISTS patients (
  id TEXT PRIMARY KEY,
  user_id UUID UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  patient_type VARCHAR(20) NOT NULL DEFAULT 'student' CHECK (patient_type IN ('student', 'faculty')),
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS guardian_patient_links (
  guardian_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  relationship VARCHAR(80) NOT NULL DEFAULT 'Guardian',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (guardian_user_id, patient_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash CHAR(64) PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  ip_address VARCHAR(64),
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS otp_challenges (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  destination VARCHAR(254) NOT NULL,
  purpose VARCHAR(40) NOT NULL,
  code_hash CHAR(64) NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS otp_destination_purpose_idx ON otp_challenges(destination, purpose, created_at DESC);

CREATE TABLE IF NOT EXISTS login_attempts (
  identifier VARCHAR(254) PRIMARY KEY,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS invitations (
  id UUID PRIMARY KEY,
  token_hash CHAR(64) UNIQUE NOT NULL,
  email VARCHAR(254) NOT NULL,
  role VARCHAR(40) NOT NULL CHECK (role IN ('student', 'guardian', 'school_nurse', 'system_administrator')),
  patient_id TEXT REFERENCES patients(id) ON DELETE SET NULL,
  invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS clinic_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS visits (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  data JSONB NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS visits_patient_idx ON visits(patient_id);

CREATE TABLE IF NOT EXISTS screenings (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  data JSONB NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS immunizations (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  data JSONB NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  data JSONB NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  starts_at TIMESTAMPTZ,
  status VARCHAR(30) NOT NULL DEFAULT 'Requested',
  data JSONB NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS appointments_time_idx ON appointments(starts_at, status);

CREATE TABLE IF NOT EXISTS queue_entries (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  status VARCHAR(30) NOT NULL DEFAULT 'Waiting',
  priority INTEGER NOT NULL DEFAULT 0,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inventory_items (
  id TEXT PRIMARY KEY,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dispense_logs (
  id TEXT PRIMARY KEY,
  visit_id TEXT REFERENCES visits(id) ON DELETE SET NULL,
  inventory_item_id TEXT REFERENCES inventory_items(id) ON DELETE SET NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  data JSONB NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stock_adjustments (
  id TEXT PRIMARY KEY,
  inventory_item_id TEXT REFERENCES inventory_items(id) ON DELETE SET NULL,
  quantity INTEGER NOT NULL,
  data JSONB NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  channel VARCHAR(20) NOT NULL CHECK (channel IN ('in_app', 'email')),
  type VARCHAR(60) NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed', 'read')),
  dedupe_key VARCHAR(180),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  sent_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe_uidx ON notifications(dedupe_key) WHERE dedupe_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS risk_rules (
  id UUID PRIMARY KEY,
  version INTEGER UNIQUE NOT NULL,
  name VARCHAR(120) NOT NULL,
  rules JSONB NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'clinician_approved', 'retired')),
  approved_by VARCHAR(160),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS risk_assessments (
  id UUID PRIMARY KEY,
  visit_id TEXT NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  rule_version INTEGER NOT NULL,
  result JSONB NOT NULL,
  acknowledged_by UUID REFERENCES users(id) ON DELETE SET NULL,
  acknowledged_at TIMESTAMPTZ,
  override_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS report_snapshots (
  id UUID PRIMARY KEY,
  report_type VARCHAR(30) NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  data JSONB NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  event VARCHAR(80) NOT NULL,
  subject_type VARCHAR(80),
  subject_id TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address VARCHAR(64),
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS audit_created_idx ON audit_logs(created_at DESC);

INSERT INTO clinic_settings (id, data)
VALUES (1, '{"schoolName":"Philippine Tong Ho Institute","clinicName":"Campus Clinic","schoolYear":"2026-2027","nurseName":"School Nurse"}'::jsonb)
ON CONFLICT (id) DO NOTHING;
