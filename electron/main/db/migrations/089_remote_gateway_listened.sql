-- M4/M5 (#204): `listened_before` turns 1 the first time the gateway really listens on this profile and never goes
-- back, so the window explains the system firewall's question before the first time only. A column of its own
-- migration: 088 (#180) created the table and may already have run.
ALTER TABLE remote_gateway ADD COLUMN listened_before INTEGER NOT NULL DEFAULT 0;

PRAGMA user_version = 89;
