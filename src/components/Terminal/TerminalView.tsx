import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { ITheme } from '@xterm/xterm'
import type { WorkspaceThemeId } from '../../../shared/types/workspace'
import type { TerminalPrefs } from '../../store/terminal-prefs.store'
import { useTerminalStore } from '../../store/terminal.store'

// Claude Code uses ⏺ (U+23FA) on Mac and ● (U+25CF) on Windows
const AGENT_MARKERS = ['⏺', '●']

/**
 * Build the xterm color theme from the live CSS design tokens. Read at
 * construction AND re-read whenever the workspace theme changes (so switching
 * Midnight → Dracula re-colors open terminals instead of only new ones).
 */
function buildTerminalTheme(): ITheme {
  const tok = (name: string, fallback: string): string => {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    return v || fallback
  }
  return {
    background:          tok('--bg-tile-content', '#000000'),
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
  for (let y = buf.baseY + buf.cursorY; y >= 0; y--) {
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
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs
  const onExitRef = useRef(onExit)
  const onInputRef = useRef(onInput)
  const onResizeRef = useRef(onResize)
  const fitFrameRef = useRef<number | null>(null)
  const refreshFrameRef = useRef<number | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)

  onExitRef.current = onExit
  onInputRef.current = onInput
  onResizeRef.current = onResize

  useEffect(() => {
    if (!hostRef.current) return

    const initial = prefsRef.current
    const terminal = new Terminal({
      allowProposedApi: true,
      cursorBlink: initial.cursorBlink,
      cursorStyle: initial.cursorStyle,
      convertEol: true,
      fontFamily: initial.fontFamily,
      fontSize: initial.fontSize,
      lineHeight: initial.lineHeight,
      letterSpacing: initial.letterSpacing,
      rescaleOverlappingGlyphs: true,
      scrollback: initial.scrollback,
      scrollOnUserInput: false,
      theme: buildTerminalTheme()
    })
    const fitAddon = new FitAddon()
    const unicodeAddon = new Unicode11Addon()

    terminal.loadAddon(fitAddon)
    terminal.loadAddon(unicodeAddon)
    terminal.loadAddon(new WebLinksAddon())
    terminal.open(hostRef.current)
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

    const dataDisposable = terminal.onData((data) => onInputRef.current(data))
    terminalRef.current = terminal

    const pasteText = (text: string): void => {
      const CHUNK = 4096
      if (text.length <= CHUNK) {
        terminal.paste(text)
        return
      }
      let offset = 0
      const send = (): void => {
        terminal.paste(text.slice(offset, offset + CHUNK))
        offset += CHUNK
        if (offset < text.length) setTimeout(send, 10)
      }
      send()
    }
    pasteRef.current = pasteText

    const copyText = async (text: string): Promise<void> => {
      if (!text) return
      // Write via main (Electron clipboard, no renderer permission) first; fall
      // back to the web API. Keeps copy working even if clipboard-write is denied.
      const ok = await window.oxe.clipboard.writeText(text).catch(() => false)
      if (!ok) await navigator.clipboard.writeText(text).catch(() => undefined)
    }

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

    terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      const key = event.key.toLowerCase()

      // Copy selected text. Ctrl+Shift+C always copies (no PTY conflict).
      // Ctrl+C copies only when there's a selection — otherwise it must fall
      // through to the PTY as SIGINT (interrupt), the expected terminal behavior.
      if ((event.ctrlKey || event.metaKey) && key === 'c' && event.type === 'keydown' && !event.altKey) {
        const selection = terminal.getSelection()
        if (event.shiftKey) {
          if (selection) { void copyText(selection); terminal.clearSelection() }
          return false
        }
        if (selection) {
          void copyText(selection)
          terminal.clearSelection()
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

    const handleProgrammaticInsert = (event: Event): void => {
      const detail = (event as CustomEvent<{ paneId?: string; text?: string }>).detail
      if (detail?.paneId !== paneId || !detail.text) return
      terminal.focus()
      pasteText(detail.text)
    }
    window.addEventListener('oxe:terminal-insert-text', handleProgrammaticInsert)

    const fitTerminal = (): void => {
      try {
        // Preserve absolute scroll position. A relative scroll after fit can jump
        // when Copilot prints wide tables and the terminal reflows lines.
        const buf = terminal.buffer.active
        const viewportY = buf.viewportY
        const wasAtBottom = viewportY >= buf.baseY

        fitAddon.fit()
        onResizeRef.current(terminal.cols, terminal.rows)

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
      })
    }

    const scheduleRefresh = (): void => {
      if (refreshFrameRef.current !== null) return
      refreshFrameRef.current = window.requestAnimationFrame(() => {
        refreshFrameRef.current = null
        terminal.refresh(0, terminal.rows - 1)
      })
    }

    const resizeObserver = new ResizeObserver(scheduleFit)
    resizeObserver.observe(hostRef.current)
    scheduleFit()
    void document.fonts?.ready.then(scheduleFit).catch(() => undefined)

    let previewTimer: ReturnType<typeof setTimeout> | null = null

    const unsubscribeData = window.oxe.terminal.onData((event) => {
      if (event.paneId !== paneId) return
      // Smart scrollback: when the user has scrolled up to read history, new
      // streaming output from the agent shouldn't yank them back to the bottom.
      // xterm's default behavior on write() is "scroll to bottom on every
      // chunk", which makes it impossible to keep a scroll position while
      // Copilot/Claude are emitting tokens. We capture viewportY before the
      // write and restore it from the write callback if the user wasn't
      // already pinned at the bottom.
      const preBuf = terminal.buffer.active
      const preViewportY = preBuf.viewportY
      const wasAtBottom = preViewportY >= preBuf.baseY
      terminal.write(event.data, () => {
        if (!wasAtBottom) {
          const postBuf = terminal.buffer.active
          terminal.scrollToLine(Math.min(preViewportY, postBuf.baseY))
        }
      })
      scheduleRefresh()
      useTerminalStore.getState().updateActivity(paneId, event.data)
      if (previewTimer) clearTimeout(previewTimer)
      previewTimer = setTimeout(() => {
        previewTimer = null
        const preview = readAgentPreview(terminal)
        if (preview) useTerminalStore.getState().updatePreview(paneId, preview)
      }, 300)
    })
    const unsubscribeExit = window.oxe.terminal.onExit((event) => {
      if (event.paneId !== paneId) return
      terminal.write(`\r\n[process exited ${event.exitCode ?? ''}]\r\n`)
      onExitRef.current?.(event.exitCode)
    })

    return () => {
      if (fitFrameRef.current !== null) {
        window.cancelAnimationFrame(fitFrameRef.current)
        fitFrameRef.current = null
      }
      if (refreshFrameRef.current !== null) {
        window.cancelAnimationFrame(refreshFrameRef.current)
        refreshFrameRef.current = null
      }
      if (previewTimer) clearTimeout(previewTimer)
      unsubscribeData()
      unsubscribeExit()
      resizeObserver.disconnect()
      dataDisposable.dispose()
      hostRef.current?.removeEventListener('paste', handlePaste, { capture: true })
      window.removeEventListener('oxe:terminal-insert-text', handleProgrammaticInsert)
      pasteRef.current = null
      refitRef.current = null
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
      t.options.theme = buildTerminalTheme()
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
    prefs.scrollback
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

  return (
    <div
      ref={hostRef}
      className={`terminal-view${isDragOver ? ' terminal-drop-active' : ''}`}
      data-testid="terminal-view"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    />
  )
}
