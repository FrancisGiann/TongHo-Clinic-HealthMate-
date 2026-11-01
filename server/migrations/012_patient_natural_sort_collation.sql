CREATE COLLATION IF NOT EXISTS patient_name_natural_ci (
  provider = icu,
  locale = 'und-u-kn-true-ks-level1',
  deterministic = false
);

CREATE COLLATION IF NOT EXISTS patient_name_ci (
  provider = icu,
  locale = 'und-u-ks-level1',
  deterministic = false
);
