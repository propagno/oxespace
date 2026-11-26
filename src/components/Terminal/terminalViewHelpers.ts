import type { ITheme } from '@xterm/xterm'
import type { TerminalCursorStyle, TerminalPrefs } from '../../store/terminal-prefs.store'

/**
 * Matches unfocused cursor shape to the user's `cursorStyle` so a bar caret
 * does not unexpectedly become a hollow block (`outline`) on blur (OXE-436).
 */
export function resolveInactiveCursorStyle(
  cursorStyle: TerminalCursorStyle
): 'outline' | 'bar' | 'underline' {
  if (cursorStyle === 'bar') return 'bar'
  if (cursorStyle === 'underline') return 'underline'
  return 'outline'
}

// Matches `.terminal-view .xterm { padding: 12px 14px 10px; }` + xterm scrollbar width.
const XTERM_PAD_X = 28
const XTERM_PAD_Y = 22
const XTERM_SCROLLBAR_W = 14

/**
 * Estimates initial terminal grid dimensions from a laid-out pane container
 * before xterm mounts, so ConPTY spawns at the real pane geometry instead of
 * 80x24 followed by an immediate reflow (OXE-436). Returns null when the host
 * is unmeasured (e.g. hidden or jsdom 0x0).
 */
export function estimateTerminalGrid(
  container: HTMLElement | null,
  prefs: Pick<TerminalPrefs, 'fontFamily' | 'fontSize' | 'lineHeight' | 'letterSpacing'>
): { cols: number; rows: number } | null {
  if (!container) return null
  const rect = container.getBoundingClientRect()
  const innerWidth = rect.width - XTERM_PAD_X - XTERM_SCROLLBAR_W
  const innerHeight = rect.height - XTERM_PAD_Y
  if (!Number.isFinite(innerWidth) || !Number.isFinite(innerHeight) || innerWidth <= 0 || innerHeight <= 0) {
    return null
  }
  let charWidth = prefs.fontSize * 0.6
  try {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.font = `${prefs.fontSize}px ${prefs.fontFamily}`
      const measured = ctx.measureText('W').width
      if (Number.isFinite(measured) && measured > 0) charWidth = measured
    }
  } catch { /* fallback to heuristic character width */ }
  const cellWidth = Math.max(1, charWidth + prefs.letterSpacing)
  const cellHeight = Math.max(1, Math.ceil(prefs.fontSize * prefs.lineHeight))
  const cols = Math.floor(innerWidth / cellWidth)
  const rows = Math.floor(innerHeight / cellHeight)
  if (cols < 2 || rows < 1) return null
  return { cols, rows }
}

// OSC 52 lets a terminal application request a clipboard write. Full-screen
// TUIs use it when they own mouse selection, so the browser's native `copy`
// event never fires. Keep this write-only (queries could exfiltrate clipboard
// contents) and bounded so an untrusted process cannot allocate an arbitrary
// base64 payload in the renderer.
const OSC52_MAX_DECODED_BYTES = 4 * 1024 * 1024

export function decodeOsc52ClipboardWrite(data: string): string | null {
  const separator = data.indexOf(';')
  if (separator < 0) return null

  const selection = data.slice(0, separator)
  const encoded = data.slice(separator + 1)
  if (!selection.includes('c') || !encoded || encoded === '?') return null
  if (encoded.length > Math.ceil(OSC52_MAX_DECODED_BYTES * 4 / 3) + 4) return null
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 === 1) return null

  try {
    const binary = atob(encoded)
    if (binary.length > OSC52_MAX_DECODED_BYTES) return null
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

// Search-match highlight colors passed to @xterm/addon-search. The decorations
// are what make Ctrl+F usable: every match gets a subtle wash, the active one a
// stronger accent + overview-ruler mark.
// Built from the active mode's accent each time a search runs.
export function searchDecorations(): {
  matchBackground: string
  matchOverviewRuler: string
  activeMatchBackground: string
  activeMatchColorOverviewRuler: string
} {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
  const accent = /^#[0-9a-f]{6}$/i.test(value) ? value : '#1f6b4a'
  return {
    matchBackground: `${accent}33`,
    matchOverviewRuler: `${accent}66`,
    activeMatchBackground: `${accent}66`,
    activeMatchColorOverviewRuler: accent
  }
}

/**
 * Build the xterm color theme from the live CSS design tokens. Read at
 * construction AND re-read whenever the workspace theme changes (so switching
 * Midnight → Dracula re-colors open terminals instead of only new ones).
 * With `translucent`, the cell background goes fully transparent so the
 * host's CSS background (color-mix + backdrop blur) shows through.
 *
 * Keep xterm aligned with the terminal content surface. The surrounding
 * PaneContainer owns elevation and focus chrome; xterm remains a flat,
 * uninterrupted canvas inside that card.
 */
export function buildTerminalTheme(translucent: boolean): ITheme {
  // Terminal colors come from the design tokens of the active light or dark mode.
  const tok = (name: string, fallback: string): string => {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    return v || fallback
  }
  const darkMode = document.documentElement.dataset.appearance === 'dark'
  const darkAnsi: Record<string, string> = {
    black: '#2f3431', white: '#d3d9d5', 'bright-black': '#828883', 'bright-white': '#f0f7f2',
    red: '#fb8276', 'bright-red': '#ffb5ac', green: '#60c473', 'bright-green': '#8de29a',
    yellow: '#dc9e12', 'bright-yellow': '#f7c15f', blue: '#60b0ff', 'bright-blue': '#a2cfff',
    magenta: '#df86d7', 'bright-magenta': '#faabf3', cyan: '#00c2ca', 'bright-cyan': '#3fe4ec'
  }
  const ansi = (name: string): string => darkMode ? tok(`--ansi-${name}`, darkAnsi[name] ?? '#808080') : (darkAnsi[name] ?? '#808080')
  return {
    background:          translucent ? '#00000000' : tok('--term-bg', '#131714'),
    foreground:          tok('--term-fg', '#e7efe9'),
    cursor:              tok('--accent', '#f5a939'),
    cursorAccent:        tok('--term-bg', '#131714'),
    selectionBackground: darkMode ? tok('--fill-selected-strong', '#1e422c') : '#1e422c',
    // xterm 6 draws its own scrollbar: a quiet slider, like the app's thin scrollbars.
    scrollbarSliderBackground: 'rgba(160, 170, 165, 0.22)',
    scrollbarSliderHoverBackground: 'rgba(160, 170, 165, 0.38)',
    scrollbarSliderActiveBackground: 'rgba(160, 170, 165, 0.5)',
    black:               ansi('black'),
    red:                 ansi('red'),
    green:               ansi('green'),
    yellow:              ansi('yellow'),
    blue:                ansi('blue'),
    magenta:             ansi('magenta'),
    cyan:                ansi('cyan'),
    white:               ansi('white'),
    brightBlack:         ansi('bright-black'),
    brightRed:           ansi('bright-red'),
    brightGreen:         ansi('bright-green'),
    brightYellow:        ansi('bright-yellow'),
    brightBlue:          ansi('bright-blue'),
    brightMagenta:       ansi('bright-magenta'),
    brightCyan:          ansi('bright-cyan'),
    brightWhite:         ansi('bright-white')
  }
}
