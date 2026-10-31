-- S7.1 · When the person last looked at each agent (docs/design/s7-mission-control.md §3.4), so "Finished" survives a
-- restart. One row per agent key (`<kind>:<source id>`, at most 200 characters); `seen_at` is epoch ms and never moves
-- backwards. A row is deleted with its source, and the store keeps at most 2000 rows, the least recently marked going
-- first. The number is provisional: it is set at merge, after #204/#180, per the migration-order rule.
CREATE TABLE IF NOT EXISTS agent_seen (
  agent_key TEXT PRIMARY KEY CHECK (length(agent_key) BETWEEN 3 AND 200),
  seen_at INTEGER NOT NULL CHECK (seen_at >= 0)
);
CREATE INDEX IF NOT EXISTS idx_agent_seen_at ON agent_seen(seen_at);

PRAGMA user_version = 88;
