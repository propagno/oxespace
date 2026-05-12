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
      scrollback: 2_147_483_647,
      theme: {
        background:         tok('--bg-tile-content', '#000000'),
        foreground:         tok('--tx-primary',       '#f1f5f9'),
        cursor:             tok('--brand-light',      '#818cf8'),
        selectionBackground:tok('--brand-glow',       'rgba(79,70,229,0.35)'),
        black:              tok('--dot-gray',          '#3b4260'),
        red:                tok('--dot-red',           '#f87171'),
        green:              tok('--dot-green',         '#34d474'),
        yellow:             tok('--dot-yellow',        '#fbbf24'),
        blue:               tok('--dot-blue',          '#60a5fa'),
        magenta:            tok('--dot-purple',        '#c084fc'),
        cyan:               tok('--brand-light',      '#818cf8'),
        white:              tok('--tx-primary',       '#f1f5f9'),
        brightBlack:        tok('--tx-muted',          '#636b75'),
        brightRed:          tok('--dot-red',           '#f87171'),
        brightGreen:        tok('--dot-green',         '#34d399'),
        brightYellow:       tok('--dot-orange',        '#f97316'),
        brightBlue:         tok('--brand-light',      '#818cf8'),
        brightMagenta:      tok('--dot-purple',        '#c084fc'),
        brightCyan:         tok('--brand-lightest',   '#c7d2fe'),
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

    terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'v' && event.type === 'keydown') {
        void navigator.clipboard.readText().then((text) => {
          if (text) pasteText(text)
        })
        return false
      }
      return true
    })

    const handlePaste = (event: ClipboardEvent): void => {
      const text = event.clipboardData?.getData('text/plain')
      if (text) {
        event.preventDefault()
        pasteText(text)
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
