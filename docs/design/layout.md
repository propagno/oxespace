# Layout widths

OXESpace has to lay out correctly from a 960×640 window with the interface at 125% up to a 4K screen, at every
interface scale (90–125%). Layouts change at a few named widths, and a layout changes with the width of the thing it
lives in: the window for whole-window layouts, the panel for anything that can be docked, split or resized.

Source of truth: `src/design/tokens/scales.ts` (`BREAKPOINT`, `CONTAINER`), rendered as `--bp-*` and
`--container-*` into `src/styles/tokens.generated.css` by `npm run tokens`. CSS cannot read a custom property
inside an `@media` or `@container` condition, so the query writes the number and `tests/design-lint.test.ts`
fails when that number is not on the scale (every `max-width`, `min-width`, `width <` and `width >` condition in
`src/**/*.css`).

## The floor

The window's minimum size is 960×640 (`electron/main/index.ts`) and the largest interface scale is 125%
(`shared/uiScale.ts`), so the smallest viewport the app ever gets is **768×512 CSS pixels**. Everything must fit
there without horizontal scroll and with its primary controls whole. The wide end is 1920×1080 at 100% and above.
`e2e/visual/responsive-matrix.spec.ts` checks six anchor screens (Settings, empty state, workspace home, Code with a
docked panel, a Thread conversation and OxeQuery) at both ends; it sets the scale through Settings › Appearance,
which zooms the window with `webContents.setZoomFactor`.

## Window breakpoints (`@media`)

| Token | Width | Use |
|---|---|---|
| `--bp-sm` | 520px | single-column dialogs and forms |
| `--bp-md` | 640px | stacked dialog navigation, two-column grids to one |
| `--bp-lg` | 760px | the full-window compact layouts (Settings, top bar, split grid) |
| `--bp-xl` | 900px | the floor zone: 960px windows at 100–110% and 768px at 125% (Settings navigation, top-bar labels) |
| `--bp-2xl` | 1100px | mid-size windows (1280 or 1366 at 125%): OxePod detail, Settings grids |

`sm`, `md` and `lg` sit below the 768px floor, so they act only if the floor ever moves; they keep dialogs and
forms sane in that case. Layout work for real windows happens at `xl` and `2xl`.

## Panel widths (`@container`)

| Token | Width | Use |
|---|---|---|
| `--container-2xs` | 240px | sidebar rows and pane headers: labels become icons |
| `--container-xs` | 380px | panel tabs and pane headers drop secondary text; job filters tighten |
| `--container-sm` | 480px | side-panel headers drop the workspace name; terminal chips drop labels |
| `--container-md` | 560px | split views stack (Changes list over the diff, integration forms) |
| `--container-lg` | 640px | review and editor panes stack; the docked PR bar drops its summary |
| `--container-xl` | 720px | a conversation tightens its gutters; the Thread heading compacts its context; side-by-side conversations stack |

## `@container` or `@media`

Use **`@container`** when the element lives in something that can be narrow while the window is wide: a side panel
(it is resized on its own), a terminal pane, a Thread view next to a docked panel or another conversation, a panel
header. Give that ancestor `container: <name> / inline-size` and query it by name, so a container added later
between them does not change what the query measures. Containers in use: `thread-view`, `thread-heading`,
`thread-host`, `editor-header` (side-panel headers), `integration-panel`, `terminal-pane`, and unnamed ones on the
Changes panel, review pane, editor pane, panel tabs, pane header and background jobs dock.

A size container has no intrinsic width: it must get its width from its parent (a block, a stretched flex column
child, or `flex: 1` in a row), never from its content. It also becomes the containing block for positioned
descendants, which is fine for menus and tooltips (they render in a portal).

Use **`@media`** only for layouts that span the whole window (Settings, the top bar, OxePod, the Code split grid)
and for modal dialogs, which are sized from the window.

When a narrow layout hides text, the text stays reachable: keep it in the accessibility tree (visually hidden, not
`display: none`) or give the control an accessible name, and a tooltip. The Thread heading's branch and worktree
badge are the pattern: icons when narrow, with their names in the accessible name and the tooltip.
