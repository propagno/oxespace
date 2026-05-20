-- The Plan/Exec multi-agent workflow feature was removed in Onda 2: it
-- overlapped with the user's natural agent CLI usage and added a gated
-- approval layer that no one used in practice. Drop the workflow tables.
--
-- The agents_panel_* columns on workspaces are dropped from runMigrations()
-- in db/index.ts so we can guard each ALTER with `hasColumn` — older installs
-- may already be missing the columns (depending on what was skipped during
-- earlier upgrades), and SQLite errors out on a missing column instead of
-- being idempotent like DROP TABLE IF EXISTS.
DROP TABLE IF EXISTS agent_workflow_artifacts;
DROP TABLE IF EXISTS agent_workflow_steps;
DROP TABLE IF EXISTS agent_workflow_runs;
DROP TABLE IF EXISTS workspace_agent_role_bindings;

PRAGMA user_version = 29;
