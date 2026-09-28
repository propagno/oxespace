# OXESpace workbench visual audit — 2026-09-27

This audit covers the current, uncommitted 0.14.2 checkout in Electron on Windows. It is an interaction and geometry audit, not a screenshot approval exercise. Captures are disposable evidence in `e2e/screenshots` and `test-results`; the assertions open named destinations and measure the relevant layouts.

## Coverage map

| Surface and state | Interactive validation | Visual/geometry evidence | Result |
| --- | --- | --- | --- |
| Code empty state, new workspace wizard, four-terminal grid, collapsed/expanded sidebar, long workspace list | `screenshots.spec.ts`, `workspace.spec.ts`, `code-sidebar-overflow.spec.ts`, `pane-layout-resize.spec.ts` | 1280×756 screen review; footer stays visible; terminal DOM persists through navigation and resize | Pass |
| Code tools hub, command palette, slash commands, custom agent, MCP, Skills | `screenshots.spec.ts`, `smoke-hub.spec.ts`, `navigation-redesign.spec.ts` | Each capture asserts its intended dialog/panel before inspection | Pass |
| Code Files/Editor, Source control, Review, Scripts, Web Preview, Background Jobs, workspace settings | `screenshots.spec.ts`, `workspace-panel-stack.spec.ts`, `workspace-settings-design.spec.ts` | Side tool width and grid width asserted; five tabs switched; active panel and existing terminal remain mounted; narrow Review/Editor stack internal sections | Pass |
| Application Settings: Agents, Terminal, Voice, Notifications, Updates, Diagnostics; workspace Appearance | `settings-tabs.spec.ts`, `settings-desktop.spec.ts`, `workspace-settings-design.spec.ts` | Every application tab inspected; Voice status surface follows the theme and does not claim readiness when no engine is ready | Pass |
| Thread empty state, project/session navigation, composer, responsive header, command/model pickers, account/error/approval states, imported Markdown and message actions | `thread-view.spec.ts`, `delegation-worktree-continuity.spec.ts` | 900/1280/1440 widths, zoom states, exact role assertions, captured states, terminal DOM preservation | Pass |
| Thread long native history and continuous scrolling | `thread-real-session.audit.spec.ts` against an isolated copy of a real local session | 516 events; 900×600, 1280×800, 1600×1000; start/quarter/middle/three-quarter/end and full 360px sweep; zero row overlaps and zero sweep geometry failures | Pass |
| Delegation/recovery transitions | `delegation-worktree-continuity.spec.ts`, `thread-view.spec.ts` | Creation and recovery destinations asserted in Electron | Pass within mocked provider flows |

## Corrected findings

- The Thread virtualizer positioned rows with estimates before final measurement, so long messages could paint over subsequent rows. Rows now participate in normal document flow while top/bottom estimated spacers bound DOM work. The real 516-event conversation had zero overlaps at all audited widths and scroll positions.
- The Thread reading lane and header had inconsistent density at different window widths. The content width and header actions now adapt to the available width.
- Several Code tools could share the width of the main workspace, making each too narrow to use. Open tools now use one tabbed side area; switching preserves mounted tool contents and terminal DOM. Review and Editor stack their internal regions in narrow containers.
- Web Preview's toolbar produced an inner horizontal scrollbar in a docked panel. It now wraps controls and keeps the address and Go action legible. Background Jobs now has a minimum useful width even when an older workspace saved a smaller preference.
- The screenshot harness previously swallowed navigation failures and could capture the wrong surface. It now asserts the intended destination before capturing it.
- Skills and Voice settings contained theme-inconsistent surfaces; they now use shared palette tokens, with accurate ready state.
- Settings scope uses direct Application/current-workspace buttons instead of the native workspace dropdown. Embedded workspace saves show success or the backend's actionable layout error. The new-workspace palette defaults to Workbench; terminal defaults are Cascadia Mono, 16px, 1.4 line height and zero letter spacing. Stored customizations are preserved, with a font-size reset available in Settings.
- The Thread conversation menu now distinguishes finding/resuming another session from actions on the open conversation. Assistant replies have a copy action. The source comparison and remaining parity gaps are documented in `vscode-agent-reference-2026-09-27.md`.

## Verification and limits

- `npm run typecheck`: pass.
- `npm run lint`: pass with 34 existing warnings, no errors.
- `npm run build` and bundle budget check: pass.
- After the settings, font and menu changes: typecheck, build and bundle budget check pass; lint passes with the same 34 warnings; 19 focused Electron tests and 3 focused Playwright tests pass. `shots:settings` and `shots:ui` pass, and their Terminal/Code captures show the Workbench palette and 16px Cascadia preview.
- Full Playwright after these changes: 18 passed, 1 environment-gated audit skipped. Full Electron test run: 1,045 passed, 25 skipped, 1 failed because jsdom does not implement `scrollIntoView` for the new side tabs. That call now checks browser support; the affected `WorkspaceSurface` file passed all 6 tests on rerun, and typecheck passed after the fix. The entire Electron suite was not repeated after that isolated correction.
- Agent session continuation: context actions for open, side-by-side, rename, pin, read/unread, archive and delete; an Archived section provides direct recovery. Unread state persists through restart and is cleared on explicit opening. The Thread sidebar loads with Thread mode, restoring bundle headroom (renderer entry 8.8%). Focused Electron tests: 43 passed; Thread/navigation Playwright: 2 passed. The copied 516-event native session was re-audited after the assistant action layout change: zero overlaps and zero sweep issues.
- Final Agent session validation: the context menu opens next to its session and remains inside a 900×600 window, checked by Playwright geometry assertions and visual inspection. The full Electron suite passed with 1,052 tests and 25 skips; full Playwright passed 18 scenarios with one environment-gated skip. Typecheck, production build with bundle budgets, and lint also passed (34 pre-existing warnings, zero errors). Live provider and packaged Linux behavior remain outside this local validation.
- Standard Playwright suite after the main layout changes: 18 passed, 1 environment-gated audit skipped; the real-session audit was run separately and passed. `shots:ui` and `shots:settings` passed. The side-panel geometry/persistence test passed again after the final minimum-width adjustment.
- The real-session audit uses a copy of the local SQLite database and does not contact a native provider or send a new turn. Provider authentication, live Claude/Codex responses, Linux GPU/OS freezes, actual remote integrations, and packaged installers are outside this Windows visual audit. They require separate end-to-end release certification; this report does not certify them.

The map is complete for the implemented desktop surfaces and states exercised here. “100% visually validated” means the mapped local Electron flows above have direct evidence; it cannot mean every external provider, operating system, data set, or future interaction is proven by this run.

## Follow-up validation: Thread reading, actions and Workbench default

- The existing development database contained four pre-Workbench workspace themes. Migration 058 applies Workbench (`midnight`) once to those older workspaces and leaves later theme changes alone. The migration test covers both steps; a fresh Electron workspace also asserts `data-theme=midnight`.
- Thread reading width increased from 920px to 1100px; the 1440px Electron geometry check confirms the reading and composer columns stay centered and equally wide. The text-size button persists its setting independently of terminal typography. The terminal test verifies the old persisted 32px ceiling migrates to 16px.
- The Thread sidebar now leads with Add project; each project retains its own plus button for New thread. The New thread dialog uses explicit Claude/Codex choices, and the account dialog's provider icons retain their intended 28px width. Their loaded Electron states were checked visually.
- Project changes opens tracked `.md` files in a large rendered Markdown reader. The Electron test opens `README.md`, verifies the document text and modal width, then returns to the diff.
- Side-by-side, archive, restore and delete were exercised through the Electron UI with IPC fixtures. The integration test verifies archived/deleted OXESpace records do not mutate the linked native provider session.
- Final checks: Electron suite 1,057 passed, 25 skipped and one outdated Settings assertion failed; that assertion was updated and its seven-test module passed on repeat. Full Playwright suite 19 passed and one environment-gated real-session audit skipped. The audit was then run against a copy of the 516-event local session: zero overlaps and zero sweep issues at 900, 1280 and 1600px. Typecheck, lint (zero errors, 33 warnings) and build with bundle budgets passed. Live provider responses, packaged Linux updates and Ubuntu system freezes were not reproduced in this Windows run.
