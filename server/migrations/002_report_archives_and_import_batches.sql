ALTER TABLE report_snapshots
  ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'manual'
  CHECK (source IN ('manual', 'automated'));

CREATE UNIQUE INDEX IF NOT EXISTS report_snapshots_automated_period_uidx
  ON report_snapshots(report_type, period_start, period_end)
  WHERE source = 'automated';
CREATE INDEX IF NOT EXISTS report_snapshots_retention_idx
  ON report_snapshots(source, period_end, created_at);

CREATE TABLE IF NOT EXISTS import_batches (
  id UUID PRIMARY KEY,
  import_type VARCHAR(20) NOT NULL CHECK (import_type IN ('students', 'faculty', 'visits')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rolled_back_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS import_batch_items (
  batch_id UUID NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  entity_type VARCHAR(20) NOT NULL CHECK (entity_type IN ('patient', 'visit')),
  entity_id TEXT NOT NULL,
  original_data_hash CHAR(32) NOT NULL,
  PRIMARY KEY (batch_id, entity_type, entity_id)
);
