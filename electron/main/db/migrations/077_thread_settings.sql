-- Thread settings that a person can change without a new build. The first is
-- 'auto_approve_reads': whether commands on the built-in read-only list are
-- approved without asking. An absent row means the default (on); a row that
-- cannot be read turns the list off, so a failure only ever means more questions.
CREATE TABLE IF NOT EXISTS thread_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

PRAGMA user_version = 77;
