import type { ITheme, Terminal } from '@xterm/xterm'
import { currentColorScheme, currentMode, currentSurfaceStyle, type ColorScheme } from '../../design/mode'
import type { TerminalCursorStyle, TerminalPrefs } from '../../store/terminal-prefs.store'

// Claude Code uses ⏺ (U+23FA) on Mac and ● (U+25CF) on Windows
const AGENT_MARKERS = ['⏺', '●']

// readAgentPreview only needs the most recent agent line. Cap how far back it
// scans so it stays O(1) regardless of scrollback depth — without this it walks
// the entire buffer (up to 100k lines) on every output burst when no marker is
// found, janking the renderer and making selection/copy unreliable over time.
const AGENT_PREVIEW_SCAN_LINES = 300

export function readAgentPreview(terminal: Terminal): string {
  const buf = terminal.buffer.active
  const top = buf.baseY + buf.cursorY
  const stop = Math.max(0, top - AGENT_PREVIEW_SCAN_LINES)
  for (let y = top; y >= stop; y--) {
    const line = buf.getLine(y)
    if (!line) continue
    let text = ''
    for (let x = 0; x < line.length; x++) {
      text += line.getCell(x)?.getChars() ?? ' '
    }
    text = text.trimEnd()
    const trimmed = text.trimStart()
    if (!trimmed) continue
    const marker = AGENT_MARKERS.find(m => trimmed.startsWith(m))
    if (!marker) continue
    const content = trimmed.slice(marker.length).trim()
    if (content) return content
  }
  return ''
}

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
  const accent = /^#[0-9a-f]{6}$/i.test(value) ? value : '#6dadd2'
  return {
    matchBackground: `${accent}33`,
    matchOverviewRuler: `${accent}66`,
    activeMatchBackground: `${accent}66`,
    activeMatchColorOverviewRuler: accent
  }
}

interface TerminalSchemeFallback {
  bg: string
  fg: string
  accent: string
  selection: string
  selectionInactive: string
  pureSelection: string
  pureSelectionInactive: string
}

/** Lightweight fallback palette per Minimal color scheme when computed CSS tokens are unavailable (e.g. jsdom). */
const TERMINAL_SCHEME_FALLBACKS: Record<ColorScheme, TerminalSchemeFallback> = {
  default: { bg: '#212121', fg: '#d1d1d1', accent: '#6dadd2', selection: '#3e3e3e', selectionInactive: '#333333', pureSelection: '#2a2a2a', pureSelectionInactive: '#1f1f1f' },
  obsidian: { bg: '#212121', fg: '#d1d1d1', accent: '#b196ff', selection: '#3e3e3e', selectionInactive: '#333333', pureSelection: '#2a2a2a', pureSelectionInactive: '#1f1f1f' },
  flexoki: { bg: '#100f0f', fg: '#cecdc3', accent: '#55b8ab', selection: '#32312f', selectionInactive: '#262524', pureSelection: '#2a2927', pureSelectionInactive: '#1e1d1c' },
  nord: { bg: '#272c36', fg: '#eceff4', accent: '#79b1e0', selection: '#434c5e', selectionInactive: '#394150', pureSelection: '#2a303e', pureSelectionInactive: '#1e232e' },
  catppuccin: { bg: '#292c3c', fg: '#e4ebff', accent: '#c59cf0', selection: '#464b62', selectionInactive: '#3b4054', pureSelection: '#2c3144', pureSelectionInactive: '#1f2331' },
  dracula: { bg: '#21222c', fg: '#f8f8f2', accent: '#b998fd', selection: '#404358', selectionInactive: '#343748', pureSelection: '#2a2d3d', pureSelectionInactive: '#1e202c' },
  gruvbox: { bg: '#1e2021', fg: '#f2e5bc', accent: '#f08e5e', selection: '#423e3b', selectionInactive: '#353230', pureSelection: '#2c2926', pureSelectionInactive: '#1f1d1b' },
  solarized: { bg: '#002b36', fg: '#f2ecd9', accent: '#5bb4f3', selection: '#134e5e', selectionInactive: '#0b404e', pureSelection: '#123844', pureSelectionInactive: '#0a2730' }
}

/**
 * Build the xterm color theme from the live CSS design tokens. Read at
 * construction AND re-read whenever the mode, surface preset, or Minimal color
 * scheme changes so open terminals stay seamlessly aligned across all 8
 * official Minimal schemes, Dark Default (#212121), True Black OLED (#000000),
 * and Light modes.
 * With `translucent`, the cell background goes fully transparent so the
 * host's CSS background (color-mix + backdrop blur) shows through.
 *
 * Keep xterm aligned with the terminal content surface. The surrounding
 * PaneContainer owns hairline framing and focus chrome; xterm remains a flat,
 * uninterrupted canvas inside that pane.
 */
export function buildTerminalTheme(translucent: boolean): ITheme {
  const tok = (name: string, fallback: string): string => {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    return v || fallback
  }
  const darkMode = currentMode() === 'dark'
  const pureSurface = currentSurfaceStyle() === 'pure'
  const schemeFallback = TERMINAL_SCHEME_FALLBACKS[currentColorScheme()]
  const defaultBg = darkMode && pureSurface ? '#000000' : schemeFallback.bg
  const defaultSelection = darkMode && pureSurface ? schemeFallback.pureSelection : schemeFallback.selection
  const defaultSelectionInactive = darkMode && pureSurface ? schemeFallback.pureSelectionInactive : schemeFallback.selectionInactive
  const darkAnsi: Record<string, string> = {
    black: '#333333', white: '#d1d1d1', 'bright-black': '#a1a1a1', 'bright-white': '#eeeeee',
    red: '#f2979c', 'bright-red': '#ffb8bb', green: '#9ac379', 'bright-green': '#b6dc97',
    yellow: '#d7ad5d', 'bright-yellow': '#efc880', blue: '#71bdf4', 'bright-blue': '#9ed5ff',
    magenta: '#b5a7f5', 'bright-magenta': '#cec5ff', cyan: '#52cbbc', 'bright-cyan': '#7be3d5'
  }
  const ansi = (name: string): string => darkMode ? tok(`--ansi-${name}`, darkAnsi[name] ?? '#808080') : (darkAnsi[name] ?? '#808080')
  const bg = tok('--term-bg', defaultBg)
  return {
    background:          translucent ? '#00000000' : bg,
    foreground:          tok('--term-fg', schemeFallback.fg),
    cursor:              darkMode ? tok('--accent', schemeFallback.accent) : schemeFallback.accent,
    cursorAccent:        bg,
    selectionBackground: darkMode ? tok('--fill-selected-strong', defaultSelection) : defaultSelection,
    selectionInactiveBackground: darkMode ? tok('--fill-selected', defaultSelectionInactive) : defaultSelectionInactive,
    // xterm 6 draws its own scrollbar: a quiet achromatic slider, like the app's thin scrollbars.
    scrollbarSliderBackground: 'rgba(160, 160, 160, 0.22)',
    scrollbarSliderHoverBackground: 'rgba(160, 160, 160, 0.36)',
    scrollbarSliderActiveBackground: 'rgba(160, 160, 160, 0.50)',
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
