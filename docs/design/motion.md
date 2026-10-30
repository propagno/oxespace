# Motion

OXESpace moves little and on purpose. Motion says where something came from, confirms an action the person took, or
shows that work is still going on. It never decorates, and it never makes anyone wait.

Source of truth: `src/design/tokens/scales.ts` (`MOTION`, `REDUCED_MOTION`), rendered into
`src/styles/tokens.generated.css` by `npm run tokens`. The keyframes live only in `src/styles/motion.css`.
The design system viewer (Command palette → *Design System: Open Viewer* → **Motion**) shows every token,
loop and entrance described here.

## Principles

1. **Tokens only.** Every `transition` and `animation` uses a `--duration-*` and an `--ease-*` token. No fixed
   timing in CSS: `tests/design-lint.test.ts` fails on one.
2. **Cheap to draw.** Animate `opacity`, `transform`, `translate` and `scale` only (and `background-position` for
   the skeleton shimmer). Nothing that triggers layout or paint on every frame (width, height, box-shadow, color).
3. **Enter, never exit.** Things that appear ease in; things the person dismissed disappear at once.
4. **Three keyframes.** `oxe-spin`, `oxe-shimmer` and `oxe-pulse`. Everything else is a transition, and entrances
   use `@starting-style`, so a re-render mid-way never restarts them. A new keyframe needs a reason here first.
5. **Reduced motion is respected everywhere.** See [Reduced motion](#reduced-motion).

## Tokens

| Token | Full | Reduced | Use |
|---|---|---|---|
| `--duration-fast` | 120ms | 0ms | hover, press, tooltip, menu, popover |
| `--duration-base` | 200ms | 0ms | dialog, toast, panel, palette entrance |
| `--duration-slow` | 320ms | 0ms | large surfaces moving into place |
| `--duration-spin` | 800ms | 2.4s | one turn of a busy indicator |
| `--duration-pulse` | 1.6s | (stops) | one beat of a live status or the brand loader |
| `--duration-shimmer` | 1.4s | (stops) | one sweep of a skeleton bar |
| `--duration-blink` | 1.1s | (stops) | a terminal cursor preview |
| `--motion-shift` | 6px | 0px | how far an entering surface travels |
| `--ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` | — | state changes in place (color, background) |
| `--ease-out` | `cubic-bezier(0.22, 1, 0.36, 1)` | — | entrances |
| `--ease-emphasized` | `cubic-bezier(0.3, 0, 0, 1.2)` | — | a confirmation that pops (slight overshoot) |
| `--ease-in-out` | `cubic-bezier(0.4, 0, 0.6, 1)` | — | loops |
| `--ease-linear` | `linear` | — | the spin and the shimmer |

These tokens are part of contract C4 (`docs/roadmap-1.4/contracts.md`): the Android app reads the same values from
the token export, so renaming one is a contract change.

## Choreography

| Surface | Enters | Leaves |
|---|---|---|
| Dialog (`ui/Dialog`, `ConfirmDialog`) | scrim fades in (`base`); the dialog fades and rises by `--motion-shift` (`base`, `ease-out`) | at once |
| Command palette, slash overlay, MCP, Skills, background jobs | fades and drops from above by `--motion-shift` (`base`, `ease-out`) | at once |
| Popover, menu (`ui/Popover`, `ui/Menu`) | fades and grows from 98% at its anchor (`fast`, `ease-out`) | at once |
| Tooltip | fades (`fast`) | at once |
| Tool panel (`ui/ToolPanel`) | fades (`base`) | at once |
| Toast | fades and rises by `--motion-shift` (`base`, `ease-out`) | at once, or after its time |
| List rows, timeline | appear in place; no stagger (a long list would make the last row wait) | at once |
| Mode and view switch (light/dark, Code/Thread/OxeQuery…) | instant: the whole window changes, and a cross-fade would show both states half-drawn | — |
| Hover and selection | background and color change (`fast`, `ease-standard`) | same |

## Loops

| Loop | Keyframe | Where |
|---|---|---|
| Spin | `oxe-spin` | `Spinner`, the loading `Button`, refresh icons (`.spin`, `.usage-spin`) |
| Shimmer | `oxe-shimmer` | `Skeleton`, the GitHub skeleton |
| Pulse | `oxe-pulse` | `StatusDot` running, activity dots, the Thread sidebar running mark, the mode switch's working dot, the cursor blink, the brand loader |

`oxe-pulse` touches only opacity and scale. Each use sets how deep the beat goes with `--pulse-opacity` (default
0.45) and `--pulse-scale` (default 1); a blink is `--pulse-opacity: 0` with `step-end` timing.

## Brand loader

`BrandLoader` (`src/ui/BrandLoader.tsx`) is the mandacaru from the logo, drawn from `src/design/brand.ts`: the
trunk stands still while the two arms sprout from it in turn, half a beat apart, and the sertão sun breathes with
them. It is for waits longer than a moment:

- a whole view loading (`<LoadingState brand />`: OxeQuery, OxePod, OxePost and the Thread view);
- the boot splash (F2);
- reconnecting (the offline state, F1).

A control, a row or a small panel keeps the `Spinner`: the brand loader is a signature, not a busy indicator for
every button.

## Microinteractions

| Moment | What moves | Where |
|---|---|---|
| Press | the control gives to 97% (94% for the round send button) under the pointer, `fast` | `ui/Button`, Thread approval buttons, the composer's Send (`.oxe-press`) |
| Copy | the check that replaces the copy icon pops in from 60% (`base`, `ease-emphasized`) | Thread code blocks and responses (`.oxe-confirm`); everything else confirms with a toast through `copyText` |
| Approve | the resolved request's check pops in the same way | Thread request card |
| Send | press on Send; the message then appears in the timeline in place | Thread composer |

## Reduced motion

Settings › Appearance › Motion offers System, Reduced and Full; System follows the operating system. The resolved
choice is `data-motion` on the root (`src/design/motion.ts`), and only that attribute is read: no stylesheet uses
`prefers-reduced-motion` (a lint test guards it), so the setting can override the system.

With `data-motion="reduce"`:

- every `--duration-*` used by transitions is `0ms`, and `--motion-shift` is `0px`: what moved now just appears,
  so motion is replaced by a change of opacity with nothing travelling;
- every animation runs for 0.01ms once (`src/styles/base.css`), so pulses and shimmers stand still and the brand
  loader shows the cactus fully grown;
- the one exception is the spin, which turns slowly (`--duration-spin: 2.4s`): a frozen spinner reads as a hang;
- presses do not scale.

## Not covered

Monaco and xterm animate on their own (cursor, smooth scrolling); they follow their own settings, not these tokens.

## Tests

- `tests/design-lint.test.ts`: the three keyframes and nothing else, the properties they animate, no fixed timing in
  any stylesheet, no `prefers-reduced-motion`.
- `tests/design-tokens.test.ts`: the generated CSS matches the token source.
- `tests/ui-states.test.tsx`: `BrandLoader` and `LoadingState brand`.
- `e2e/motion.spec.ts`: switching Motion between Full and Reduced changes what dialogs, loaders and the spinner do.
- `e2e/visual/design-system.spec.ts`: the Motion section, with animations frozen.
