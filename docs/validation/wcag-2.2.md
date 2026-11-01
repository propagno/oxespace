# WCAG 2.2 AA in OXESpace 1.4

The 1.4 claim is WCAG 2.2 level AA (roadmap item F4). Everything 2.1 AA required still applies and is checked as
before (docs/validation/a11y-axe-2026-10-14.md). This page covers what 2.2 adds, how each criterion is checked,
and the documented exceptions.

## How it is checked

- **axe on every pull request**, on Linux and Windows (`.github/workflows/a11y-axe.yml`), with the tags
  `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` and `wcag22aa` (`e2e/helpers/a11y.ts`). Any critical or serious
  finding fails the run. Each finding in the report carries axe's reason (`why`), so a failure can be acted on
  from the report alone.
- **End-to-end tests** for what axe cannot see (focus position after scrolling, alternatives to dragging).
- **The screen-reader script** (docs/validation/screen-reader-1.4.md), run by a person with NVDA on Windows and Orca
  on Linux, and recorded with date and build in its table. Before that, `e2e/screen-reader-script.spec.ts` checks the
  accessibility tree of each step it can reach without a real agent or Docker (names, roles, states, order, live
  regions and where focus goes), so the person's pass is the final check, not the first.

## Criteria added in 2.2

| Criterion | Level | Status | How |
|---|---|---|---|
| 2.4.11 Focus Not Obscured (Minimum) | AA | Pass | The only thing that floats over scrolling content is the conversation's sticky prompt pill; the timeline has `scroll-padding-top`, so a control focused from the keyboard scrolls into view below it. Dialogs trap focus, and toasts sit in a corner away from the focused control. |
| 2.5.7 Dragging Movements | AA | Pass | Every drag has a single-click way: a click on a splitter, a sidebar's edge or a pane-grid divider (a press that does not travel), or Enter on it, opens Smaller / Larger / Restore (Move the divider for the grid); editor tabs move left or right from their menu; workspaces move up or down from theirs; panes move with the pane menu's Arrange; the file tree's menu copies a path instead of dragging it into a terminal. `e2e/drag-alternatives.spec.ts`, `tests/ui-splitter.test.tsx`, offer-audit. |
| 2.5.8 Target Size (Minimum) | AA | Pass, with one documented exception | axe `target-size` on every surface. Control heights come from `--control-*` (24, 28 and 32 px). The **primitives** in `src/ui` and the **four audited surfaces** below have no target under `--target-min` (24 px) in either density; screens built from raw `<button>` (513 today, a ratchet that only goes down in `tests/design-lint.test.ts`) are covered by axe only: a glyph may be drawn smaller (the 16 px checkbox box, the 18 px colour dot of `SwatchPicker`) inside a 24 px target (its label, its button). `tests/design-lint-target-size.test.ts` computes each primitive's box from its CSS Module in both densities; `e2e/target-size.spec.ts` measures every interactive element of Settings › Appearance and Updates, the OxePod sidebar and OxeQuery's connection form at 1024 px, compact and comfortable. Exception below. |
| 3.2.6 Consistent Help | A | Pass | Help is always in the same place: the Help menu of the title bar (keyboard shortcuts, diagnostics, report a problem, About) and the same entries in the command palette. |
| 3.3.7 Redundant Entry | A | Pass | The multi-step flows carry what was already given: Connect on a database container opens the connection form filled from the container (OxeQuery); a new conversation starts in the project it was created from; New workspace keeps the chosen folder through the launch; delegation offers the workspaces already open; a request opened again keeps its draft. No form asks for something the same process already has. |
| 3.3.8 Accessible Authentication (Minimum) | AA | Pass | OXESpace has no password of its own. Agent sign-in happens in the provider's own page in the browser; the codes and tokens fields allow paste and password managers (no paste blocking, no cognitive test). |

2.4.12, 2.4.13 and 3.3.9 are level AAA and outside the claim.

## 2.1 criteria corrected in 1.4

| Criterion | Level | Status | How |
|---|---|---|---|
| 2.1.2 No Keyboard Trap | A | Pass since F23 (failed before) | The 1.4 homologation found that a focused terminal kept Tab (right for a shell) but also F6, Ctrl+Tab and Escape: only Ctrl+K, Ctrl+B and Ctrl+1–5 got out, so the pane-grid dividers (the 2.5.7 alternative) could not be reached from the keyboard. The 2.1 claim had not looked inside the terminal. Now there are two ways out of every terminal, the Thread native CLI included. **F6 / Shift+F6** move focus to the next / previous region of the window (title bar → sidebar → work area: the pane grid, the conversation or the OxeQuery/OxePod/OxePost view → side panels → status bar, round again; a region not on screen is skipped; coming back to a region returns to where focus was, so Shift+F6 goes back into the terminal). They are fixed: never sent to the shell, never rebound or turned off (Settings › Keyboard says "Always on"). **Tab moves focus**, toggled with Ctrl+M as in VS Code (rebindable in Settings › Keyboard, or from the pane's ⋯ menu): per pane and for the session, Tab and Shift+Tab move focus out of that terminal instead of reaching the shell; the pane shows a "Tab moves focus" badge and a polite live region says "Tab moves focus: on/off". Ctrl+M is Enter (CR) in a terminal, so the toggle takes it from the shell; the Enter key is not affected, and a pane that needs Ctrl+M for a TUI keeps it with "Send Ctrl+M to the shell" in its ⋯ menu (or the toggle is rebound or turned off, and the old key reaches every shell again). For programs that use F6 (mc, htop, Far Manager, tig), the pane's ⋯ menu has "Send F6 to the program": in that pane only, F6 and Shift+F6 reach the program, and Ctrl+M (Tab moves focus) or the pane menu is the way out; it and "Send Ctrl+M to the shell" turn each other off, and with the toggle unbound F6 stays the way out, so a pane always keeps one key out. The polite live region is in the page, empty, from boot (as the toasts since F21), so the first announcement is heard. The first time focus enters each pane's terminal in the session it says "Terminal. Press F6 to leave, or Ctrl+M to make Tab move focus." (or "Terminal. F6 goes to the program here. Press Ctrl+M to make Tab move focus." in a pane that sends F6 to its program; said again after that option changes), never on keystrokes or later entries; every on/off of the toggle, by key or from the menu, is said. A region F6 focuses that has nothing focusable gets tabindex="-1" only while it holds focus. All of it is in the shortcut guide. Tests: `tests/terminal-focus.test.tsx`, `tests/integration/TerminalView.test.tsx` (the keys never reach the PTY), `e2e/terminal-focus-exit.spec.ts` (sidebar filter → Tab into the terminal → F6 out → Shift+F6 back → Ctrl+M → Tab out → a divider → Enter opens its menu → Move the divider closes it with focus back on the divider). |

## Documented exceptions

### Targets under the sticky prompt pill (2.5.8)

In a conversation, the pill that leads back to the prompt being answered (`.thread-sticky-prompt`) floats at the top
of the timeline. At some scroll positions it covers part of the row underneath, and axe, which measures one scroll
position, reports that row as an obscured target. The row is never stuck there: scrolling moves it out from under
the pill, keyboard focus lands below it (2.4.11 above), and the pill itself is a 28 px button. The scan drops a
`target-size` node only when axe names the pill as the one thing covering it (`SCROLL_OVERLAYS` in
`e2e/helpers/a11y.ts`); any other cause still fails the run.

### Terminal and editor

xterm draws to a canvas and Monaco ships its own screen-reader mode, so axe's DOM rules say nothing useful about
either; both stay excluded from the scan, as in 2.1, and are covered by the screen-reader script.

## More contrast

When the operating system asks for more contrast (`prefers-contrast: more`), every border takes the strong step
and muted text reads as secondary, in both modes (`moreContrastTokens` in `src/design/tokens/css.ts`). Windows high
contrast (forced colors) keeps its own stylesheet, `src/styles/forced-colors.css`.
