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
    wbCanvas:     '--wb-canvas',
    wbSidebar:    '--wb-sidebar',
    wbChrome:     '--wb-chrome',
    wbRaised:     '--wb-raised',
    wbSelection:  '--wb-selection',
    wbBorder:     '--wb-border',
    wbFocus:      '--wb-focus',
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
  fontSize: {
    base: '--fs-base',
    lg:   '--fs-lg',
    sm:   '--fs-sm',
    xs:   '--fs-xs',
    xs2:  '--fs-2xs',
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
export const THEMES = ['default', 'midnight', 'nord', 'dracula', 'ocean', 'monokai', 'amber', 'rose-pine', 'gruvbox', 'one-dark', 'synthwave84', 'github-dark'] as const
export type Theme = (typeof THEMES)[number]

/** Density options keyed by data-density attribute value. */
export const DENSITIES = ['compact', 'comfortable'] as const
export type Density = (typeof DENSITIES)[number]
