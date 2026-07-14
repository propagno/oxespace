ALTER TABLE tasks ADD COLUMN acceptance_criteria TEXT NOT NULL DEFAULT '';

PRAGMA user_version = 42;
