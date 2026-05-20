-- Removes pane types that no longer have implementations.
-- The Graph/Swarm/Inspector pane variants were deprecated when the OXE graph and
-- the agent swarm prototypes were removed; any persisted rows still pointing at
-- those types would render a "Coming soon" stub. Convert them back to terminal so
-- the user gets a working pane instead of dead UI on next launch.
UPDATE panes
SET type = 'terminal',
    status = 'idle',
    updated_at = datetime('now')
WHERE type IN ('graph', 'swarm', 'inspector');

PRAGMA user_version = 25;
