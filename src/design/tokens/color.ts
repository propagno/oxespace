/**
 * OKLCH to sRGB conversion, gamut mapping and WCAG contrast. Pure, so the
 * token generator, the contrast test and the design-system viewer share it.
 */

export interface Oklch { l: number; c: number; h: number }

const linearToSrgb = (x: number): number => x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055
const srgbToLinear = (x: number): number => x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)

/** Linear sRGB channels for an OKLCH color; may fall outside 0–1 when out of gamut. */
function oklchToLinear({ l, c, h }: Oklch): [number, number, number] {
  const a = c * Math.cos(h * Math.PI / 180), b = c * Math.sin(h * Math.PI / 180)
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b
  const s_ = l - 0.0894841775 * a - 1.2914855480 * b
  const L = l_ ** 3, M = m_ ** 3, S = s_ ** 3
  return [
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.7076147010 * S
  ]
}

const inGamut = (rgb: number[]): boolean => rgb.every(value => value >= -1e-4 && value <= 1 + 1e-4)

/** Keeps lightness and hue and lowers chroma until the color fits in sRGB. */
export function clampToGamut(color: Oklch): Oklch {
  if (inGamut(oklchToLinear(color))) return color
  let low = 0, high = color.c
  for (let step = 0; step < 24; step += 1) {
    const mid = (low + high) / 2
    if (inGamut(oklchToLinear({ ...color, c: mid }))) low = mid
    else high = mid
  }
  return { ...color, c: low }
}

export function oklchToHex(color: Oklch): string {
  const rgb = oklchToLinear(clampToGamut(color)).map(value => Math.round(Math.min(1, Math.max(0, linearToSrgb(value))) * 255))
  return `#${rgb.map(value => value.toString(16).padStart(2, '0')).join('')}`
}

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace('#', '')
  const full = value.length === 3 ? value.split('').map(char => char + char).join('') : value.slice(0, 6)
  return [0, 2, 4].map(index => parseInt(full.slice(index, index + 2), 16) / 255) as [number, number, number]
}

/** WCAG 2 relative luminance of a hex color. */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(srgbToLinear)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG 2 contrast ratio between two opaque hex colors. */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

/** Alpha-composites a hex color with `alpha` over an opaque background. */
export function over(hex: string, alpha: number, background: string): string {
  const top = hexToRgb(hex), bottom = hexToRgb(background)
  return `#${top.map((value, index) => Math.round((value * alpha + bottom[index] * (1 - alpha)) * 255).toString(16).padStart(2, '0')).join('')}`
}
