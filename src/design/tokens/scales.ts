/** Non-color scales: one source for spacing, type, shape, layers and motion. */

export const FONT = {
  display: "'Instrument Sans Variable', 'Instrument Sans', 'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif",
  ui: "'Instrument Sans Variable', 'Instrument Sans', 'Segoe UI Variable', 'Segoe UI', 'Ubuntu', 'Cantarell', system-ui, -apple-system, sans-serif",
  mono: "'IBM Plex Mono', 'Cascadia Code', 'JetBrains Mono', 'Consolas', 'DejaVu Sans Mono', ui-monospace, monospace"
} as const

/** Instrument Sans width for brand type: condensed for the 28px display step and the wordmark, a little less for page titles; 100% elsewhere. */
export const STRETCH = { display: '78%', title: '80%' } as const

/**
 * Spacing in 4px steps, plus the two half steps dense controls need (2 and 6). The 1.5.2 scale uses 2, 4, 6, 8, 12,
 * 16, 24, 32 and 48; 20 and 40 stay only for layouts already built on them (docs/design/brand.md › Scale).
 */
export const SPACE = { 0: '0px', '0-5': '2px', 1: '4px', '1-5': '6px', 2: '8px', 3: '12px', 4: '16px', 5: '20px', 6: '24px', 8: '32px', 10: '40px', 12: '48px' } as const

/**
 * Bar heights (1.5.2): the status bar; pane, panel and tab bars; the title bar and the sidebar and view headers, which
 * sit side by side and so match. Comfortable density adds 4px to the bars that hold controls.
 */
export const BAR = { compact: { sm: 24, md: 32, lg: 36 }, comfortable: { sm: 24, md: 36, lg: 40 } } as const

/** List rows (1.5.2): every one-line row (sidebar, menu, tree, Settings nav), and a two-line row that carries state. */
export const ROW = { compact: { 1: 28, 2: 44 }, comfortable: { 1: 32, 2: 48 } } as const

/** Type sizes for compact density; comfortable adds one pixel to each step up to `lg`. */
export const TEXT = { '2xs': 11, xs: 12, sm: 13, md: 14, lg: 16, xl: 20, display: 28 } as const
export const WEIGHT = { regular: 400, medium: 500, semibold: 600, bold: 700 } as const
export const LEADING = { tight: 1.25, snug: 1.4, normal: 1.55 } as const

export const RADIUS = { sm: '6px', md: '8px', lg: '12px', xl: '16px', full: '999px' } as const

/** Control heights per density. */
export const CONTROL = { compact: { sm: 24, md: 28, lg: 32 }, comfortable: { sm: 28, md: 32, lg: 36 } } as const

/**
 * The smallest pointer target in either density (WCAG 2.2 SC 2.5.8). A glyph may be drawn smaller (a checkbox box, a
 * colour dot) when the control around it is at least this big.
 */
export const TARGET_MIN = 24

/** Named layers; nothing else sets a z-index. */
/** Fixed chrome sizes other surfaces keep clear of: the toast stack sits above the status bar. */
export const CHROME = { 'statusbar-height': '24px' } as const

export const LAYER = { base: 0, raised: 1, sticky: 10, dropdown: 100, overlay: 200, modal: 300, toast: 400, tooltip: 500 } as const

/**
 * Motion (docs/design/motion.md). Transitions use fast/base/slow and collapse to 0ms when motion is
 * reduced; motion-shift, the distance something travels as it enters, drops to 0 so only opacity changes.
 * Loops (spin, pulse, shimmer, blink) keep their own durations; the one spin slows down instead of
 * stopping, so a busy indicator never reads as a hang.
 */
export const MOTION = {
  'duration-fast': '120ms', 'duration-base': '200ms', 'duration-slow': '320ms',
  'duration-spin': '800ms', 'duration-pulse': '1.6s', 'duration-shimmer': '1.4s', 'duration-blink': '1.1s',
  'motion-shift': '6px',
  'ease-standard': 'cubic-bezier(0.2, 0, 0, 1)', 'ease-emphasized': 'cubic-bezier(0.3, 0, 0, 1.2)',
  'ease-out': 'cubic-bezier(0.22, 1, 0.36, 1)', 'ease-in-out': 'cubic-bezier(0.4, 0, 0.6, 1)', 'ease-linear': 'linear'
} as const

/** What reduced motion changes: transitions become instant, nothing travels, and the spinner turns slowly. */
export const REDUCED_MOTION = { 'duration-fast': '0ms', 'duration-base': '0ms', 'duration-slow': '0ms', 'duration-spin': '2.4s', 'motion-shift': '0px' } as const
