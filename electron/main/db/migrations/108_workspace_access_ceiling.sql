-- OXE-327 (OXE-132 CA-4) · Workspace access ceiling: caps effective agent access as min(workspaceCeiling, sessionAccess).
-- Existing workspaces keep NULL, which resolves to 'full-access' so nothing breaks on upgrade.
ALTER TABLE workspaces ADD COLUMN access_ceiling TEXT NULL CHECK (access_ceiling IS NULL OR access_ceiling IN ('read-only', 'workspace-write', 'full-access'));

PRAGMA user_version = 108;
