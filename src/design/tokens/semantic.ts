/**
 * Semantic color roles. Components use these names only; a mode, surface style
 * (`default` vs `pure`), and color scheme decide which values fill each role.
 * Built on pure kepano/obsidian-minimal: achromatic dark graphite (#262626 /
 * #212121) and soft light (#ffffff / #f5f5f5), Slate Blue default accent, and
 * 8 desaturated literary semantic hues.
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
  const accent = p.slate
  const light = mode === 'light'
  const pure = surface === 'pure'
  // The terminal sits on Minimal dark chrome in both modes (and true black in dark OLED).
  const terminal = palette('dark').neutral
  const ink = (l: number) => oklchToHex({ l, c: 0, h: 0 })
  const intent = (name: 'success' | 'warning' | 'danger' | 'info') => ({
    [`intent-${name}-bg`]: s(p[name], 3),
    [`intent-${name}-bg-hover`]: s(p[name], 4),
    [`intent-${name}-border`]: s(p[name], 7),
    [`intent-${name}-solid`]: s(p[name], 9),
    [`intent-${name}-fg`]: s(p[name], 11)
  })

  // Exact kepano/obsidian-minimal surfaces:
  // Dark Default: #262626 canvas/base, #212121 chrome, #1c1c1c sunken, #2e2e2e raised, #363636 overlay
  // Dark Pure:    #000000 canvas/base/chrome/sunken, #111111 raised, #181818 overlay
  // Light Default:#ffffff canvas/base/raised/overlay, #f5f5f5 chrome, #efefef sunken
  // Light Pure:   #ffffff canvas/base/chrome/raised/overlay, #fafafa sunken
  const surfaceCanvas = light ? '#ffffff' : (pure ? '#000000' : '#262626')
  const surfaceBase = light ? '#ffffff' : (pure ? '#000000' : '#262626')
  const surfaceChrome = light ? (pure ? '#ffffff' : '#f5f5f5') : (pure ? '#000000' : '#212121')
  const surfaceSunken = light ? (pure ? '#fafafa' : '#efefef') : (pure ? '#000000' : '#1c1c1c')
  const surfaceRaised = light ? '#ffffff' : (pure ? '#111111' : '#2e2e2e')
  const surfaceOverlay = light ? '#ffffff' : (pure ? '#181818' : '#363636')

  const borderSubtle = light ? (pure ? '#e8e8e8' : '#e6e6e6') : (pure ? '#222222' : '#363636')
  const borderDefault = light ? (pure ? '#d8d8d8' : '#d6d6d6') : (pure ? '#303030' : '#454545')
  const borderStrong = light ? (pure ? '#c2c2c2' : '#c2c2c2') : (pure ? '#454545' : '#595959')
  const borderControlCandidates = pure
    ? (light ? ['#8c8c8c', '#808080', '#767676'] : ['#686868', '#767676', '#858585'])
    : (light ? ['#8c8c8c', '#808080', '#767676'] : ['#767676', '#808080', '#8c8c8c'])
  const borderControl = borderControlCandidates.find(hex => contrast(hex, surfaceCanvas) >= 3 && contrast(hex, surfaceRaised) >= 3) ?? s(n, 11)

  const fillHover = light ? (pure ? '#f2f2f2' : '#efefef') : (pure ? '#1a1a1a' : '#303030')
  const fillPressed = light ? (pure ? '#e6e6e6' : '#dcdcdc') : (pure ? '#242424' : '#383838')
  const fillSelected = light ? (pure ? '#eeeeee' : '#e6e6e6') : (pure ? '#1f1f1f' : '#333333')
  const fillSelectedStrong = light ? (pure ? '#e0e0e0' : '#d6d6d6') : (pure ? '#2a2a2a' : '#3e3e3e')

  // Soft literary text calibrated for WCAG AAA (>= 7:1 primary) and AA (>= 4.5:1 secondary & muted) on every surface and fill.
  const textPrimary = light ? '#222222' : (pure ? '#d8d8d8' : '#d1d1d1')
  const textSecondary = light ? '#4e4e4e' : (pure ? '#b5b5b5' : '#b8b8b8')
  const textMuted = light ? '#575757' : (pure ? '#9e9e9e' : '#a9a9a9')

  return {
    // Surfaces: authentic Obsidian Minimal tonal hierarchy from sunken/chrome up to overlays.
    'surface-canvas': surfaceCanvas,
    'surface-sunken': surfaceSunken,
    'surface-chrome': surfaceChrome,
    'surface-base': surfaceBase,
    'surface-raised': surfaceRaised,
    'surface-overlay': surfaceOverlay,
    'surface-inverse': s(n, 12),
    // Quiet neutral interaction fills; Slate Blue stays reserved for intentional accents.
    'fill-hover': fillHover,
    'fill-pressed': fillPressed,
    'fill-selected': fillSelected,
    'fill-selected-strong': fillSelectedStrong,
    // Text: three pure-neutral readable levels, AA on every surface and interaction fill.
    'text-primary': textPrimary,
    'text-secondary': textSecondary,
    'text-muted': textMuted,
    'text-disabled': s(n, 8),
    'text-on-accent': light ? '#ffffff' : s(accent, 1),
    // Labels on intent solids (danger, success, info buttons): white on light, dark ink on dark.
    'text-on-solid': light ? '#ffffff' : '#181818',
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
    // Accent (Obsidian Minimal Slate Blue).
    'accent': s(accent, 9),
    'accent-hover': s(accent, 10),
    'accent-soft': s(accent, 3),
    'accent-soft-hover': s(accent, 4),
    'accent-border': s(accent, 7),
    'focus-ring': s(accent, 9),
    // Brand semantic roles: monochrome Minimal ink for the logo/loader; amber for attention (retained for cross-platform contracts).
    'brand-mark': textPrimary,
    'brand-sun': s(p.amber, 9),
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
    // Terminal colors: desaturated literary hues at readable lightness for the mode.
    ...ansi(light),
    // Terminal surface aligned to Minimal dark chrome (or true black in dark OLED).
    'term-bg': pure && !light ? '#000000' : s(terminal, 1),
    'term-fg': s(terminal, 12),
    'term-line': pure && !light ? '#222222' : s(terminal, 5),
    // "needs you" (approvals, questions, stalled agents): desaturated literary amber.
    'attn': light ? oklchToHex({ l: 0.56, c: 0.11, h: SCALE_SPECS.amber.hue }) : s(p.amber, 9),
    'attn-bg': s(p.amber, 3),
    'attn-border': s(p.amber, 7),
    'attn-fg': s(p.amber, 11),
    // Resource kinds (files, databases, containers, requests, shells) in tabs, chips and activity bars.
    ...kind('file', p.info), ...kind('db', p.violet), ...kind('box', p.teal), ...kind('net', p.rose), ...kind('shell', n),
    // Syntax in editors, code blocks and diffs.
    'syn-kw': s(p.violet, 11),
    'syn-str': s(p.success, 11),
    'syn-num': s(p.rose, 11),
    'syn-fn': s(p.info, 11),
    'syn-type': s(p.teal, 11),
    'syn-key': s(p.amber, 11),
    'syn-cm': ink(light ? 0.45 : 0.75),
    'syn-pun': ink(light ? 0.45 : 0.77),
    'syn-var': s(p.amber, 11),
    'syn-var-bg': s(p.amber, 3),
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
    roles[`ws-${index + 1}`] = [9, 10, 11].map(step => s(scale, step)).find(hex => contrast(hex, surface) >= 3) ?? s(scale, 11)
    roles[`ws-${index + 1}-fg`] = s(scale, 11)
  })
  return roles
}

// Desaturated literary ANSI hues aligned to Obsidian Minimal's 8 semantic colors.
const ANSI_HUES = { red: 16, green: 132, yellow: 82, blue: 242, magenta: 292, cyan: 184 } as const

function ansi(light: boolean): ColorRoles {
  const neutral = (l: number) => oklchToHex({ l, c: 0, h: 0 })
  const roles: ColorRoles = light
    ? { 'ansi-black': neutral(0.24), 'ansi-white': neutral(0.45), 'ansi-bright-black': neutral(0.48), 'ansi-bright-white': neutral(0.32) }
    : { 'ansi-black': neutral(0.32), 'ansi-white': neutral(0.86), 'ansi-bright-black': neutral(0.71), 'ansi-bright-white': neutral(0.95) }
  for (const [name, hue] of Object.entries(ANSI_HUES)) {
    roles[`ansi-${name}`] = oklchToHex({ l: light ? 0.45 : 0.77, c: 0.11, h: hue })
    roles[`ansi-bright-${name}`] = oklchToHex({ l: light ? 0.39 : 0.85, c: 0.1, h: hue })
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
