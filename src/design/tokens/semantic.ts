/**
 * Semantic color roles. Components use these names only; a mode decides which
 * scale step fills each role. Since 1.5 (C4, the user's decision) the accent is
 * caatinga green in both modes, and the sertão sun means only "needs you" (attn).
 */
import { contrast, oklchToHex } from './color'
import { palette, SCALE_SPECS, type Mode, type Scale } from './palette'

export type ColorRoles = Record<string, string>

/** Step `n` (1-based) of a scale. */
const s = (scale: Scale, n: number): string => scale[n - 1]

export function colorRoles(mode: Mode): ColorRoles {
  const p = palette(mode)
  const n = p.neutral
  const accent = p.caatinga
  const light = mode === 'light'
  // The terminal reads the same in both modes (its own theme may override it).
  const terminal = palette('dark').neutral
  // Text keeps less of the night's violet than the surfaces do, so long reading stays neutral.
  const ink = (l: number) => oklchToHex({ l, c: (light ? 0.04 : 0.09) * 0.4, h: SCALE_SPECS.neutral.hue })
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
    'surface-sunken': light ? s(n, 3) : oklchToHex({ l: 0.145, c: 0.012, h: SCALE_SPECS.neutral.hue }),
    'surface-chrome': light ? s(n, 3) : s(n, 2),
    'surface-base': light ? s(n, 1) : s(n, 2),
    'surface-raised': light ? '#ffffff' : s(n, 3),
    'surface-overlay': light ? '#ffffff' : s(n, 4),
    'surface-inverse': s(n, 12),
    // Interaction fills on neutral surfaces.
    'fill-hover': light ? s(n, 4) : s(n, 4),
    'fill-pressed': s(n, 5),
    // U4 (X7): selection is the accent's tint in both modes, so it is visible in dark too.
    'fill-selected': s(accent, 4),
    'fill-selected-strong': light ? s(accent, 5) : s(accent, 7),
    // Text.
    // Three readable levels, set by lightness so each stays AA on every surface.
    'text-primary': ink(light ? 0.24 : 0.95),
    'text-secondary': ink(light ? 0.39 : 0.84),
    'text-muted': ink(light ? 0.47 : 0.72),
    'text-disabled': s(n, 8),
    'text-on-accent': light ? '#ffffff' : s(accent, 1),
    // Labels on intent solids (danger, success, info buttons): white on light, ink on dark.
    'text-on-solid': light ? '#ffffff' : s(n, 1),
    // Initials on avatar and provider colors, which are the same in both modes.
    'text-on-identity': '#ffffff',
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
    // 1.5: the terminal surface, the same in both modes.
    'term-bg': s(terminal, 2),
    'term-fg': s(terminal, 12),
    'term-line': s(terminal, 5),
    // 1.5: "needs you" (approvals, questions, stalled agents), and nothing else. Light darkens the sun so a dot or a
    // border reaches 3:1.
    'attn': light ? oklchToHex({ l: 0.6, c: 0.14, h: SCALE_SPECS.sun.hue }) : s(p.sun, 9),
    'attn-bg': s(p.sun, 3),
    'attn-border': s(p.sun, 7),
    'attn-fg': s(p.sun, 11),
    // 1.5: what a resource is (files, databases, containers, requests, shells) in tabs, chips and activity bars.
    ...kind('file', p.info), ...kind('db', p.violet), ...kind('box', p.teal), ...kind('net', p.rose), ...kind('shell', n),
    // 1.5: syntax in editors, code blocks and diffs.
    'syn-kw': s(p.violet, 11),
    'syn-str': s(p.success, 11),
    'syn-num': s(p.rose, 11),
    'syn-fn': s(p.info, 11),
    'syn-type': s(p.teal, 11),
    'syn-key': s(p.sun, 11),
    'syn-cm': ink(light ? 0.45 : 0.7),
    'syn-pun': ink(light ? 0.47 : 0.72),
    'syn-var': s(p.sun, 11),
    'syn-var-bg': s(p.sun, 3),
    // 1.5 (T85): workspace identity. The color marks a dot or a border; its -fg is the text on its own tint.
    ...workspaceColors(p, n, light ? s(n, 1) : s(n, 2)),
    // Scrim behind dialogs.
    'scrim': light ? 'rgba(18, 28, 22, 0.32)' : 'rgba(0, 0, 0, 0.56)'
  }
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
