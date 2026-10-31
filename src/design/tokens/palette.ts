/**
 * Mandacaru palette: 12-step scales per hue, generated in OKLCH for light and
 * dark mode. Steps follow one convention everywhere:
 *
 *   1–2  backgrounds          3–5  component fills (rest, hover, pressed)
 *   6–8  borders (subtle → strong, 8 also focus)
 *   9–10 solid fills (rest, hover)
 *   11   readable text on steps 1–3        12  high-contrast text
 */
import { oklchToHex } from './color'

export type Mode = 'light' | 'dark'
export type Scale = readonly string[] & { length: 12 }

interface ScaleSpec {
  hue: number
  /** Peak chroma, reached at the solid step. */
  chroma: number
  /** Lightness of the solid step (9) in each mode. */
  solid: Record<Mode, number>
}

// Lightness and relative chroma per step; 9 and 10 come from the spec.
const LIGHTNESS: Record<Mode, number[]> = {
  light: [0.992, 0.978, 0.955, 0.932, 0.905, 0.872, 0.822, 0.748, 0, 0, 0.49, 0.26],
  dark: [0.168, 0.198, 0.236, 0.266, 0.298, 0.338, 0.392, 0.47, 0, 0, 0.81, 0.945]
}
const CHROMA: Record<Mode, number[]> = {
  light: [0.06, 0.1, 0.2, 0.3, 0.4, 0.5, 0.62, 0.78, 1, 0.96, 0.86, 0.55],
  dark: [0.16, 0.2, 0.3, 0.38, 0.46, 0.55, 0.65, 0.8, 1, 0.95, 0.78, 0.35]
}

export function generateScale(spec: ScaleSpec, mode: Mode): Scale {
  const solid = spec.solid[mode]
  // The hover step moves away from the background: darker in light mode, lighter in dark.
  const hover = mode === 'light' ? solid - 0.05 : solid + 0.05
  return LIGHTNESS[mode].map((l, index) => oklchToHex({
    l: index === 8 ? solid : index === 9 ? hover : l,
    c: spec.chroma * CHROMA[mode][index],
    h: spec.hue
  })) as unknown as Scale
}

export const SCALE_SPECS = {
  /** Green-tinted grey for surfaces, borders and text. */
  neutral: { hue: 155, chroma: 0.034, solid: { light: 0.6, dark: 0.56 } },
  /** Caatinga green: the light-mode accent and the brand mark. */
  caatinga: { hue: 158, chroma: 0.11, solid: { light: 0.47, dark: 0.64 } },
  /** Sertão sun: the dark-mode accent. */
  sun: { hue: 72, chroma: 0.15, solid: { light: 0.72, dark: 0.79 } },
  success: { hue: 148, chroma: 0.14, solid: { light: 0.54, dark: 0.7 } },
  /** Orange rather than ochre, so a warning never reads as the dark-mode accent. */
  warning: { hue: 52, chroma: 0.16, solid: { light: 0.64, dark: 0.72 } },
  danger: { hue: 25, chroma: 0.19, solid: { light: 0.55, dark: 0.66 } },
  info: { hue: 245, chroma: 0.13, solid: { light: 0.54, dark: 0.7 } }
} satisfies Record<string, ScaleSpec>

export type ScaleName = keyof typeof SCALE_SPECS

export function palette(mode: Mode): Record<ScaleName, Scale> {
  return Object.fromEntries(Object.entries(SCALE_SPECS).map(([name, spec]) => [name, generateScale(spec, mode)])) as Record<ScaleName, Scale>
}

/** Identity colors; they mark a provider or an avatar and never style the interface. */
/**
 * The app icon's colors (docs/design/brand.md): white cactus on the caatinga tile with the sertão sun. They are the
 * same in both modes, because the icon is the same on every desktop; resources/icon.svg uses exactly these.
 */
export const LOGO = { tile: '#1f6b4a', mark: '#ffffff', sun: '#e8a33d' } as const

export const IDENTITY = {
  provider: { claude: '#c2643f', codex: '#10a37f', copilot: '#24b2d5', antigravity: '#1a73e8', cursor: '#6366f1', grok: '#6b6b6b', custom: '#64748b' },
  avatar: ['#2563eb', '#7c3aed', '#db2777', '#d97706', '#059669', '#0891b2']
} as const
