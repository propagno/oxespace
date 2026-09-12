# Workspace navigation and settings

The sidebar shows workspaces with their existing terminal panes as expandable children. These are not native conversation histories. Worktree terminals stay under the workspace that owns their pane. Delegated panes retain their task identity.

- Selecting a terminal activates its workspace, exits pane maximization and focuses that existing terminal. It does not call the terminal launcher.
- Width (240–360 px), expansion and collapsed mode are local presentation preferences. They do not change project or worktree ownership.
- Search at the top opens global search; the workspace filter matches names, agents, paths and already cached branches without additional Git processes.
- Tools remains the entry point for MCP, skills and integrations. Jobs and Scripts keep their existing behavior. There are no new task-status groups.

Settings opens a full-window surface with Application and Workspace scopes. The existing workspace surfaces remain mounted behind the focus-managed settings surface. Application providers, terminal, voice, notifications, updates and diagnostics reuse their existing implementations.

Workspace appearance/layout/default-shell edits require Save. Navigation away from unapplied changes offers Stay, Discard, or Save and continue; a save failure does not navigate. Immediate settings and provider-specific Apply buttons retain their own semantics. Memory configuration remains optional.

Regression coverage: `SettingsCenter.test.tsx`, `Sidebar.test.tsx`, `WorkspaceSettingsNavigation.test.tsx`, and the real Electron renderer test `navigation-redesign.spec.ts`. The latter uses mocked native services, not live Claude/Codex processes. Linux packaged-app validation remains required before claiming cross-platform release readiness.
