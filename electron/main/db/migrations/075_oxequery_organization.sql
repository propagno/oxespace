-- OxeQuery connections gain what a long list needs: a group, a favorite flag, a color, the time of last
-- use, the names the agent gateway masks for this connection, a keep-alive interval, and the SSH agent
-- as a way to authenticate a tunnel (ssh_auth keeps its two values; the agent is a flag beside it, so the
-- table is not rebuilt: its children cascade on delete).
ALTER TABLE oxequery_connections ADD COLUMN group_name TEXT NOT NULL DEFAULT '';
ALTER TABLE oxequery_connections ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0;
ALTER TABLE oxequery_connections ADD COLUMN color TEXT NOT NULL DEFAULT '';
ALTER TABLE oxequery_connections ADD COLUMN last_used_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE oxequery_connections ADD COLUMN mask_patterns TEXT NOT NULL DEFAULT '';
ALTER TABLE oxequery_connections ADD COLUMN keepalive_seconds INTEGER NOT NULL DEFAULT 30;
ALTER TABLE oxequery_connections ADD COLUMN ssh_use_agent INTEGER NOT NULL DEFAULT 0;

PRAGMA user_version = 75;
