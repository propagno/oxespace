import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebglAddon } from '@xterm/addon-webgl'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { ArrowDown, ArrowUp, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import type { ITheme } from '@xterm/xterm'
import type { WorkspaceThemeId } from '../../../shared/types/workspace'
import type { TerminalPrefs } from '../../store/terminal-prefs.store'
import { useTerminalStore } from '../../store/terminal.store'
import { wheelToTuiScrollKeys } from '../../utils/terminalWheel'

// Claude Code uses ⏺ (U+23FA) on Mac and ● (U+25CF) on Windows
const AGENT_MARKERS = ['⏺', '●']

let activeWebglContexts = 0
// Browsers cap WebGL contexts per tab (Chrome: 16). When exceeded, the oldest
// context is lost, unexpectedly breaking older terminals. By capping at 14, we
// leave room for other components and gracefully fall back to the DOM renderer
// for new terminals instead of crashing existing ones.
const MAX_WEBGL_CONTEXTS = 14

/**
 * Preflight: can we actually get a WebGL2 context? @xterm/addon-webgl needs one,
 * and on GPU-less hosts (corporate VMs, RDP, some VPN/remote desktops) its
 * failure surfaces asynchronously and crashes the pane. Only load the addon when
 * a real context is obtainable; otherwise stay on xterm's DOM renderer.
 */
function supportsWebgl2(): boolean {
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2')
    if (!gl) return false
    // Release the probe context so we don't hold a GPU slot.
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return true
  } catch {
    return false
  }
}

// readAgentPreview only needs the most recent agent line. Cap how far back it
// scans so it stays O(1) regardless of scrollback depth — without this it walks
// the entire buffer (up to 100k lines) on every output burst when no marker is
// found, janking the renderer and making selection/copy unreliable over time.
const AGENT_PREVIEW_SCAN_LINES = 300

// How long a just-cleared selection is still considered copyable. xterm wipes
// the selection when the scrollback trims, the buffer toggles (TUI alt-screen),
// or the user types — so a selection can vanish in the moment between the user
// selecting text and pressing Ctrl/Cmd+C. We remember the last non-empty
// selection briefly so the copy still lands instead of silently turning into a
// SIGINT. Reset whenever the user actually types into the PTY.
const RECENT_SELECTION_MS = 2000

// OSC 52 lets a terminal application request a clipboard write. Full-screen
// TUIs use it when they own mouse selection, so the browser's native `copy`
// event never fires. Keep this write-only (queries could exfiltrate clipboard
// contents) and bounded so an untrusted process cannot allocate an arbitrary
// base64 payload in the renderer.
const OSC52_MAX_DECODED_BYTES = 4 * 1024 * 1024

function decodeOsc52ClipboardWrite(data: string): string | null {
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
const SEARCH_DECORATIONS = {
  matchBackground: '#12c79a33',
  matchOverviewRuler: '#12c79a66',
  activeMatchBackground: '#12c79a66',
  activeMatchColorOverviewRuler: '#12c79a'
} as const

/**
 * Build the xterm color theme from the live CSS design tokens. Read at
 * construction AND re-read whenever the workspace theme changes (so switching
 * Midnight → Dracula re-colors open terminals instead of only new ones).
 * With `translucent`, the cell background goes fully transparent so the
 * host's CSS background (color-mix + backdrop blur) shows through.
 *
 * The background is --bg-tile-content (the pane surface), NOT a distinct
 * "card" color: the chat-style terminal is one seamless flat surface from
 * topbar to statusbar, like Claude Desktop / Cursor — no console card.
 */
function buildTerminalTheme(translucent: boolean): ITheme {
  const tok = (name: string, fallback: string): string => {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    return v || fallback
  }
  return {
    background:          translucent ? '#00000000' : tok('--bg-tile-content', '#0d1117'),
    foreground:          tok('--tx-primary',       '#f1f5f9'),
    cursor:              tok('--brand-light',      '#6EEBD4'),
    selectionBackground: tok('--brand-glow',       'rgba(18,199,154,0.28)'),
    black:               tok('--dot-gray',          '#3b4260'),
    red:                 tok('--dot-red',           '#f87171'),
    green:               tok('--dot-green',         '#34d474'),
    yellow:              tok('--dot-yellow',        '#fbbf24'),
    blue:                tok('--dot-blue',          '#60a5fa'),
    magenta:             tok('--dot-purple',        '#c084fc'),
    cyan:                tok('--brand-light',      '#6EEBD4'),
    white:               tok('--tx-primary',       '#f1f5f9'),
    brightBlack:         tok('--tx-muted',          '#636b75'),
    brightRed:           tok('--dot-red',           '#f87171'),
    brightGreen:         tok('--dot-green',         '#34d399'),
    brightYellow:        tok('--dot-orange',        '#f97316'),
    brightBlue:          tok('--brand-light',      '#6EEBD4'),
    brightMagenta:       tok('--dot-purple',        '#c084fc'),
    brightCyan:          tok('--brand-lightest',   '#B4F5E8'),
    brightWhite:         tok('--tx-primary',       '#f1f5f9')
  }
}

function readAgentPreview(terminal: Terminal): string {
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

interface TerminalViewProps {
  paneId: string
  isRunning: boolean
  onInput: (data: string) => void
  onResize: (cols: number, rows: number) => void
  onExit?: (exitCode: number | null) => void
  /** Workspace theme — re-applies terminal colors live when it changes. */
  themeId: WorkspaceThemeId
  /** Resolved terminal prefs (global ← per-workspace override). */
  prefs: TerminalPrefs
}

export function TerminalView({ isRunning, onExit, onInput, onResize, paneId, themeId, prefs }: TerminalViewProps): ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const pasteRef = useRef<((text: string) => void) | null>(null)
  const refitRef = useRef<(() => void) | null>(null)
  // Last non-empty selection + when it was seen, so a copy can still fire if
  // xterm cleared the live selection (scrollback trim / buffer toggle) just
  // before the keypress. See RECENT_SELECTION_MS.
  const lastSelectionRef = useRef<{ text: string; at: number } | null>(null)
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs
  const onExitRef = useRef(onExit)
  const onInputRef = useRef(onInput)
  const onResizeRef = useRef(onResize)
  const fitFrameRef = useRef<number | null>(null)
  const settleFitTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([])
  const [isDragOver, setIsDragOver] = useState(false)
  // Ctrl+F search overlay (powered by @xterm/addon-search).
  const searchAddonRef = useRef<SearchAddon | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<{ resultIndex: number; resultCount: number } | null>(null)

  onExitRef.current = onExit
  onInputRef.current = onInput
  onResizeRef.current = onResize

  useEffect(() => {
    if (!hostRef.current) return

    const initial = prefsRef.current
    const initialTranslucent = initial.backgroundOpacity < 1
    const terminal = new Terminal({
      allowProposedApi: true,
      allowTransparency: initialTranslucent,
      cursorBlink: initial.cursorBlink,
      cursorStyle: initial.cursorStyle,
      fontFamily: initial.fontFamily,
      fontSize: initial.fontSize,
      lineHeight: initial.lineHeight,
      letterSpacing: initial.letterSpacing,
      minimumContrastRatio: 4.5,
      rescaleOverlappingGlyphs: true,
      scrollback: initial.scrollback,
      scrollOnUserInput: false,
      theme: buildTerminalTheme(initialTranslucent)
    })
    const fitAddon = new FitAddon()
    const unicodeAddon = new Unicode11Addon()
    const searchAddon = new SearchAddon()

    terminal.loadAddon(fitAddon)
    terminal.loadAddon(unicodeAddon)
    terminal.loadAddon(new WebLinksAddon())
    terminal.loadAddon(searchAddon)
    searchAddonRef.current = searchAddon
    const searchResultsDisposable = searchAddon.onDidChangeResults((results) => setSearchResults(results))
    terminal.open(hostRef.current)

    // GPU-accelerated renderer. The default DOM renderer repaints every visible
    // row each frame and degrades badly with large scrollback (and several open
    // panes), which is what makes the terminal — and selection/copy — feel
    // sluggish "after a while of use". WebGL offloads that to the GPU.
    //
    // In GPU-less environments (corporate VMs, RDP, some VPN/remote desktops)
    // WebGL is unavailable or unstable. The @xterm/addon-webgl failure surfaces
    // ASYNCHRONOUSLY (render tick / context loss), so a synchronous try/catch
    // around loadAddon can't contain it — the classic "Cannot read properties
    // of undefined (reading '_isDisposed')" then escapes and (without a boundary)
    // blanks the whole app. So we PREFLIGHT a real WebGL2 context first and only
    // load the addon when it actually works; otherwise we stay on the DOM
    // renderer. Disposal is also guarded so teardown can never throw.
    let webglAddon: WebglAddon | null = null
    let webglContextCounted = false
    
    if (activeWebglContexts >= MAX_WEBGL_CONTEXTS) {
      console.warn(`[OXESpace] WebGL context limit reached (${MAX_WEBGL_CONTEXTS}), using DOM renderer`)
    } else if (supportsWebgl2()) {
      try {
        const addon = new WebglAddon()
        addon.onContextLoss(() => {
          try { addon.dispose() } catch { /* already torn down */ }
          if (webglAddon === addon) {
             webglAddon = null
             if (webglContextCounted) {
               activeWebglContexts--
               webglContextCounted = false
             }
             
             // The WebGL canvas has just been removed. We need to force xterm
             // to fall back to the DOM renderer immediately, otherwise the
             // terminal stays completely blank.
             setTimeout(() => {
               try {
                 const t = terminalRef.current
                 if (t) {
                   // Re-apply a cloned theme to trigger xterm's DOM-renderer
                   // color rebuild without a no-op self-assignment.
                   t.options.theme = { ...(t.options.theme ?? {}) }
                   t.refresh(0, t.rows - 1)
                 }
               } catch { /* ignore if already unmounted */ }
             }, 50)
          }
        })
        terminal.loadAddon(addon)
        webglAddon = addon
        activeWebglContexts++
        webglContextCounted = true
      } catch (err) {
        console.warn('[OXESpace] WebGL renderer unavailable, using DOM renderer', err)
        webglAddon = null
      }
    } else {
      console.warn('[OXESpace] WebGL2 not available, using DOM renderer')
    }
    // Unicode 11 width tables live behind xterm's "proposed API" gate. In some
    // Vite-bundled dev builds the proposed-API check throws even with
    // allowProposedApi: true (xterm exports get duplicated across module
    // resolutions, breaking the option lookup on Terminal.unicode). The error
    // cascades through React's error boundary, unmounts the pane, and the PTY
    // never gets the input it needed — so the agent CLI exits with code 1.
    // Falling back to the default width tables keeps the terminal usable.
    try {
      terminal.unicode.activeVersion = '11'
    } catch (err) {
      console.warn('[OXESpace] Unicode 11 activation failed, using default widths', err)
    }
    terminal.write('Idle\r\n')

    const dataDisposable = terminal.onData((data) => {
      // The user typed into the PTY — any earlier selection is no longer a copy
      // candidate, so a later Ctrl+C correctly falls through to SIGINT.
      lastSelectionRef.current = null
      onInputRef.current(data)
    })
    // Remember the last non-empty selection. onSelectionChange also fires with
    // an empty selection when xterm clears it (trim / buffer toggle); we keep
    // the previous value so a copy issued right after still has something.
    const selectionDisposable = terminal.onSelectionChange(() => {
      const sel = terminal.getSelection()
      if (sel) lastSelectionRef.current = { text: sel, at: Date.now() }
    })
    terminalRef.current = terminal

    const copyText = async (text: string): Promise<void> => {
      if (!text) return
      // Write via main (Electron clipboard, no renderer permission) first; fall
      // back to the web API. Keeps copy working even if clipboard-write is denied.
      const ok = await window.oxe.clipboard.writeText(text).catch(() => false)
      if (!ok) await navigator.clipboard.writeText(text).catch(() => undefined)
    }

    // TUIs such as Claude/GSD own selection while mouse tracking is enabled and
    // copy through OSC 52 instead of a DOM copy event. xterm deliberately leaves
    // OSC 52 to the host, so bridge write requests to Electron's clipboard.
    // Clipboard read queries (`c;?`) are consumed but never answered.
    const osc52Disposable = terminal.parser.registerOscHandler(52, async (data) => {
      const text = decodeOsc52ClipboardWrite(data)
      if (text) await copyText(text)
      return true
    })

    const pasteText = (text: string): void => {
      const CHUNK = 4096
      if (text.length <= CHUNK) {
        terminal.paste(text)
        return
      }
      // terminal.paste() wraps EVERY call in the shell's bracketed-paste
      // markers (\x1b[200~ … \x1b[201~) when bracketed paste mode is on
      // (true for PowerShell/PSReadLine, bash/zsh, and agent CLIs like
      // Claude Code). Calling paste() once per chunk sends N separate paste
      // "envelopes" instead of one continuous block — readline-based
      // consumers treat each \x1b[201~ as "end of paste, process now", so an
      // embedded newline that lands right after a chunk boundary gets read
      // as a literal Enter and the shell submits early, corrupting/truncating
      // large pastes. Fix: wrap the whole payload in a single marker pair and
      // feed the raw chunks through terminal.input(), which injects data the
      // same way paste() does internally but without re-wrapping each call.
      const bracketed = terminal.modes.bracketedPasteMode && !terminal.options.ignoreBracketedPasteMode
      const normalized = text.replace(/\r?\n/g, '\r') // same normalization terminal.paste() applies
      if (bracketed) terminal.input('\x1b[200~', false)
      let offset = 0
      const send = (): void => {
        terminal.input(normalized.slice(offset, offset + CHUNK), true)
        offset += CHUNK
        if (offset < normalized.length) {
          setTimeout(send, 10)
          return
        }
        if (bracketed) terminal.input('\x1b[201~', false)
      }
      send()
    }
    pasteRef.current = pasteText

    const pasteClipboardContents = async (): Promise<void> => {
      // Always check for image first: agent CLIs (Claude Code, Copilot) prefer file-path
      // references and readText() can return stale/unrelated text even when clipboard has an image.
      const imagePath = await window.oxe.clipboard.saveImageToTemp().catch(() => null)
      if (imagePath) {
        pasteText(`${imagePath} `)
        return
      }
      // Read via main (Electron clipboard, no renderer permission) first; fall
      // back to the web API. The main path is what keeps Ctrl+V working even if
      // navigator.clipboard's clipboard-read permission is denied.
      let text = await window.oxe.clipboard.readText().catch(() => '')
      if (!text) text = await navigator.clipboard.readText().catch(() => '')
      if (text) pasteText(text)
    }

    // Resolve what to copy: the live selection, or — if xterm just cleared it
    // (scrollback trim / TUI buffer toggle) — the last selection seen within
    // RECENT_SELECTION_MS. Without the fallback, copy silently fails while an
    // agent streams output, which is the "copy stops working after a while" bug.
    const effectiveSelection = (): string => {
      const live = terminal.getSelection()
      if (live) return live
      const recent = lastSelectionRef.current
      if (recent && Date.now() - recent.at <= RECENT_SELECTION_MS) return recent.text
      return ''
    }

    // Electron does not always route Ctrl+C through xterm's custom key handler
    // after a long canvas selection. Capture the native copy event as a second
    // path so keyboard shortcuts and context-menu copy both preserve the full
    // selected command/output.
    const handleCopy = (event: ClipboardEvent): void => {
      const selection = effectiveSelection()
      if (!selection) return
      event.preventDefault()
      event.clipboardData?.setData('text/plain', selection)
      void copyText(selection)
      terminal.clearSelection()
      lastSelectionRef.current = null
    }

    // Full-screen TUIs (Grok Build, Claude Code, …) use the alternate screen,
    // which has no xterm scrollback. Without mouse tracking, the wheel does
    // nothing — translate it into PageUp/PageDown (or arrows) so the TUI can
    // scroll its own viewport. When the app enables mouse tracking, leave the
    // event to xterm so it is forwarded as mouse sequences.
    const handleTuiWheel = (event: WheelEvent): boolean => {
      const keys = wheelToTuiScrollKeys({
        bufferType: terminal.buffer.active.type,
        mouseTrackingMode: terminal.modes.mouseTrackingMode,
        deltaY: event.deltaY,
        deltaMode: event.deltaMode,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        metaKey: event.metaKey
      })
      if (keys === null) return true
      event.preventDefault()
      onInputRef.current(keys)
      return false
    }
    // Proposed API in xterm 5.5+; tests/mocks may omit it — fall back to host.
    const hostWheelFallback = (event: WheelEvent): void => {
      handleTuiWheel(event)
    }
    let usesHostWheelFallback = false
    if (typeof terminal.attachCustomWheelEventHandler === 'function') {
      terminal.attachCustomWheelEventHandler(handleTuiWheel)
    } else {
      usesHostWheelFallback = true
      hostRef.current.addEventListener('wheel', hostWheelFallback, { passive: false })
    }

    terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      const key = event.key.toLowerCase()

      // Ctrl/Cmd+F opens the in-terminal search overlay instead of reaching
      // the PTY. (Shift/Alt variants pass through for TUIs that bind them.)
      if ((event.ctrlKey || event.metaKey) && key === 'f' && event.type === 'keydown' && !event.altKey && !event.shiftKey) {
        event.preventDefault()
        setSearchOpen(true)
        return false
      }

      // Copy selected text. Ctrl+Shift+C always copies (no PTY conflict).
      // Ctrl+C copies only when there's a selection — otherwise it must fall
      // through to the PTY as SIGINT (interrupt), the expected terminal behavior.
      if ((event.ctrlKey || event.metaKey) && key === 'c' && event.type === 'keydown' && !event.altKey) {
        const selection = effectiveSelection()
        if (event.shiftKey) {
          if (selection) { void copyText(selection); terminal.clearSelection(); lastSelectionRef.current = null }
          return false
        }
        if (selection) {
          void copyText(selection)
          terminal.clearSelection()
          lastSelectionRef.current = null
          return false // we copied — don't also send SIGINT
        }
        return true // no selection → let Ctrl+C reach the PTY (interrupt)
      }

      // Explicit Ctrl/Cmd+V interception. Relying on the browser-native
      // `paste` event alone is unreliable in Electron — xterm's hidden
      // textarea sometimes swallows it before it bubbles to our listener,
      // depending on focus state. This path reads the clipboard via
      // navigator.clipboard.readText() and writes via terminal.paste(),
      // guaranteeing Ctrl+V works no matter who's holding focus inside the
      // terminal pane.
      // `preventDefault()` is essential: returning false alone doesn't stop
      // the browser from emitting a `paste` event next, which would cause
      // a second paste via our hostRef listener (double-input bug).
      if ((event.ctrlKey || event.metaKey) && key === 'v' && event.type === 'keydown' && !event.altKey && !event.shiftKey) {
        event.preventDefault()
        void pasteClipboardContents()
        return false
      }

      if (event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && event.key === 'Enter') {
        // Block both keydown AND keypress — Enter fires both in browsers, and the keypress
        // would otherwise reach xterm and send \r (submit) even if keydown was intercepted.
        if (event.type === 'keydown') {
          // Send Kitty Keyboard Protocol Shift+Enter (\x1b[13;2u).
          // Claude Code and GitHub Copilot recognize this as "insert newline without submitting".
          onInputRef.current('\x1b[13;2u')
        }
        return false
      }

      return true
    })

    const handlePaste = (event: ClipboardEvent): void => {
      const text = event.clipboardData?.getData('text/plain')
      if (text) {
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        pasteText(text)
        return
      }
      const hasImage = Array.from(event.clipboardData?.items ?? []).some((item) => item.type.startsWith('image/'))
      if (hasImage) {
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        void window.oxe.clipboard.saveImageToTemp().then((imagePath) => {
          if (imagePath) pasteText(`${imagePath} `)
        }).catch(() => undefined)
      }
    }
    hostRef.current.addEventListener('paste', handlePaste, { capture: true })
    hostRef.current.addEventListener('copy', handleCopy, { capture: true })

    const handleProgrammaticInsert = (event: Event): void => {
      const detail = (event as CustomEvent<{ paneId?: string; text?: string }>).detail
      if (detail?.paneId !== paneId || !detail.text) return
      terminal.focus()
      pasteText(detail.text)
    }
    window.addEventListener('oxe:terminal-insert-text', handleProgrammaticInsert)

    // Topbar actions (TerminalPane) arrive as pane-scoped window events, the
    // same pattern as insert-text/focus-pane.
    const handleClearRequest = (event: Event): void => {
      const detail = (event as CustomEvent<{ paneId?: string }>).detail
      if (detail?.paneId !== paneId) return
      terminal.clear()
      terminal.focus()
    }
    window.addEventListener('oxe:terminal-clear', handleClearRequest)

    const handleOpenSearchRequest = (event: Event): void => {
      const detail = (event as CustomEvent<{ paneId?: string }>).detail
      if (detail?.paneId !== paneId) return
      setSearchOpen(true)
    }
    window.addEventListener('oxe:terminal-open-search', handleOpenSearchRequest)

    const syncViewportScrollArea = (): void => {
      // Public API has no syncScrollArea; after maximize the private viewport can
      // keep a stale scrollHeight so the wheel appears dead. Best-effort only.
      try {
        const core = (terminal as unknown as {
          _core?: { viewport?: { syncScrollArea?: (immediate?: boolean) => void } }
        })._core
        core?.viewport?.syncScrollArea?.(true)
      } catch {
        /* private xterm surface — ignore if shape changes */
      }
    }

    const fitTerminal = (): void => {
      try {
        // Preserve absolute scroll position. A relative scroll after fit can jump
        // when Copilot prints wide tables and the terminal reflows lines.
        const buf = terminal.buffer.active
        const viewportY = buf.viewportY
        const wasAtBottom = viewportY >= buf.baseY

        fitAddon.fit()
        onResizeRef.current(terminal.cols, terminal.rows)

        // Force the viewport scroll area to re-measure after large layout
        // changes (pane maximize/restore). Without a refresh, xterm can keep a
        // stale scrollHeight and the mouse wheel appears dead.
        terminal.refresh(0, Math.max(0, terminal.rows - 1))
        syncViewportScrollArea()

        if (buf.type === 'alternate') {
          // TUI owns scrolling; don't fight it after fit.
          return
        }
        if (wasAtBottom) terminal.scrollToBottom()
        else terminal.scrollToLine(Math.min(viewportY, terminal.buffer.active.baseY))
      } catch {
        // xterm may not have measurable dimensions during first layout.
      }
    }
    refitRef.current = fitTerminal

    const scheduleFit = (): void => {
      if (fitFrameRef.current !== null) return
      fitFrameRef.current = window.requestAnimationFrame(() => {
        fitFrameRef.current = null
        fitTerminal()
        // CSS maximize/restore can settle one frame after ResizeObserver fires.
        // A second pass keeps cols/rows + scroll metrics aligned with final size.
        window.requestAnimationFrame(() => {
          fitTerminal()
        })
      })
    }

    const resizeObserver = new ResizeObserver(scheduleFit)
    resizeObserver.observe(hostRef.current)
    scheduleFit()
    void document.fonts?.ready.then(scheduleFit).catch(() => undefined)
    // Belt-and-suspenders re-fits shortly after mount. The pane's own layout
    // (topbar + status bar) can still be settling — sibling CSS transitions,
    // late font metric changes, etc. — after ResizeObserver's first callback,
    // and if that first measurement is even slightly stale xterm computes the
    // wrong cols and the terminal renders text past the visible edge until
    // something forces another fit (previously only a manual window resize
    // did). --transition-base across the app is 200ms, so 250/700ms covers a
    // settle window with margin.
    settleFitTimersRef.current = [
      setTimeout(scheduleFit, 250),
      setTimeout(scheduleFit, 700)
    ]

    let previewTimer: ReturnType<typeof setTimeout> | null = null

    const unsubscribeData = window.oxe.terminal.onData(paneId, (event) => {
      // Smart scrollback (normal buffer only): when the user has scrolled up to
      // read history, new streaming output shouldn't yank them to the bottom.
      // Skip this on the alternate screen (Grok/Claude TUIs) — those apps own
      // the full viewport, have no scrollback, and continuous pin-restore
      // fights their redraws so the mouse wheel appears broken.
      //
      // Same reasoning applies while the user is mid mouse-drag selecting text
      // at the bottom of an actively streaming terminal: pin the viewport so
      // new tokens don't fight an in-progress copy.
      const preBuf = terminal.buffer.active
      const isAltScreen = preBuf.type === 'alternate'
      const preViewportY = preBuf.viewportY
      const recentSelection = lastSelectionRef.current
      const hasActiveOrRecentSelection =
        !!terminal.getSelection() ||
        (recentSelection !== null && Date.now() - recentSelection.at <= RECENT_SELECTION_MS)
      const wasAtBottom =
        isAltScreen ||
        (!hasActiveOrRecentSelection && preViewportY >= preBuf.baseY)
      terminal.write(event.data, () => {
        if (!wasAtBottom && terminal.buffer.active.type === 'normal') {
          const postBuf = terminal.buffer.active
          terminal.scrollToLine(Math.min(preViewportY, postBuf.baseY))
        }
      })
      useTerminalStore.getState().updateActivity(paneId, event.data)
      if (previewTimer) clearTimeout(previewTimer)
      previewTimer = setTimeout(() => {
        previewTimer = null
        const preview = readAgentPreview(terminal)
        if (preview) useTerminalStore.getState().updatePreview(paneId, preview)
      }, 300)
    })
    const unsubscribeExit = window.oxe.terminal.onExit(paneId, (event) => {
      terminal.write(`\r\n[process exited ${event.exitCode ?? ''}]\r\n`)
      onExitRef.current?.(event.exitCode)
    })

    return () => {
      if (fitFrameRef.current !== null) {
        window.cancelAnimationFrame(fitFrameRef.current)
        fitFrameRef.current = null
      }
      for (const t of settleFitTimersRef.current) clearTimeout(t)
      settleFitTimersRef.current = []
      if (previewTimer) clearTimeout(previewTimer)
      unsubscribeData()
      unsubscribeExit()
      resizeObserver.disconnect()
      dataDisposable.dispose()
      selectionDisposable.dispose()
      osc52Disposable.dispose()
      searchResultsDisposable.dispose()
      searchAddonRef.current = null
      window.removeEventListener('oxe:terminal-clear', handleClearRequest)
      window.removeEventListener('oxe:terminal-open-search', handleOpenSearchRequest)
      try { 
        if (webglAddon) {
          webglAddon.dispose()
          webglAddon = null
        }
      } catch { /* WebGL addon teardown raced — ignore */ }
      if (webglContextCounted) {
        activeWebglContexts--
        webglContextCounted = false
      }
      hostRef.current?.removeEventListener('paste', handlePaste, { capture: true })
      hostRef.current?.removeEventListener('copy', handleCopy, { capture: true })
      if (usesHostWheelFallback) {
        hostRef.current?.removeEventListener('wheel', hostWheelFallback)
      }
      window.removeEventListener('oxe:terminal-insert-text', handleProgrammaticInsert)
      pasteRef.current = null
      refitRef.current = null
      lastSelectionRef.current = null
      terminal.dispose()
      terminalRef.current = null
    }
  }, [paneId])

  // Apply prefs + theme to the live terminal without recreating it. Font/cursor
  // changes are immediate; the theme is re-read on the next frame so the
  // workspace's `data-theme` (set by ThemeProvider) has already settled.
  useEffect(() => {
    const term = terminalRef.current
    if (!term) return
    const fontChanged =
      term.options.fontFamily !== prefs.fontFamily ||
      term.options.fontSize !== prefs.fontSize ||
      term.options.lineHeight !== prefs.lineHeight ||
      term.options.letterSpacing !== prefs.letterSpacing
    term.options.fontFamily = prefs.fontFamily
    term.options.fontSize = prefs.fontSize
    term.options.lineHeight = prefs.lineHeight
    term.options.letterSpacing = prefs.letterSpacing
    term.options.cursorStyle = prefs.cursorStyle
    term.options.cursorBlink = prefs.cursorBlink
    term.options.scrollback = prefs.scrollback

    const raf = window.requestAnimationFrame(() => {
      const t = terminalRef.current
      if (!t) return
      const translucent = prefsRef.current.backgroundOpacity < 1
      // allowTransparency toggles the renderer's alpha path — settable live in
      // xterm 5, but guarded in case a renderer swap races the update.
      try {
        if (t.options.allowTransparency !== translucent) t.options.allowTransparency = translucent
      } catch { /* applies on next terminal creation */ }
      t.options.theme = buildTerminalTheme(translucent)
      // Font metrics changed → re-fit (recomputes cols/rows + notifies the PTY)
      // and repaint so glyphs render at the new size.
      if (fontChanged) refitRef.current?.()
      t.refresh(0, t.rows - 1)
    })
    return () => window.cancelAnimationFrame(raf)
  }, [
    themeId,
    prefs.fontFamily,
    prefs.fontSize,
    prefs.lineHeight,
    prefs.letterSpacing,
    prefs.cursorStyle,
    prefs.cursorBlink,
    prefs.scrollback,
    prefs.backgroundOpacity
  ])

  useEffect(() => {
    if (isRunning) terminalRef.current?.focus()
  }, [isRunning])

  useEffect(() => {
    const handler = (e: Event): void => {
      if ((e as CustomEvent<{ paneId: string }>).detail.paneId === paneId) {
        terminalRef.current?.focus()
      }
    }
    window.addEventListener('oxe:focus-pane', handler)
    return () => window.removeEventListener('oxe:focus-pane', handler)
  }, [paneId])

  // Focus the search input as soon as the overlay opens (Ctrl+F / topbar).
  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus()
  }, [searchOpen])

  const runSearch = useCallback((query: string, direction: 'next' | 'prev', incremental = false): void => {
    const addon = searchAddonRef.current
    if (!addon) return
    if (!query) {
      addon.clearDecorations()
      setSearchResults(null)
      return
    }
    const options = { decorations: SEARCH_DECORATIONS, incremental }
    if (direction === 'next') addon.findNext(query, options)
    else addon.findPrevious(query, options)
  }, [])

  const closeSearch = useCallback((): void => {
    setSearchOpen(false)
    setSearchQuery('')
    setSearchResults(null)
    searchAddonRef.current?.clearDecorations()
    terminalRef.current?.focus()
  }, [])

  // The addon caps highlight decorations at 1000 and reports -1 beyond that.
  const searchCountLabel = !searchQuery
    ? ''
    : !searchResults || searchResults.resultCount === 0
      ? '0'
      : searchResults.resultCount === -1
        ? `${searchResults.resultIndex + 1}/999+`
        : `${searchResults.resultIndex + 1}/${searchResults.resultCount}`

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setIsDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>): void => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setIsDragOver(false)
    }
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault()
    setIsDragOver(false)
    const path = e.dataTransfer.getData('application/oxe-file-path')
    if (path) {
      terminalRef.current?.focus()
      pasteRef.current?.(path + ' ')
    }
  }

  const translucent = prefs.backgroundOpacity < 1

  return (
    <>
      <div
        ref={hostRef}
        className={`terminal-view${isDragOver ? ' terminal-drop-active' : ''}`}
        data-testid="terminal-view"
        data-translucent={translucent ? 'true' : undefined}
        style={translucent ? { ['--term-bg-mix' as never]: `${Math.round(prefs.backgroundOpacity * 100)}%` } : undefined}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      />
      {searchOpen ? (
        <div className="terminal-search" role="search" data-testid="terminal-search">
          <input
            ref={searchInputRef}
            type="text"
            className="terminal-search-input"
            placeholder="Buscar no terminal…"
            aria-label="Search terminal"
            value={searchQuery}
            onChange={(e) => {
              const value = e.currentTarget.value
              setSearchQuery(value)
              runSearch(value, 'next', true)
            }}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') {
                e.preventDefault()
                runSearch(searchQuery, e.shiftKey ? 'prev' : 'next')
              } else if (e.key === 'Escape') {
                e.preventDefault()
                closeSearch()
              }
            }}
          />
          <span className="terminal-search-count" aria-live="polite">{searchCountLabel}</span>
          <button type="button" className="terminal-search-btn" aria-label="Previous match" title="Anterior (Shift+Enter)" onClick={() => runSearch(searchQuery, 'prev')}>
            <ArrowUp size={12} aria-hidden="true" />
          </button>
          <button type="button" className="terminal-search-btn" aria-label="Next match" title="Próximo (Enter)" onClick={() => runSearch(searchQuery, 'next')}>
            <ArrowDown size={12} aria-hidden="true" />
          </button>
          <button type="button" className="terminal-search-btn" aria-label="Close search" title="Fechar (Esc)" onClick={closeSearch}>
            <X size={12} aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </>
  )
}
