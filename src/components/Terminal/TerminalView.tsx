import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useTerminalStore } from '../../store/terminal.store'

// Claude Code uses ⏺ (U+23FA) on Mac and ● (U+25CF) on Windows
const AGENT_MARKERS = ['⏺', '●']

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
}

export function TerminalView({ isRunning, onExit, onInput, onResize, paneId }: TerminalViewProps): ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const pasteRef = useRef<((text: string) => void) | null>(null)
  const onExitRef = useRef(onExit)
  const onInputRef = useRef(onInput)
  const onResizeRef = useRef(onResize)
  const [isDragOver, setIsDragOver] = useState(false)

  onExitRef.current = onExit
  onInputRef.current = onInput
  onResizeRef.current = onResize

  useEffect(() => {
    if (!hostRef.current) return

    const tok = (name: string, fallback: string): string => {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
      return v || fallback
    }

    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: 'Cascadia Mono, Consolas, monospace',
      fontSize: 14,
      scrollback: 100_000,
      scrollOnUserInput: false,
      theme: {
        background:         tok('--bg-tile-content', '#000000'),
        foreground:         tok('--tx-primary',       '#f1f5f9'),
        cursor:             tok('--brand-light',      '#6EEBD4'),
        selectionBackground:tok('--brand-glow',       'rgba(18,199,154,0.28)'),
        black:              tok('--dot-gray',          '#3b4260'),
        red:                tok('--dot-red',           '#f87171'),
        green:              tok('--dot-green',         '#34d474'),
        yellow:             tok('--dot-yellow',        '#fbbf24'),
        blue:               tok('--dot-blue',          '#60a5fa'),
        magenta:            tok('--dot-purple',        '#c084fc'),
        cyan:               tok('--brand-light',      '#6EEBD4'),
        white:              tok('--tx-primary',       '#f1f5f9'),
        brightBlack:        tok('--tx-muted',          '#636b75'),
        brightRed:          tok('--dot-red',           '#f87171'),
        brightGreen:        tok('--dot-green',         '#34d399'),
        brightYellow:       tok('--dot-orange',        '#f97316'),
        brightBlue:         tok('--brand-light',      '#6EEBD4'),
        brightMagenta:      tok('--dot-purple',        '#c084fc'),
        brightCyan:         tok('--brand-lightest',   '#B4F5E8'),
        brightWhite:        tok('--tx-primary',       '#f1f5f9'),
      }
    })
    const fitAddon = new FitAddon()

    terminal.loadAddon(fitAddon)
    terminal.loadAddon(new WebLinksAddon())
    terminal.open(hostRef.current)
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

    const pasteClipboardContents = async (): Promise<void> => {
      // Always check for image first: agent CLIs (Claude Code, Copilot) prefer file-path
      // references and readText() can return stale/unrelated text even when clipboard has an image.
      const imagePath = await window.oxe.clipboard.saveImageToTemp().catch(() => null)
      if (imagePath) {
        pasteText(`${imagePath} `)
        return
      }
      const text = await navigator.clipboard.readText().catch(() => '')
      if (text) pasteText(text)
    }

    terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      const key = event.key.toLowerCase()

      if ((event.ctrlKey || event.metaKey) && key === 'v' && event.type === 'keydown') {
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
        pasteText(text)
        return
      }
      const hasImage = Array.from(event.clipboardData?.items ?? []).some((item) => item.type.startsWith('image/'))
      if (hasImage) {
        event.preventDefault()
        void window.oxe.clipboard.saveImageToTemp().then((imagePath) => {
          if (imagePath) pasteText(`${imagePath} `)
        }).catch(() => undefined)
      }
    }
    hostRef.current.addEventListener('paste', handlePaste)

    const fitTerminal = (): void => {
      try {
        // Preserve scroll position — fitAddon.fit() can reset ydisp on resize
        const buf = terminal.buffer.active
        const linesFromBottom = buf.baseY - buf.viewportY

        fitAddon.fit()
        onResizeRef.current(terminal.cols, terminal.rows)

        if (linesFromBottom > 0) {
          terminal.scrollLines(-linesFromBottom)
        }
      } catch {
        // xterm may not have measurable dimensions during first layout.
      }
    }

    const resizeObserver = new ResizeObserver(fitTerminal)
    resizeObserver.observe(hostRef.current)
    fitTerminal()

    let previewTimer: ReturnType<typeof setTimeout> | null = null

    const unsubscribeData = window.oxe.terminal.onData((event) => {
      if (event.paneId !== paneId) return
      terminal.write(event.data)
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
      if (previewTimer) clearTimeout(previewTimer)
      unsubscribeData()
      unsubscribeExit()
      resizeObserver.disconnect()
      dataDisposable.dispose()
      hostRef.current?.removeEventListener('paste', handlePaste)
      pasteRef.current = null
      terminal.dispose()
      terminalRef.current = null
    }
  }, [paneId])

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
