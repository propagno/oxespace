# Workbench visual and interaction validation — 2026-09-30

Scope: the current 0.16.0-beta.1 checkout in Windows Electron. This is an interaction and geometry audit, not approval of screenshots. The real-session checks use a consistent, disposable copy of the local development database; the original session is not modified.

| Surface | Representative states and checks | Automated coverage |
| --- | --- | --- |
| Code | New workspace, four-pane grid, selected pane, long sidebar, collapsed navigation, editor, local Git, panel resizing | `workspace`, `code-sidebar-overflow`, `navigation-redesign`, `pane-layout-resize`, `orca-shell`, `workspace-panel-stack` |
| Compact Code | 600px width, no page-wide horizontal overflow, one visible pane while all four remain mounted, switching panes from the sidebar, no repeated breadcrumb/status data | `workspace-settings-design` |
| Settings and dialogs | Application tabs, workspace categories at 1360px and 600px, persisted theme, short-window layout, updater states, keyboard opening/closing and focus restoration | `settings-tabs`, `settings-desktop`, `workspace-settings-design`, `keyboard-accessibility` |
| Thread | Navigation after restart, message/approval/question states, account recovery, session actions, delegation, long messages, responsive composer | `thread-view`, `thread-project-navigation`, `thread-session-actions`, `delegation-worktree-continuity` |
| Long real Thread | 516 events, three viewport sizes, start/middle/end and a full scroll sweep; row and content overlap, horizontal overflow, bottom stability | `thread-real-session.audit`, `thread-bottom-stability.audit` |
| Other workbench destinations | Tools, design mode, documentation preview, Linear, shell panels, terminal geometry | `smoke-hub`, `design-mode`, `documentation-preview`, `linear`, `terminal-geometry` |

Corrections made during this pass:

- The global 900px body minimum clipped Code at 600px. The grid now presents its active terminal across the available compact width and keeps inactive terminals mounted. Selecting another terminal in the sidebar changes the visible pane.
- The compact topbar and statusbar no longer repeat the workspace title, pane count, and version where there is insufficient space; connection and branch remain accessible.
- Tools and New Workspace restore keyboard focus to the control that opened them after dismissal. The New Workspace opener is captured before lazy loading starts.
- The shell and Thread activity tests now assert the current local Git and completed-action layouts instead of removed presentation layers.
- The real-session audits clean up their Electron process tree on Windows so a copied SQLite database does not make a visual pass fail during shutdown. A session without an expandable user prompt does not claim to test expansion; `thread-view` covers that interaction with a dedicated fixture.

Validation: `npm run typecheck` and `npm run build` passed; bundle budgets passed. `npm run lint` reported zero errors and 33 warnings. `npm run test:electron` passed 1,095 tests with 25 environment-gated skips. The full Playwright run passed all 24 scenarios, including both real-session audits. The 516-event session had zero row overlaps, zero sweep issues, and zero bottom drift.

Limits: these checks do not certify packaged Windows/Linux installers, live Claude/Codex provider responses, or external Git/MCP services. Those require release builds and their own environments or credentials. The test matrix covers the named implemented states; it is not evidence that every possible state in a public release has been exercised.
