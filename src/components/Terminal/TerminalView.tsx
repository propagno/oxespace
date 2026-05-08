import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { useEffect, useRef, type ReactElement } from 'react'

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
  const onExitRef = useRef(onExit)
  const onInputRef = useRef(onInput)
  const onResizeRef = useRef(onResize)

  onExitRef.current = onExit
  onInputRef.current = onInput
  onResizeRef.current = onResize

  useEffect(() => {
    if (!hostRef.current) return

    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: 'Cascadia Mono, Consolas, monospace',
      fontSize: 14,
      theme: {
        background: '#000000',
        foreground: '#d8dde3',
        cursor: '#58a6ff',
        selectionBackground: '#1b2f4a',
        black: '#000000',
        blue: '#238bff',
        brightBlue: '#58a6ff',
        brightGreen: '#36d399',
        brightWhite: '#f5fbff',
        cyan: '#58a6ff',
        green: '#36d399',
        red: '#ff6b7a',
        white: '#d8dde3'
      }
    })
    const fitAddon = new FitAddon()

    terminal.loadAddon(fitAddon)
    terminal.loadAddon(new WebLinksAddon())
    terminal.open(hostRef.current)
    terminal.write('Idle\r\n')

    const dataDisposable = terminal.onData((data) => onInputRef.current(data))
    terminalRef.current = terminal

    const fitTerminal = (): void => {
      try {
        fitAddon.fit()
        onResizeRef.current(terminal.cols, terminal.rows)
      } catch {
        // xterm may not have measurable dimensions during first layout.
      }
    }

    const resizeObserver = new ResizeObserver(fitTerminal)
    resizeObserver.observe(hostRef.current)
    fitTerminal()

    const unsubscribeData = window.oxe.terminal.onData((event) => {
      if (event.paneId === paneId) terminal.write(event.data)
    })
    const unsubscribeExit = window.oxe.terminal.onExit((event) => {
      if (event.paneId !== paneId) return

      terminal.write(`\r\n[process exited ${event.exitCode ?? ''}]\r\n`)
      onExitRef.current?.(event.exitCode)
    })

    return () => {
      unsubscribeData()
      unsubscribeExit()
      resizeObserver.disconnect()
      dataDisposable.dispose()
      terminal.dispose()
      terminalRef.current = null
    }
  }, [paneId])

  useEffect(() => {
    if (isRunning) terminalRef.current?.focus()
  }, [isRunning])

  return <div ref={hostRef} className="terminal-view" data-testid="terminal-view" />
}
