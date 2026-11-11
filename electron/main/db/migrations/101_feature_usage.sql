-- F11 local feature usage count (1.5.0 A65 / N7, ccr-f11-release.md §A65): off by default (no settings row on fresh
-- or upgraded profiles reads as disabled); counts only closed-catalog keys per UTC day on this computer; never sent.
CREATE TABLE IF NOT EXISTS feature_usage_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  since INTEGER
);

CREATE TABLE IF NOT EXISTS feature_usage_days (
  feature TEXT NOT NULL,
  day INTEGER NOT NULL,
  uses INTEGER NOT NULL CHECK (uses >= 0),
  last_used INTEGER NOT NULL,
  PRIMARY KEY (feature, day)
);

CREATE INDEX IF NOT EXISTS idx_feature_usage_days_day ON feature_usage_days(day);

PRAGMA user_version = 101;
