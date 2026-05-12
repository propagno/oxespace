/**
 * OXESpace design tokens — CSS custom property references for use in JS/TS.
 *
 * Usage:
 *   import { TOKENS } from '../design-system/tokens'
 *   // In xterm theme, canvas renderers, or JS animations:
 *   background: getComputedStyle(document.documentElement).getPropertyValue(TOKENS.color.bgApp)
 */

export const TOKENS = {
  color: {
    // Backgrounds
    bgApp:         '--bg-app',
    bgSidebar:     '--bg-sidebar',
    bgElevated:    '--bg-elevated',
    bgTile:        '--bg-tile',
    bgTileHeader:  '--bg-tile-header',
    bgTileAgent:   '--bg-tile-agent',
    bgTileContent: '--bg-tile-content',
    bgStatusbar:   '--bg-statusbar',
    bgWsActive:    '--bg-ws-active',
    bgWsHover:     '--bg-ws-hover',
    bgModal:       '--bg-modal',
    bgInput:       '--bg-input',
    bgSegment:     '--bg-segment',

    // Borders (values are colors, not shorthand)
    bdTile:        '--bd-tile',
    bdDivider:     '--bd-divider',
    bdSidebar:     '--bd-sidebar',
    bdWsActive:    '--bd-ws-active',
    bdInput:       '--bd-input',
    bdInputFocus:  '--bd-input-focus',
    bdSubtle:      '--bd-subtle',
    bdBase:        '--bd-base',

    // Text
    txPrimary:     '--tx-primary',
    txSecondary:   '--tx-secondary',
    txMuted:       '--tx-muted',
    txLabel:       '--tx-label',
    txAgentMeta:   '--tx-agent-meta',

    // Status dots
    dotGreen:      '--dot-green',
    dotOrange:     '--dot-orange',
    dotYellow:     '--dot-yellow',
    dotBlue:       '--dot-blue',
    dotPurple:     '--dot-purple',
    dotGray:       '--dot-gray',
    dotRed:        '--dot-red',

    // Brand
    brand:         '--brand',
    brandLight:    '--brand-light',
    brandLightest: '--brand-lightest',
    brandDark:     '--brand-dark',

    // Accents
    accent:        '--accent',
    accentHover:   '--accent-hover',
    badgeBg:       '--badge-bg',
    badgeText:     '--badge-text',
  },
  font: {
    ui:   '--font-ui',
    mono: '--font-mono',
  },
  size: {
    sidebarW:          '--sidebar-w',
    sidebarWCollapsed: '--sidebar-w-collapsed',
    tileHeaderH:       '--tile-header-h',
    tileAgentH:        '--tile-agent-h',
    tileStatusbarH:    '--tile-statusbar-h',
    wsItemH:           '--ws-item-h',
  },
} as const

export type TokenPath = typeof TOKENS

/** Resolve a token to its current computed value at runtime. */
export function resolveToken(token: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(token).trim()
}

/** All available themes keyed by data-theme attribute value. */
export const THEMES = ['default', 'nord', 'dracula', 'ocean', 'monokai', 'amber'] as const
export type Theme = (typeof THEMES)[number]

/** Density options keyed by data-density attribute value. */
export const DENSITIES = ['compact', 'comfortable'] as const
export type Density = (typeof DENSITIES)[number]
