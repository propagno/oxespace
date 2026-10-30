-- What OXESpace remembers about an MCP server since the person trusted it: a pin of its command or URL,
-- the tools it offered then, and, when it changed them, the quarantine that waits for the person.
-- One JSON document (see mcp-guard.ts); NULL for servers trusted before this existed.
ALTER TABLE mcp_servers ADD COLUMN guard_json TEXT;

PRAGMA user_version = 81;
