-- The per-pane AI model override feature was removed in Onda 2: the wrapper
-- added a terminal restart every time the user changed the model, which is
-- worse UX than letting the agent CLI handle /model natively.
--
-- The actual `ALTER TABLE panes DROP COLUMN model_override` is executed from
-- runMigrations() in db/index.ts so we can guard it with `hasColumn` — older
-- installs may already be missing the column, and SQLite errors out instead of
-- being idempotent like `DROP TABLE IF EXISTS`.
PRAGMA user_version = 28;
