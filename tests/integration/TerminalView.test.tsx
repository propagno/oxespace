import { render, screen, waitFor } from '@testing-library/react'
import { Terminal } from '@xterm/xterm'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { TerminalView } from '../../src/components/Terminal/TerminalView'
import { TERMINAL_PREFS_DEFAULTS } from '../../src/store/terminal-prefs.store'

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
  attachCustomKeyEventHandler: vi.fn(),
  getSelection: vi.fn(() => ''),
  clearSelection: vi.fn(),
  onSelectionChange: vi.fn(() => ({ dispose: vi.fn() }))
}

vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn().mockImplementation(() => ({
    cols: 120,
    rows: 32,
    options: {},
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
    getSelection: terminalState.getSelection,
    clearSelection: terminalState.clearSelection,
    onSelectionChange: terminalState.onSelectionChange,
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

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: vi.fn().mockImplementation(() => ({
    onContextLoss: vi.fn(),
    dispose: vi.fn()
  }))
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
    terminalState.getSelection.mockReset()
    terminalState.getSelection.mockReturnValue('')
    terminalState.clearSelection.mockClear()
    terminalState.onSelectionChange.mockClear()

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
        readText: vi.fn().mockResolvedValue(''),
        writeText: vi.fn().mockResolvedValue(undefined)
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
        saveImageToTemp: vi.fn().mockResolvedValue(null),
        readText: vi.fn().mockResolvedValue(''),
        writeText: vi.fn().mockResolvedValue(true)
      }
    } as unknown as typeof window.oxe
  })

  test('wires xterm input, resize and terminal events', async () => {
    const onInput = vi.fn()
    const onExit = vi.fn()
    const onResize = vi.fn()

    render(<TerminalView paneId="pane-1" isRunning themeId="dracula" prefs={TERMINAL_PREFS_DEFAULTS} onExit={onExit} onInput={onInput} onResize={onResize} />)

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
    render(<TerminalView paneId="pane-1" isRunning themeId="dracula" prefs={TERMINAL_PREFS_DEFAULTS} onInput={onInput} onResize={vi.fn()} />)

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

  test('paste event sends text once and blocks xterm native paste handling', () => {
    const stopPropagation = vi.fn()
    const stopImmediatePropagation = vi.fn()

    render(<TerminalView paneId="pane-1" isRunning themeId="dracula" prefs={TERMINAL_PREFS_DEFAULTS} onInput={vi.fn()} onResize={vi.fn()} />)

    const pasteEvent = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
    Object.defineProperty(pasteEvent, 'clipboardData', {
      value: {
        getData: vi.fn((type: string) => type === 'text/plain' ? 'copied text' : ''),
        items: []
      }
    })
    pasteEvent.stopPropagation = stopPropagation
    pasteEvent.stopImmediatePropagation = stopImmediatePropagation

    screen.getByTestId('terminal-view').dispatchEvent(pasteEvent)

    expect(pasteEvent.defaultPrevented).toBe(true)
    expect(stopPropagation).toHaveBeenCalled()
    expect(stopImmediatePropagation).toHaveBeenCalled()
    expect(terminalState.paste).toHaveBeenCalledTimes(1)
    expect(terminalState.paste).toHaveBeenCalledWith('copied text')
  })

  test('paste event prefers clipboard image over clipboard text', async () => {
    vi.mocked(window.oxe.clipboard.saveImageToTemp).mockResolvedValue('C:\\Temp\\image.png')

    render(<TerminalView paneId="pane-1" isRunning themeId="dracula" prefs={TERMINAL_PREFS_DEFAULTS} onInput={vi.fn()} onResize={vi.fn()} />)

    const pasteEvent = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent
    Object.defineProperty(pasteEvent, 'clipboardData', {
      value: {
        getData: vi.fn(() => ''),
        items: [{ type: 'image/png' }]
      }
    })
    screen.getByTestId('terminal-view').dispatchEvent(pasteEvent)

    await vi.waitFor(() => {
      expect(terminalState.paste).toHaveBeenCalledWith('C:\\Temp\\image.png ')
    })
    expect(navigator.clipboard.readText).not.toHaveBeenCalled()
  })

  test('programmatic terminal insert pastes text for the matching pane', () => {
    render(<TerminalView paneId="pane-1" isRunning themeId="dracula" prefs={TERMINAL_PREFS_DEFAULTS} onInput={vi.fn()} onResize={vi.fn()} />)

    window.dispatchEvent(new CustomEvent('oxe:terminal-insert-text', {
      detail: { paneId: 'pane-1', text: 'voice text' }
    }))

    expect(terminalState.focus).toHaveBeenCalled()
    expect(terminalState.paste).toHaveBeenCalledTimes(1)
    expect(terminalState.paste).toHaveBeenCalledWith('voice text')
  })

  test('programmatic terminal insert ignores other panes', () => {
    render(<TerminalView paneId="pane-1" isRunning themeId="dracula" prefs={TERMINAL_PREFS_DEFAULTS} onInput={vi.fn()} onResize={vi.fn()} />)

    window.dispatchEvent(new CustomEvent('oxe:terminal-insert-text', {
      detail: { paneId: 'pane-2', text: 'wrong pane' }
    }))

    expect(terminalState.paste).not.toHaveBeenCalled()
  })

  test('Ctrl+V explicitly reads the clipboard and pastes via terminal.paste', async () => {
    vi.mocked(window.oxe.clipboard.saveImageToTemp).mockResolvedValue(null)
    vi.mocked(navigator.clipboard.readText).mockResolvedValue('clipboard text')

    render(<TerminalView paneId="pane-1" isRunning themeId="dracula" prefs={TERMINAL_PREFS_DEFAULTS} onInput={vi.fn()} onResize={vi.fn()} />)

    const handler = terminalState.attachCustomKeyEventHandler.mock.calls[0][0] as (event: KeyboardEvent) => boolean
    const event = new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, cancelable: true })
    const handled = handler(event)

    // Returning false tells xterm not to forward to the PTY. We also
    // preventDefault() so the OS doesn't emit a follow-up `paste` event
    // (which would double-input via the hostRef listener).
    expect(handled).toBe(false)
    expect(event.defaultPrevented).toBe(true)

    await vi.waitFor(() => {
      expect(terminalState.paste).toHaveBeenCalledWith('clipboard text')
    })
    expect(navigator.clipboard.readText).toHaveBeenCalled()
  })

  test('Ctrl+V reads clipboard text from main (permission-free) before the web API', async () => {
    vi.mocked(window.oxe.clipboard.saveImageToTemp).mockResolvedValue(null)
    vi.mocked(window.oxe.clipboard.readText).mockResolvedValue('text from main')
    vi.mocked(navigator.clipboard.readText).mockResolvedValue('text from web')

    render(<TerminalView paneId="pane-1" isRunning themeId="dracula" prefs={TERMINAL_PREFS_DEFAULTS} onInput={vi.fn()} onResize={vi.fn()} />)

    const handler = terminalState.attachCustomKeyEventHandler.mock.calls[0][0] as (event: KeyboardEvent) => boolean
    handler(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, cancelable: true }))

    await vi.waitFor(() => {
      expect(terminalState.paste).toHaveBeenCalledWith('text from main')
    })
    // Main returned text, so the web API (which can be permission-denied) is never hit.
    expect(navigator.clipboard.readText).not.toHaveBeenCalled()
  })

  test('Alt+V passes through to PTY so Claude Code handles it natively', () => {
    render(<TerminalView paneId="pane-1" isRunning themeId="dracula" prefs={TERMINAL_PREFS_DEFAULTS} onInput={vi.fn()} onResize={vi.fn()} />)

    const handler = terminalState.attachCustomKeyEventHandler.mock.calls[0][0] as (event: KeyboardEvent) => boolean
    const handled = handler(new KeyboardEvent('keydown', { key: 'v', altKey: true }))

    expect(handled).toBe(true)
    expect(terminalState.paste).not.toHaveBeenCalled()
  })

  test('Ctrl+C with a selection copies it (and blocks SIGINT)', async () => {
    terminalState.getSelection.mockReturnValue('selected output')
    render(<TerminalView paneId="pane-1" isRunning themeId="dracula" prefs={TERMINAL_PREFS_DEFAULTS} onInput={vi.fn()} onResize={vi.fn()} />)

    const handler = terminalState.attachCustomKeyEventHandler.mock.calls[0][0] as (event: KeyboardEvent) => boolean
    const handled = handler(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true }))

    expect(handled).toBe(false) // copied — don't forward as interrupt
    await vi.waitFor(() => {
      expect(window.oxe.clipboard.writeText).toHaveBeenCalledWith('selected output')
    })
    expect(terminalState.clearSelection).toHaveBeenCalled()
  })

  test('Ctrl+C without a selection passes through to the PTY as SIGINT', () => {
    terminalState.getSelection.mockReturnValue('')
    render(<TerminalView paneId="pane-1" isRunning themeId="dracula" prefs={TERMINAL_PREFS_DEFAULTS} onInput={vi.fn()} onResize={vi.fn()} />)

    const handler = terminalState.attachCustomKeyEventHandler.mock.calls[0][0] as (event: KeyboardEvent) => boolean
    const handled = handler(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true }))

    expect(handled).toBe(true) // no selection → interrupt reaches the shell
    expect(window.oxe.clipboard.writeText).not.toHaveBeenCalled()
  })

  test('Ctrl+C copies a just-cleared selection via the recent-selection fallback', async () => {
    terminalState.getSelection.mockReturnValue('streamed output line')
    render(<TerminalView paneId="pane-1" isRunning themeId="dracula" prefs={TERMINAL_PREFS_DEFAULTS} onInput={vi.fn()} onResize={vi.fn()} />)

    // The user makes a selection (xterm fires onSelectionChange) …
    const onSelectionChange = terminalState.onSelectionChange.mock.calls[0][0] as () => void
    onSelectionChange()
    // … then xterm clears it (scrollback trim / buffer toggle) before Ctrl+C.
    terminalState.getSelection.mockReturnValue('')

    const handler = terminalState.attachCustomKeyEventHandler.mock.calls[0][0] as (event: KeyboardEvent) => boolean
    const handled = handler(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true }))

    expect(handled).toBe(false) // we still copied — don't send SIGINT
    await vi.waitFor(() => {
      expect(window.oxe.clipboard.writeText).toHaveBeenCalledWith('streamed output line')
    })
  })

  test('typing invalidates the recent selection so Ctrl+C becomes SIGINT again', () => {
    terminalState.getSelection.mockReturnValue('old selection')
    render(<TerminalView paneId="pane-1" isRunning themeId="dracula" prefs={TERMINAL_PREFS_DEFAULTS} onInput={vi.fn()} onResize={vi.fn()} />)

    const onSelectionChange = terminalState.onSelectionChange.mock.calls[0][0] as () => void
    onSelectionChange()
    // User types into the PTY — the stored selection must be discarded.
    terminalState.onData?.('x')
    terminalState.getSelection.mockReturnValue('')

    const handler = terminalState.attachCustomKeyEventHandler.mock.calls[0][0] as (event: KeyboardEvent) => boolean
    const handled = handler(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true }))

    expect(handled).toBe(true) // no live or recent selection → interrupt
    expect(window.oxe.clipboard.writeText).not.toHaveBeenCalled()
  })

  test('Ctrl+Shift+C always copies the selection', async () => {
    terminalState.getSelection.mockReturnValue('log line')
    render(<TerminalView paneId="pane-1" isRunning themeId="dracula" prefs={TERMINAL_PREFS_DEFAULTS} onInput={vi.fn()} onResize={vi.fn()} />)

    const handler = terminalState.attachCustomKeyEventHandler.mock.calls[0][0] as (event: KeyboardEvent) => boolean
    const handled = handler(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, shiftKey: true }))

    expect(handled).toBe(false)
    await vi.waitFor(() => {
      expect(window.oxe.clipboard.writeText).toHaveBeenCalledWith('log line')
    })
  })
})
