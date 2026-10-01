CREATE TABLE IF NOT EXISTS clinic_arrivals (
  id UUID PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS clinic_arrivals_patient_time_idx
  ON clinic_arrivals(patient_id, occurred_at DESC);
