ALTER TABLE mcp_servers ADD COLUMN trusted INTEGER NOT NULL DEFAULT 0;

PRAGMA user_version = 26;
