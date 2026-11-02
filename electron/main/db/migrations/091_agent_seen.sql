-- S7.1 · Who has seen what (spec docs/design/s7-mission-control.md §3.4, CCR #513): when the person last looked at
-- each agent, so "Finished" means "finished since you looked" and survives a restart. One row per agent, the newest
-- mark only. `kind` is pane, thread, delegation or work; `id` that source's own id. The app keeps at most 2000 rows
-- and deletes a row with its source.
CREATE TABLE IF NOT EXISTS agent_seen (
  kind TEXT NOT NULL CHECK (kind IN ('pane', 'thread', 'delegation', 'work')),
  id TEXT NOT NULL,
  seen_at INTEGER NOT NULL,
  PRIMARY KEY (kind, id)
);
CREATE INDEX IF NOT EXISTS agent_seen_oldest ON agent_seen(seen_at);

PRAGMA user_version = 91;
