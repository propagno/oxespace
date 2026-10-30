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
| 2.5.8 Target Size (Minimum) | AA | Pass, with one documented exception | axe `target-size` on every surface. Control heights come from `--control-*` (24, 28 and 32 px). Exception below. |
| 3.2.6 Consistent Help | A | Pass | Help is always in the same place: the Help menu of the title bar (keyboard shortcuts, diagnostics, report a problem, About) and the same entries in the command palette. |
| 3.3.7 Redundant Entry | A | Pass | The multi-step flows carry what was already given: Connect on a database container opens the connection form filled from the container (OxeQuery); a new conversation starts in the project it was created from; New workspace keeps the chosen folder through the launch; delegation offers the workspaces already open; a request opened again keeps its draft. No form asks for something the same process already has. |
| 3.3.8 Accessible Authentication (Minimum) | AA | Pass | OXESpace has no password of its own. Agent sign-in happens in the provider's own page in the browser; the codes and tokens fields allow paste and password managers (no paste blocking, no cognitive test). |

2.4.12, 2.4.13 and 3.3.9 are level AAA and outside the claim.

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
