CREATE INDEX IF NOT EXISTS appointments_status_time_idx
  ON appointments(status, starts_at);

CREATE INDEX IF NOT EXISTS appointments_legacy_dashboard_date_idx
  ON appointments(status, (data->>'date'))
  WHERE starts_at IS NULL;

CREATE INDEX IF NOT EXISTS visits_dashboard_recent_idx
  ON visits (
    (COALESCE(NULLIF(data->>'date',''), NULLIF(data->>'createdAt',''), '2000-01-01T00:00:00.000Z')) DESC,
    created_at ASC
  );
