# Workspace navigation and settings

The sidebar shows workspaces with their existing terminal panes as expandable children. These are not native conversation histories. Worktree terminals stay under the workspace that owns their pane. Delegated panes retain their task identity.

- Selecting a terminal activates its workspace, exits pane maximization and focuses that existing terminal. It does not call the terminal launcher.
- Width (240–360 px), expansion and collapsed mode are local presentation preferences. They do not change project or worktree ownership.
- Search at the top opens global search; the workspace filter matches names, agents, paths and already cached branches without additional Git processes.
- Tools remains the entry point for MCP, skills and integrations. Jobs and Scripts keep their existing behavior. There are no new task-status groups.

Settings opens a full-window surface with Application and Workspace scopes. The existing workspace surfaces remain mounted behind the focus-managed settings surface. Application providers, terminal, voice, notifications, updates and diagnostics reuse their existing implementations.

Workspace appearance/layout/default-shell edits require Save. Navigation away from unapplied changes offers Stay, Discard, or Save and continue; a save failure does not navigate. Immediate settings and provider-specific Apply buttons retain their own semantics. Memory configuration remains optional.

Regression coverage: `SettingsCenter.test.tsx`, `Sidebar.test.tsx`, `WorkspaceSettingsNavigation.test.tsx`, and the real Electron renderer test `navigation-redesign.spec.ts`. The latter uses mocked native services, not live Claude/Codex processes. Linux packaged-app validation remains required before claiming cross-platform release readiness.

## Shell, rail and workbench (redesign waves 0–8)

- **Window.** Frameless on Windows/Linux (`titleBarStyle: 'hidden'` + transparent `titleBarOverlay`), `hiddenInset` on macOS. The shell is padded by `--frame-gap` and the content surface has its own border and `--frame-radius`. The title bar is the drag region; interactive children opt out with `no-drag`.
- **Menu bar.** `AppMenuBar` (Radix Menubar, File/Edit/View/Help) is built from the same command actions as the palette in `appMenus.ts`, so shortcuts and labels stay in one place. It is hidden on macOS, where the native menu is used. Labels are English like the rest of the app; there is no i18n layer yet.
- **Rail.** A 48 px icon rail (Code/Thread switch, primary actions, context actions, settings, collapse) sits left of the project tree. Collapsing the sidebar leaves only the rail. Thread lists show eight conversations per project with "Show N more"; the selected one is always visible.
- **Agents.** The Agents page was removed from navigation (Settings, Tools, palette, accounts footer). `openAgentSettings` and the providers section remain in code.
- **Thread workbench.** Panels: Changes, Files, Find in files, Scripts, Background activity, Web preview, Terminal. The old Session/Project changes, Source control, Activity, Diagnostics, Plan and Agents panels were removed.
- **Changes.** `ChangesPanel` shows branch (or uncommitted) changes against a base ref with a Monaco side-by-side diff, a file tree on the right, a "Viewed" mark persisted per repository and base, and a one-file-at-a-time banner for large diffs. It uses `git:diff-summary` / `git:file-original`, which have no file/line caps (originals are truncated at 2 MB). Per-line review comments only exist in the "Classic" review of the Code panel.
- **Turn summary.** "Edited N files" cards offer View changes and Undo. Undo restores one turn's checkpoint (`/checkpoint restore`) and is refused by the orchestrator when later changes touched the same files.
- **MCP catalog.** `connectorCatalog.ts` holds the entries; `simple-icons` provides brand glyphs. Remote servers are bridged with `mcp-remote` (browser sign-in). Added servers show state and start/stop in place.
- **Design tokens.** Font sizes use `--fs-*`, radii `--radius-*`/`--panel-radius`, neutral fills `--ov-1..3`, hit targets `--hit-min`. Literal `px` font sizes and single-value radii were migrated; new CSS should not add literals.

Visual regression ruler: `e2e/redesign-audit.spec.ts` and `redesign-audit-2.spec.ts` write per-surface metrics (font sizes, radii, small targets, contrast) to `e2e/screenshots/redesign-audit/metrics`.
