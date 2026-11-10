-- 1.5.0 CR-34 (HML-F10-1, TECH LEAD 08/11): "Show on phone" per pane, on by default. A row keeps the pane off the phone
-- entirely (pane list, agents, terminal stream, conversation) until the person shows it again; it goes with the pane.
-- Set only from the window: never a phone command or an MCP tool.
CREATE TABLE IF NOT EXISTS remote_hidden_panes (
  pane_id TEXT PRIMARY KEY REFERENCES panes(id) ON DELETE CASCADE,
  hidden_at INTEGER NOT NULL
);

PRAGMA user_version = 95;
