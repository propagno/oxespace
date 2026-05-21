import { render, screen, waitFor } from '@testing-library/react'
import { Terminal } from '@xterm/xterm'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { TerminalView } from '../../src/components/Terminal/TerminalView'

const terminalState = {
  onData: null as ((data: string) => void) | null,
  write: vi.fn(),
  focus: vi.fn(),
  dispose: vi.fn(),
  paste: vi.fn(),
  refresh: vi.fn(),
  scrollLines: vi.fn(),
  scrollToBottom: vi.fn(),
  scrollToLine: vi.fn(),
  attachCustomKeyEventHandler: vi.fn()
}

vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn().mockImplementation(() => ({
    cols: 120,
    rows: 32,
    loadAddon: vi.fn(),
    open: vi.fn(),
    write: terminalState.write,
    focus: terminalState.focus,
    dispose: terminalState.dispose,
    paste: terminalState.paste,
    refresh: terminalState.refresh,
    scrollLines: terminalState.scrollLines,
    unicode: { activeVersion: '6' },
    scrollToBottom: terminalState.scrollToBottom,
    scrollToLine: terminalState.scrollToLine,
    attachCustomKeyEventHandler: terminalState.attachCustomKeyEventHandler,
    buffer: {
      active: { baseY: 0, viewportY: 0, cursorY: 0, length: 0, getLine: vi.fn(() => null) }
    },
    onData: vi.fn((handler: (data: string) => void) => {
      terminalState.onData = handler
      return { dispose: vi.fn() }
    })
  }))
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn().mockImplementation(() => ({
    fit: vi.fn()
  }))
}))

vi.mock('@xterm/addon-unicode11', () => ({
  Unicode11Addon: vi.fn()
}))

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: vi.fn()
}))

describe('TerminalView', () => {
  beforeEach(() => {
    terminalState.onData = null
    terminalState.write.mockClear()
    terminalState.focus.mockClear()
    terminalState.dispose.mockClear()
    terminalState.paste.mockClear()
    terminalState.refresh.mockClear()
    terminalState.scrollLines.mockClear()
    terminalState.scrollToBottom.mockClear()
    terminalState.scrollToLine.mockClear()
    terminalState.attachCustomKeyEventHandler.mockClear()

    global.ResizeObserver = class {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(): void {
        this.callback([], this as unknown as ResizeObserver)
      }
      disconnect(): void {}
      unobserve(): void {}
      takeRecords(): ResizeObserverEntry[] {
        return []
      }
    }

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        readText: vi.fn().mockResolvedValue('')
      }
    })

    window.oxe = {
      app: { version: '0.1.0' },
      workspace: {
        list: vi.fn(),
        create: vi.fn(),
        setActive: vi.fn(),
        delete: vi.fn(),
        closePane: vi.fn(),
        pickFolder: vi.fn(),
        shellProfiles: vi.fn()
      } as unknown as typeof window.oxe.workspace,
      terminal: {
        start: vi.fn(),
        write: vi.fn(),
        resize: vi.fn(),
        stop: vi.fn(),
        restart: vi.fn(),
        onData: vi.fn(() => vi.fn()),
        onExit: vi.fn(() => vi.fn())
      },
      clipboard: {
        saveImageToTemp: vi.fn().mockResolvedValue(null)
      }
    } as unknown as typeof window.oxe
  })

  test('wires xterm input, resize and terminal events', async () => {
    const onInput = vi.fn()
    const onExit = vi.fn()
    const onResize = vi.fn()

    render(<TerminalView paneId="pane-1" isRunning onExit={onExit} onInput={onInput} onResize={onResize} />)

    expect(screen.getByTestId('terminal-view')).toBeInTheDocument()
    expect(Terminal).toHaveBeenCalledWith(expect.objectContaining({ allowProposedApi: true }))
    await waitFor(() => expect(onResize).toHaveBeenCalledWith(120, 32))
    expect(terminalState.attachCustomKeyEventHandler).toHaveBeenCalled()

    terminalState.onData?.('a')
    expect(onInput).toHaveBeenCalledWith('a')

    const dataListener = vi.mocked(window.oxe.terminal.onData).mock.calls[0][0]
    dataListener({ paneId: 'pane-1', data: 'hello' })
    // Smart-scrollback passes a callback as the 2nd arg to terminal.write so
    // the viewport can be restored after the chunk is rendered.
    expect(terminalState.write).toHaveBeenCalledWith('hello', expect.any(Function))

    const exitListener = vi.mocked(window.oxe.terminal.onExit).mock.calls[0][0]
    exitListener({ paneId: 'pane-1', exitCode: 0 })
    expect(onExit).toHaveBeenCalledWith(0)
    expect(terminalState.focus).toHaveBeenCalled()
  })

  test('sends Kitty Shift+Enter sequence on keydown and blocks keypress', () => {
    const onInput = vi.fn()
    render(<TerminalView paneId="pane-1" isRunning onInput={onInput} onResize={vi.fn()} />)

    const handler = terminalState.attachCustomKeyEventHandler.mock.calls[0][0] as (event: KeyboardEvent) => boolean

    const keydown = handler(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true }))
    expect(keydown).toBe(false)
    expect(onInput).toHaveBeenCalledWith('\x1b[13;2u')

    onInput.mockClear()

    // keypress must also be blocked so xterm cannot send \r (submit)
    const keypress = handler(new KeyboardEvent('keypress', { key: 'Enter', shiftKey: true }))
    expect(keypress).toBe(false)
    expect(onInput).not.toHaveBeenCalled()

    expect(terminalState.paste).not.toHaveBeenCalled()
  })

  test('Ctrl+V prefers clipboard image over clipboard text', async () => {
    vi.spyOn(navigator.clipboard, 'readText').mockResolvedValue('copied text')
    vi.mocked(window.oxe.clipboard.saveImageToTemp).mockResolvedValue('C:\\Temp\\image.png')

    render(<TerminalView paneId="pane-1" isRunning onInput={vi.fn()} onResize={vi.fn()} />)

    const handler = terminalState.attachCustomKeyEventHandler.mock.calls[0][0] as (event: KeyboardEvent) => boolean
    const handled = handler(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true }))

    expect(handled).toBe(false)
    await vi.waitFor(() => {
      expect(terminalState.paste).toHaveBeenCalledWith('C:\\Temp\\image.png ')
    })
    expect(navigator.clipboard.readText).not.toHaveBeenCalled()
  })

  test('Alt+V passes through to PTY so Claude Code handles it natively', () => {
    render(<TerminalView paneId="pane-1" isRunning onInput={vi.fn()} onResize={vi.fn()} />)

    const handler = terminalState.attachCustomKeyEventHandler.mock.calls[0][0] as (event: KeyboardEvent) => boolean
    const handled = handler(new KeyboardEvent('keydown', { key: 'v', altKey: true }))

    expect(handled).toBe(true)
    expect(terminalState.paste).not.toHaveBeenCalled()
  })
})
