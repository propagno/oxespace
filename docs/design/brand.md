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

The mark has one source: its geometry is in `src/design/brand.ts`, and the app icon's colors are the `--logo-tile`,
`--logo-mark` and `--logo-sun` tokens (`LOGO` in `src/design/tokens/palette.ts`), the same in both modes.
`npm run generate:icon` writes `resources/icon.svg` and every icon file from them. Nothing that draws the mark names a
color; `tests/brand-touchpoints.test.ts` enforces it and fails when an icon file drifts from the source.

## Color

All colors are 12-step scales in OKLCH, generated in `src/design/tokens/` for
light and dark mode.

| Role | Light | Dark | Use |
|---|---|---|---|
| **Caatinga** (green, hue 158) | accent | accent | Primary action, selection and focus, in both modes |
| **Sertão sun** (ochre, hue 72) | "needs you" | "needs you" | Only what waits for the person (`--attn`); never an accent |
| **Night** (neutral, violet hue 285) | surfaces, text | surfaces, text | Everything else; a purple night in dark mode, a faint lilac grey in light |
| Success · warning · danger · info | intents | intents | Status only; never decoration |

- The dark neutral carries more chroma (0.13) than the light one (0.04): the night reads violet, like the Dracula
  theme, while text keeps less of it so long reading stays neutral.
- The terminal sits on the night in both modes.
- Warning is an orange (hue 55), so it never looks like the sun.
- The eight workspace colors are teal, indigo, blue, olive, violet, plum, rose and slate. They never take the
  accent, the sun or warning, which mean action, "needs you" and risk. Colors are stored by slot, so a workspace
  that had caatinga, sun or warning now shows teal, indigo or plum.
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

## Touchpoints

Every place a person meets the brand, where it comes from, and the capture that checks it. Captures are visual
baselines under `e2e/visual/__screenshots__/<platform>/`, generated once per wave on `main`.

| | Touchpoint | Source | Capture |
|---|---|---|---|
| ✅ | App icon: taskbar, dock, installer, Start menu | `resources/icon.svg` → `icon.ico` (16–256), `icon.png` (512), `icons/` (16–1024) | the files are the capture; `tests/brand-touchpoints.test.ts` |
| ✅ | README banner and badges (caatinga and sun) | `docs/assets/logo.png`, rendered with the icon | the file |
| ✅ | Window favicon | `index.html` links `resources/icon.svg` | — (Electron shows it only in tools) |
| ✅ | Boot splash: the icon on the window's background until React renders, arms sprouting | `index.html` + `src/styles/splash.css` | `brand-touchpoints.spec.ts/splash-light`, `splash-dark` |
| ✅ | Title bar mark and wordmark | `OxeLogo` (`src/components/Brand`) | `anchor-surfaces.spec.ts/*` |
| ✅ | Empty states (`hero` variant) | `OxeLogo` | `anchor-surfaces.spec.ts/empty-*` |
| ✅ | Loading a whole view (OxeQuery, OxePod, OxePost, Thread) | `LoadingState brand` → `BrandLoader` | `design-system.spec.ts/design-system-motion` |
| ✅ | A view or panel that crashed (`ErrorBoundary`) and a whole-view `ErrorState brand` | `BrandMark` in `ErrorState` | `design-system.spec.ts/design-system-states` |
| ✅ | The window crashed above every view (root `ErrorBoundary page`): the mark, Try again and Reload window | `src/main.tsx` | `tests/ui-states.test.tsx` |
| ⏳ | About dialog: version, channel, licenses, links | needs `app:about` (contract PR #158, BE B8) | after #158 |
| ⏳ | Native notifications carry an icon by meaning (attention, done, failed, info) | the window names the meaning, the main process picks the image (contract #158, BE B8) | after B8 |
| ⏳ | Native crash dialog when the window's process ends | main process (`render-process-gone`), BE B8 | after B8 |
| ✅ | Design system viewer: mark, wordmark, scales | `DesignSystemPage` › Brand | `design-system.spec.ts/*` |

