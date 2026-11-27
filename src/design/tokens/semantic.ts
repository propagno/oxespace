/**
 * Semantic color roles. Components use these names only; a mode and surface
 * style decide which scale step fills each role. Obsidian Minimal provides the
 * achromatic graphite/white surface hierarchy (with True Black OLED & Pure White
 * presets), while Mandacaru preserves caatinga green (accent) and sertão sun (attn).
 */
import { contrast, oklchToHex } from './color'
import { palette, SCALE_SPECS, type Mode, type Scale } from './palette'

export type ColorRoles = Record<string, string>
export type SurfaceStyle = 'default' | 'pure'

/** Step `n` (1-based) of a scale. */
const s = (scale: Scale, n: number): string => scale[n - 1]

export function surfaceColorRoles(mode: Mode, surface: SurfaceStyle): ColorRoles {
  const p = palette(mode)
  const n = p.neutral
  const accent = p.caatinga
  const light = mode === 'light'
  const pure = surface === 'pure'
  // The terminal sits on neutral dark in both modes (and pure black in dark OLED).
  const terminal = palette('dark').neutral
  // Pure achromatic ink so long reading stays calm and neutral across every surface.
  const ink = (l: number) => oklchToHex({ l, c: 0, h: 0 })
  const intent = (name: 'success' | 'warning' | 'danger' | 'info') => ({
    [`intent-${name}-bg`]: s(p[name], 3),
    [`intent-${name}-bg-hover`]: s(p[name], 4),
    [`intent-${name}-border`]: s(p[name], 7),
    [`intent-${name}-solid`]: s(p[name], 9),
    [`intent-${name}-fg`]: s(p[name], 11)
  })
  const surfaceCanvas = light ? '#ffffff' : (pure ? '#000000' : s(n, 2))
  const surfaceBase = light ? '#ffffff' : (pure ? '#000000' : s(n, 2))
  const surfaceChrome = light ? (pure ? '#ffffff' : s(n, 2)) : (pure ? '#000000' : s(n, 1))
  const surfaceSunken = light ? (pure ? '#fafafa' : s(n, 3)) : (pure ? '#000000' : oklchToHex({ l: 0.19, c: 0, h: 0 }))
  const surfaceRaised = light ? '#ffffff' : (pure ? '#111111' : s(n, 3))
  const surfaceOverlay = light ? '#ffffff' : (pure ? '#181818' : s(n, 4))

  const borderSubtle = light ? (pure ? '#e8e8e8' : s(n, 4)) : (pure ? '#222222' : oklchToHex({ l: 0.285, c: 0, h: 0 }))
  const borderDefault = light ? (pure ? '#dcdcdc' : s(n, 6)) : (pure ? '#2e2e2e' : s(n, 5))
  const borderStrong = light ? (pure ? '#c4c4c4' : s(n, 7)) : (pure ? '#424242' : s(n, 7))
  const borderControlCandidates = pure
    ? (light ? ['#8c8c8c', '#808080', '#767676'] : ['#686868', '#767676', '#858585'])
    : n
  const borderControl = borderControlCandidates.find(hex => contrast(hex, surfaceCanvas) >= 3 && contrast(hex, surfaceRaised) >= 3) ?? s(n, 11)

  const fillHover = light ? (pure ? '#f2f2f2' : '#efefef') : (pure ? '#1a1a1a' : s(n, 4))
  const fillPressed = light ? (pure ? '#e8e8e8' : s(n, 5)) : (pure ? '#242424' : '#343434')
  const fillSelected = light ? (pure ? '#eeeeee' : s(n, 4)) : (pure ? '#1f1f1f' : '#2f2f2f')
  const fillSelectedStrong = light ? (pure ? '#e3e3e3' : s(n, 6)) : (pure ? '#2a2a2a' : s(n, 6))

  const textPrimary = light ? ink(0.22) : (pure ? '#d8d8d8' : ink(0.93))
  const textSecondary = light ? ink(0.4) : (pure ? '#a3a3a3' : ink(0.79))
  const textMuted = light ? ink(0.49) : (pure ? '#858585' : ink(0.68))

  return {
    // Surfaces: restrained Obsidian Minimal tonal hierarchy from chrome/sunken up to overlays.
    'surface-canvas': surfaceCanvas,
    'surface-sunken': surfaceSunken,
    'surface-chrome': surfaceChrome,
    'surface-base': surfaceBase,
    'surface-raised': surfaceRaised,
    'surface-overlay': surfaceOverlay,
    'surface-inverse': s(n, 12),
    // Calm Minimal neutral interaction fills; caatinga green stays reserved for intentional accents.
    'fill-hover': fillHover,
    'fill-pressed': fillPressed,
    'fill-selected': fillSelected,
    'fill-selected-strong': fillSelectedStrong,
    // Text: three pure-neutral readable levels, AA on every surface.
    'text-primary': textPrimary,
    'text-secondary': textSecondary,
    'text-muted': textMuted,
    'text-disabled': s(n, 8),
    'text-on-accent': light ? '#ffffff' : s(accent, 1),
    // Labels on intent solids (danger, success, info buttons): white on light, ink on dark.
    'text-on-solid': light ? '#ffffff' : s(n, 1),
    // Initials on avatar and provider colors, which are the same in both modes.
    'text-on-identity': '#ffffff',
    'text-accent': s(accent, 11),
    'text-link': s(p.info, 11),
    // Hairline quiet neutral borders; border-control meets >= 3:1 against canvas and raised.
    'border-subtle': borderSubtle,
    'border-default': borderDefault,
    'border-strong': borderStrong,
    'border-control': borderControl,
    'border-focus': s(accent, 9),
    // Accent (Mandacaru caatinga green).
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
    'intent-danger-solid-hover': s(p.danger, 10),
    ...intent('info'),
    // Code review.
    'diff-add-bg': s(p.success, 3),
    'diff-add-strong': s(p.success, 5),
    'diff-del-bg': s(p.danger, 3),
    'diff-del-strong': s(p.danger, 5),
    // Terminal colors: hues at readable lightness for the mode; bright variants sit closer to the text.
    ...ansi(light),
    // Terminal surface aligned to neutral dark (or true black in dark OLED).
    'term-bg': pure && !light ? '#000000' : s(terminal, 1),
    'term-fg': s(terminal, 12),
    'term-line': pure && !light ? '#222222' : s(terminal, 5),
    // "needs you" (approvals, questions, stalled agents), and nothing else. Light darkens the sun so a dot or a
    // border reaches 3:1.
    'attn': light ? oklchToHex({ l: 0.6, c: 0.14, h: SCALE_SPECS.sun.hue }) : s(p.sun, 9),
    'attn-bg': s(p.sun, 3),
    'attn-border': s(p.sun, 7),
    'attn-fg': s(p.sun, 11),
    // Resource kinds (files, databases, containers, requests, shells) in tabs, chips and activity bars.
    ...kind('file', p.info), ...kind('db', p.violet), ...kind('box', p.teal), ...kind('net', p.rose), ...kind('shell', n),
    // Syntax in editors, code blocks and diffs.
    'syn-kw': s(p.violet, 11),
    'syn-str': s(p.success, 11),
    'syn-num': s(p.rose, 11),
    'syn-fn': s(p.info, 11),
    'syn-type': s(p.teal, 11),
    'syn-key': s(p.sun, 11),
    'syn-cm': ink(light ? 0.45 : 0.72),
    'syn-pun': ink(light ? 0.47 : 0.74),
    'syn-var': s(p.sun, 11),
    'syn-var-bg': s(p.sun, 3),
    // Workspace identity. The color marks a dot or a border; its -fg is the text on its own tint.
    ...workspaceColors(p, n, surfaceBase),
    // Scrim behind dialogs.
    'scrim': light ? 'rgba(0, 0, 0, 0.30)' : 'rgba(0, 0, 0, 0.56)'
  }
}

export function colorRoles(mode: Mode, surface: SurfaceStyle = 'default'): ColorRoles {
  return surfaceColorRoles(mode, surface)
}

/** A resource kind: the mark, its tint and text on that tint. */
function kind(name: string, scale: Scale): ColorRoles {
  return { [`k-${name}`]: s(scale, 9), [`k-${name}-bg`]: s(scale, 3), [`k-${name}-fg`]: s(scale, 11) }
}

/** The eight workspace colors (T85), in the order the person picks them. */
export const WORKSPACE_SCALES = ['teal', 'indigo', 'info', 'olive', 'violet', 'plum', 'rose', 'neutral'] as const
/** How much of a workspace's color tints its chip, per mode (color-mix over the surface). */
export const WORKSPACE_TINT = { light: 0.12, dark: 0.16 } as const

function workspaceColors(p: ReturnType<typeof palette>, n: Scale, surface: string): ColorRoles {
  const roles: ColorRoles = {}
  WORKSPACE_SCALES.forEach((name, index) => {
    const scale = name === 'neutral' ? n : p[name]
    // The mark is the solid step, or the next one down when a light hue (the sun) would not reach 3:1 on the surface.
    roles[`ws-${index + 1}`] = [9, 10, 11].map(step => s(scale, step)).find(hex => contrast(hex, surface) >= 3) ?? s(scale, 11)
    roles[`ws-${index + 1}-fg`] = s(scale, 11)
  })
  return roles
}

const ANSI_HUES = { red: 27, green: 148, yellow: 80, blue: 250, magenta: 330, cyan: 200 } as const

function ansi(light: boolean): ColorRoles {
  const neutral = (l: number) => oklchToHex({ l, c: 0, h: 0 })
  const roles: ColorRoles = light
    ? { 'ansi-black': neutral(0.24), 'ansi-white': neutral(0.45), 'ansi-bright-black': neutral(0.52), 'ansi-bright-white': neutral(0.32) }
    : { 'ansi-black': neutral(0.32), 'ansi-white': neutral(0.88), 'ansi-bright-black': neutral(0.62), 'ansi-bright-white': neutral(0.97) }
  for (const [name, hue] of Object.entries(ANSI_HUES)) {
    roles[`ansi-${name}`] = oklchToHex({ l: light ? 0.5 : 0.74, c: 0.15, h: hue })
    roles[`ansi-bright-${name}`] = oklchToHex({ l: light ? 0.42 : 0.84, c: 0.13, h: hue })
  }
  return roles
}

/** Restrained Minimal elevations: hairline outlines paired with quiet neutral shadows. */
export function elevations(mode: Mode, surface: SurfaceStyle = 'default'): Record<string, string> {
  if (mode === 'light') {
    return {
      'elevation-1': '0 1px 2px rgba(0, 0, 0, 0.04)',
      'elevation-2': '0 0 0 1px rgba(0, 0, 0, 0.05), 0 2px 6px rgba(0, 0, 0, 0.06)',
      'elevation-3': '0 0 0 1px rgba(0, 0, 0, 0.06), 0 6px 18px rgba(0, 0, 0, 0.08)',
      'elevation-4': '0 0 0 1px rgba(0, 0, 0, 0.08), 0 12px 32px rgba(0, 0, 0, 0.12)'
    }
  }
  if (surface === 'pure') {
    return {
      'elevation-1': '0 0 0 1px rgba(255, 255, 255, 0.08)',
      'elevation-2': '0 0 0 1px rgba(255, 255, 255, 0.10), 0 2px 8px rgba(0, 0, 0, 0.40)',
      'elevation-3': '0 0 0 1px rgba(255, 255, 255, 0.12), 0 8px 20px rgba(0, 0, 0, 0.50)',
      'elevation-4': '0 0 0 1px rgba(255, 255, 255, 0.14), 0 14px 36px rgba(0, 0, 0, 0.60)'
    }
  }
  return {
    'elevation-1': '0 1px 2px rgba(0, 0, 0, 0.24)',
    'elevation-2': '0 0 0 1px rgba(255, 255, 255, 0.06), 0 2px 8px rgba(0, 0, 0, 0.28)',
    'elevation-3': '0 0 0 1px rgba(255, 255, 255, 0.08), 0 8px 20px rgba(0, 0, 0, 0.36)',
    'elevation-4': '0 0 0 1px rgba(255, 255, 255, 0.10), 0 14px 36px rgba(0, 0, 0, 0.44)'
  }
}
