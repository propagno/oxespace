/**
 * Obsidian Minimal palette (kepano/obsidian-minimal): 12-step scales per hue,
 * generated in OKLCH for light and dark mode. Steps follow one convention:
 *
 *   1–2  backgrounds          3–5  component fills (rest, hover, pressed)
 *   6–8  borders (subtle → strong, 8 also focus)
 *   9–10 solid fills (rest, hover)
 *   11   readable text on steps 1–3        12  high-contrast text
 */
import { oklchToHex } from './color'

export type Mode = 'light' | 'dark'
export type Scale = readonly string[] & { length: 12 }

export interface ScaleSpec {
  hue: number
  /** Peak chroma, reached at the solid step. */
  chroma: number | Record<Mode, number>
  /** Lightness of the solid step (9) in each mode. */
  solid: Record<Mode, number>
  /** Optional custom 12-step lightness ramp (used by the achromatic Minimal neutral scale). */
  lightness?: Record<Mode, number[]>
}

// Lightness and relative chroma per step; 9 and 10 come from the spec.
const LIGHTNESS: Record<Mode, number[]> = {
  light: [0.992, 0.978, 0.955, 0.932, 0.905, 0.872, 0.822, 0.748, 0, 0, 0.445, 0.25],
  dark: [0.168, 0.198, 0.236, 0.266, 0.298, 0.338, 0.392, 0.47, 0, 0, 0.82, 0.945]
}

// Pure achromatic Obsidian Minimal neutral ramp (--base-l: 15% dark, --base-l: 96% light):
//   light: #ffffff, #f5f5f5, #efefef, #e6e6e6, #dcdcdc, #d6d6d6, #c2c2c2, #9e9e9e, #747474, #656565, #575757, #222222
//   dark:  #212121, #262626, #2e2e2e, #363636, #454545, #595959, #6c6c6c, #808080, #929292, #a1a1a1, #b9b9b9, #d1d1d1
const NEUTRAL_LIGHTNESS: Record<Mode, number[]> = {
  light: [1.0, 0.97, 0.953, 0.925, 0.896, 0.876, 0.814, 0.7, 0, 0, 0.455, 0.252],
  dark: [0.248, 0.268, 0.302, 0.333, 0.39, 0.464, 0.53, 0.6, 0, 0, 0.785, 0.861]
}

const CHROMA: Record<Mode, number[]> = {
  light: [0.06, 0.1, 0.2, 0.3, 0.4, 0.5, 0.62, 0.78, 1, 0.96, 0.86, 0.55],
  dark: [0.16, 0.2, 0.3, 0.38, 0.46, 0.55, 0.65, 0.8, 1, 0.95, 0.78, 0.35]
}

export function generateScale(spec: ScaleSpec, mode: Mode): Scale {
  const solid = spec.solid[mode]
  // The hover step moves away from the background: darker in light mode, lighter in dark.
  const hover = mode === 'light' ? solid - 0.05 : solid + 0.05
  const ramp = (spec.lightness ?? LIGHTNESS)[mode]
  return ramp.map((l, index) => oklchToHex({
    l: index === 8 ? solid : index === 9 ? hover : l,
    c: (typeof spec.chroma === 'number' ? spec.chroma : spec.chroma[mode]) * CHROMA[mode][index],
    h: spec.hue
  })) as unknown as Scale
}

export const SCALE_SPECS = {
  /** Pure achromatic neutral for Obsidian Minimal surfaces, borders and text. */
  neutral: { hue: 0, chroma: { light: 0, dark: 0 }, solid: { light: 0.56, dark: 0.66 }, lightness: NEUTRAL_LIGHTNESS },
  /** Minimal default Slate Blue accent (--accent-h: 201 family, calibrated in OKLCH for WCAG AA). */
  slate: { hue: 235, chroma: 0.085, solid: { light: 0.47, dark: 0.72 } },
  /** Desaturated literary yellow/amber (#e5b567 family) — "needs you" (attn). */
  amber: { hue: 82, chroma: 0.11, solid: { light: 0.68, dark: 0.79 } },
  /** Desaturated literary sage green (#a8c373 family) — success. */
  success: { hue: 132, chroma: 0.105, solid: { light: 0.5, dark: 0.75 } },
  /** Desaturated literary orange (#d5763f family) — warning. */
  warning: { hue: 52, chroma: 0.125, solid: { light: 0.58, dark: 0.73 } },
  /** Desaturated literary crimson red (#d04255 family) — danger. */
  danger: { hue: 16, chroma: 0.15, solid: { light: 0.52, dark: 0.69 } },
  /** Desaturated literary blue (#6c99bb family) — info. */
  info: { hue: 242, chroma: 0.095, solid: { light: 0.49, dark: 0.73 } },
  /** Desaturated literary purple (#9e86c8 family) — resource kinds & syntax. */
  violet: { hue: 292, chroma: 0.105, solid: { light: 0.5, dark: 0.74 } },
  /** Desaturated literary cyan/teal (#73bbb2 family) — resource kinds & syntax. */
  teal: { hue: 184, chroma: 0.085, solid: { light: 0.49, dark: 0.75 } },
  /** Desaturated literary pink/rose (#b05279 family) — resource kinds & syntax. */
  rose: { hue: 354, chroma: 0.115, solid: { light: 0.5, dark: 0.73 } },
  /** Workspace swatch hues (desaturated literary companion tones). */
  olive: { hue: 112, chroma: 0.095, solid: { light: 0.49, dark: 0.76 } },
  indigo: { hue: 265, chroma: 0.105, solid: { light: 0.49, dark: 0.73 } },
  plum: { hue: 322, chroma: 0.105, solid: { light: 0.5, dark: 0.74 } }
} satisfies Record<string, ScaleSpec>

export type ScaleName = keyof typeof SCALE_SPECS

export function palette(mode: Mode): Record<ScaleName, Scale> {
  return Object.fromEntries(Object.entries(SCALE_SPECS).map(([name, spec]) => [name, generateScale(spec, mode)])) as Record<ScaleName, Scale>
}

/**
 * Monochrome Obsidian Minimal colors for the Mandacaru Ramo logo; resources/icon.svg
 * and Android's launcher drawables read directly from here.
 */
export const LOGO = { tile: '#212121', mark: '#d8d8d8' } as const

/** Identity colors; they mark a provider or an avatar and never style the interface. */
export const IDENTITY = {
  provider: { claude: '#c2643f', codex: '#10a37f', copilot: '#24b2d5', antigravity: '#1a73e8', cursor: '#6366f1', grok: '#6b6b6b', custom: '#64748b' },
  avatar: ['#2563eb', '#7c3aed', '#db2777', '#d97706', '#059669', '#0891b2']
} as const
