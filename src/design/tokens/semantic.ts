/**
 * Semantic color roles. Components use these names only; a mode decides which
 * scale step fills each role. The accent is caatinga green in light mode and
 * sertão sun in dark mode.
 */
import { oklchToHex } from './color'
import { palette, SCALE_SPECS, type Mode, type Scale } from './palette'

export type ColorRoles = Record<string, string>

/** Step `n` (1-based) of a scale. */
const s = (scale: Scale, n: number): string => scale[n - 1]

export function colorRoles(mode: Mode): ColorRoles {
  const p = palette(mode)
  const n = p.neutral
  const accent = mode === 'light' ? p.caatinga : p.sun
  const light = mode === 'light'
  const ink = (l: number) => oklchToHex({ l, c: SCALE_SPECS.neutral.chroma * 0.4, h: SCALE_SPECS.neutral.hue })
  const intent = (name: 'success' | 'warning' | 'danger' | 'info') => ({
    [`intent-${name}-bg`]: s(p[name], 3),
    [`intent-${name}-bg-hover`]: s(p[name], 4),
    [`intent-${name}-border`]: s(p[name], 7),
    [`intent-${name}-solid`]: s(p[name], 9),
    [`intent-${name}-fg`]: s(p[name], 11)
  })
  return {
    // Surfaces, from the window background up to floating layers.
    'surface-canvas': light ? s(n, 2) : s(n, 1),
    'surface-sunken': light ? s(n, 3) : '#0c110e',
    'surface-chrome': light ? s(n, 3) : s(n, 2),
    'surface-base': light ? s(n, 1) : s(n, 2),
    'surface-raised': light ? '#ffffff' : s(n, 3),
    'surface-overlay': light ? '#ffffff' : s(n, 4),
    'surface-inverse': s(n, 12),
    // Interaction fills on neutral surfaces.
    'fill-hover': light ? s(n, 4) : s(n, 4),
    'fill-pressed': s(n, 5),
    'fill-selected': s(accent, 4),
    'fill-selected-strong': s(accent, 5),
    // Text.
    // Three readable levels, set by lightness so each stays AA on every surface.
    'text-primary': ink(light ? 0.24 : 0.95),
    'text-secondary': ink(light ? 0.39 : 0.84),
    'text-muted': ink(light ? 0.5 : 0.72),
    'text-disabled': s(n, 8),
    'text-on-accent': light ? '#ffffff' : s(accent, 1),
    'text-on-solid': '#ffffff',
    'text-accent': s(accent, 11),
    'text-link': s(p.info, 11),
    // Borders.
    'border-subtle': s(n, 5),
    'border-default': s(n, 6),
    'border-strong': s(n, 7),
    'border-focus': s(accent, 9),
    // Accent.
    'accent': s(accent, 9),
    'accent-hover': s(accent, 10),
    'accent-soft': s(accent, 3),
    'accent-soft-hover': s(accent, 4),
    'accent-border': s(accent, 7),
    'focus-ring': s(accent, 9),
    // Brand marks keep caatinga green and the sun in both modes.
    'brand-mark': light ? s(p.caatinga, 9) : s(p.caatinga, 10),
    'brand-sun': s(p.sun, 9),
    ...intent('success'),
    ...intent('warning'),
    ...intent('danger'),
    ...intent('info'),
    // Code review.
    'diff-add-bg': s(p.success, 3),
    'diff-add-strong': s(p.success, 5),
    'diff-del-bg': s(p.danger, 3),
    'diff-del-strong': s(p.danger, 5),
    // Terminal colors: hues at readable lightness for the mode; bright variants sit closer to the text.
    ...ansi(light),
    // Scrim behind dialogs.
    'scrim': light ? 'rgba(18, 28, 22, 0.32)' : 'rgba(0, 0, 0, 0.56)'
  }
}

const ANSI_HUES = { red: 27, green: 148, yellow: 80, blue: 250, magenta: 330, cyan: 200 } as const

function ansi(light: boolean): ColorRoles {
  const neutral = (l: number) => oklchToHex({ l, c: 0.01, h: SCALE_SPECS.neutral.hue })
  const roles: ColorRoles = light
    ? { 'ansi-black': neutral(0.24), 'ansi-white': neutral(0.45), 'ansi-bright-black': neutral(0.52), 'ansi-bright-white': neutral(0.32) }
    : { 'ansi-black': neutral(0.32), 'ansi-white': neutral(0.88), 'ansi-bright-black': neutral(0.62), 'ansi-bright-white': neutral(0.97) }
  for (const [name, hue] of Object.entries(ANSI_HUES)) {
    roles[`ansi-${name}`] = oklchToHex({ l: light ? 0.5 : 0.74, c: 0.15, h: hue })
    roles[`ansi-bright-${name}`] = oklchToHex({ l: light ? 0.42 : 0.84, c: 0.13, h: hue })
  }
  return roles
}

/** Shadows per elevation step; dark mode leans on borders, light mode on soft shadows. */
export function elevations(mode: Mode): Record<string, string> {
  const ink = mode === 'light' ? '18, 32, 24' : '0, 0, 0'
  const strength = mode === 'light' ? 1 : 2.2
  const a = (value: number) => Math.min(0.9, value * strength).toFixed(2)
  return {
    'elevation-1': `0 1px 2px rgba(${ink}, ${a(0.06)})`,
    'elevation-2': `0 2px 6px rgba(${ink}, ${a(0.08)}), 0 1px 2px rgba(${ink}, ${a(0.05)})`,
    'elevation-3': `0 8px 24px rgba(${ink}, ${a(0.12)}), 0 2px 6px rgba(${ink}, ${a(0.06)})`,
    'elevation-4': `0 16px 48px rgba(${ink}, ${a(0.18)}), 0 4px 12px rgba(${ink}, ${a(0.08)})`
  }
}
