-- OxeQuery's own settings (how long history is kept, how much an agent may be given by kind of
-- environment): one JSON value, validated in code.
CREATE TABLE IF NOT EXISTS oxequery_preferences (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

PRAGMA user_version = 76;
