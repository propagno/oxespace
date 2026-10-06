-- Team identities do not own or cascade-delete Code/Thread resources.
CREATE TABLE IF NOT EXISTS agent_teams (
  id TEXT PRIMARY KEY, project_identity TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_team_members (
  id TEXT PRIMARY KEY, team_id TEXT NOT NULL REFERENCES agent_teams(id),
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('coordinator','project-manager','product-manager','developer','reviewer')),
  archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)),
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS agent_team_coordinator ON agent_team_members(team_id)
  WHERE role='coordinator' AND archived=0;
CREATE TABLE IF NOT EXISTS agent_team_bindings (
  member_id TEXT PRIMARY KEY REFERENCES agent_team_members(id),
  provider TEXT NOT NULL CHECK(provider IN ('codex','claude')),
  native_session_id TEXT NOT NULL, canonical_root TEXT NOT NULL,
  surface TEXT NOT NULL CHECK(surface IN ('thread','pane')), surface_id TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK(generation > 0),
  UNIQUE(provider,native_session_id), UNIQUE(surface,surface_id)
);
CREATE TABLE IF NOT EXISTS agent_team_messages (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
  team_id TEXT NOT NULL REFERENCES agent_teams(id),
  sender_id TEXT REFERENCES agent_team_members(id),
  recipient_id TEXT NOT NULL REFERENCES agent_team_members(id),
  request_key TEXT NOT NULL, payload_hash TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('request','progress','question','answer','result','decision')),
  body TEXT NOT NULL, created_at INTEGER NOT NULL,
  received_at INTEGER, reply_to TEXT REFERENCES agent_team_messages(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS agent_team_message_key ON agent_team_messages(team_id,COALESCE(sender_id,''),request_key);
CREATE INDEX IF NOT EXISTS agent_team_inbox ON agent_team_messages(recipient_id,sequence);
-- Remember the selected surface, never persist execution tokens or auto-authorize
-- a replacement process after restart.
CREATE TABLE IF NOT EXISTS agent_team_execution_links (
  member_id TEXT PRIMARY KEY REFERENCES agent_team_members(id),
  owner_kind TEXT NOT NULL CHECK(owner_kind IN ('thread','pane')),
  owner_id TEXT NOT NULL, UNIQUE(owner_kind,owner_id)
);
PRAGMA user_version = 61;

