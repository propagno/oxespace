# OXESpace brand: Mandacaru

Chosen on 2026-10-13 from three directions (Órbita, Mandacaru, Sinal).

## Idea

"Oxe" is an expression from the Brazilian Northeast. The brand takes the name
seriously: the **mandacaru**, the cactus that stands in dry ground, resilient
and unmistakable. Its branching shape is also the product: one task that splits
into agents and comes back together.

The tone is warm but serious. Local in character, professional in use: the
interface is a developer tool first.

## Symbol

A mandacaru drawn as a branching stroke: a trunk with two arms, the right arm
higher than the left, and a small sun beside it.

- Strokes have round caps and joins, at a weight of 1/11 of the symbol's size.
- On the app icon the symbol is white on caatinga green, and the sun is ochre.
- Inline, the symbol takes the current text color, and the sun keeps its ochre.
- The minimum size is 14px. Below 20px the sun is dropped.

The wordmark is `oxespace` in lowercase, set in Bricolage Grotesque Bold.

## Color

All colors are 12-step scales in OKLCH, generated in `src/design/tokens/` for
light and dark mode.

| Role | Light | Dark | Use |
|---|---|---|---|
| **Caatinga** (green, hue 158) | accent | brand mark only | Primary action, selection and focus in light mode |
| **Sertão sun** (ochre, hue 72) | highlights | accent | Primary action, selection and focus in dark mode |
| **Neutral** (green-tinted grey) | surfaces, text | surfaces, text | Everything else |
| Success · warning · danger · info | intents | intents | Status only; never decoration |

- The accent changes between modes on purpose. Green reads calm on light clay,
  and ochre reads like sunlight on the dark night.
- Warning is an orange (hue 55), so it never looks like the dark-mode accent.
- Provider colors (Claude, Codex…) identify the provider only and are never
  used as interface colors.
- Every text and surface pair meets WCAG AA in both modes. A test enforces this.

## Type

| Role | Family | Use |
|---|---|---|
| Display | Bricolage Grotesque (variable) | Page titles, empty states, the wordmark. Never body text. |
| Interface | IBM Plex Sans 400 · 500 · 600 | Everything people read and operate |
| Code | IBM Plex Mono 400 · 500 | Code, paths, commands, terminal, numbers in tables |

All three ship with the app (OFL). The type scale is short: 11, 12, 13, 14, 16
and 20px, plus 28px display. 13px is the default in compact density.

## Shape and depth

- **Radii:** 6px controls, 8px rows and chips, 12px cards and panels, 16px
  dialogs. The radius grows with the size of the object.
- **Depth:** one border plus a soft shadow per elevation step. Surfaces never
  stack more than two levels.
- **Motion:** 120ms for hover and press, 200ms for panels, standard easing.
  Nothing moves when the person prefers reduced motion.

## Voice

Plain, direct English. Labels are verbs ("Allow", "Undo file"). Errors say what
happened and what to do. No exclamation marks and no jokes in errors.

## Themes

Light and dark modes replace the eleven dark palettes of 0.17 (Midnight, Nord,
Dracula…). The mode follows the operating system unless chosen in Settings.
Saved workspace themes are still read but no longer change colors.
