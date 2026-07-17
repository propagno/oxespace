import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  input: vi.fn(),
  refresh: vi.fn(),
  clear: vi.fn(),
  scrollLines: vi.fn(),
  scrollToBottom: vi.fn(),
  scrollToLine: vi.fn(),
  attachCustomKeyEventHandler: vi.fn(),
  attachCustomWheelEventHandler: vi.fn(),
  registerOscHandler: vi.fn(),
  getSelection: vi.fn(() => ''),
  clearSelection: vi.fn(),
  onSelectionChange: vi.fn(() => ({ dispose: vi.fn() }))
}

const searchState = {
  findNext: vi.fn(),
  findPrevious: vi.fn(),
  clearDecorations: vi.fn()
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
    input: terminalState.input,
    modes: { bracketedPasteMode: true, mouseTrackingMode: 'none' },
    refresh: terminalState.refresh,
    clear: terminalState.clear,
    scrollLines: terminalState.scrollLines,
    unicode: { activeVersion: '6' },
    scrollToBottom: terminalState.scrollToBottom,
    scrollToLine: terminalState.scrollToLine,
    attachCustomKeyEventHandler: terminalState.attachCustomKeyEventHandler,
    attachCustomWheelEventHandler: terminalState.attachCustomWheelEventHandler,
    parser: { registerOscHandler: terminalState.registerOscHandler },
    getSelection: terminalState.getSelection,
    clearSelection: terminalState.clearSelection,
    onSelectionChange: terminalState.onSelectionChange,
    buffer: {
      active: { type: 'normal', baseY: 0, viewportY: 0, cursorY: 0, length: 0, getLine: vi.fn(() => null) }
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

vi.mock('@xterm/addon-search', () => ({
  SearchAddon: vi.fn().mockImplementation(() => ({
    findNext: searchState.findNext,
    findPrevious: searchState.findPrevious,
    clearDecorations: searchState.clearDecorations,
    onDidChangeResults: vi.fn(() => ({ dispose: vi.fn() })),
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
    terminalState.input.mockClear()
    terminalState.refresh.mockClear()
    terminalState.scrollLines.mockClear()
    terminalState.scrollToBottom.mockClear()
    terminalState.scrollToLine.mockClear()
    terminalState.attachCustomKeyEventHandler.mockClear()
    terminalState.registerOscHandler.mockReset()
    terminalState.registerOscHandler.mockReturnValue({ dispose: vi.fn() })
    terminalState.getSelection.mockReset()
    terminalState.getSelection.mockReturnValue('')
    terminalState.clearSelection.mockClear()
    terminalState.onSelectionChange.mockClear()
    terminalState.clear.mockClear()
    searchState.findNext.mockClear()
    searchState.findPrevious.mockClear()
    searchState.clearDecorations.mockClear()

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

    const dataListener = vi.mocked(window.oxe.terminal.onData).mock.calls[0][1]
    dataListener({ paneId: 'pane-1', data: 'hello' })
    // Smart-scrollback passes a callback as the 2nd arg to terminal.write so
    // the viewport can be restored after the chunk is rendered.
    expect(terminalState.write).toHaveBeenCalledWith('hello', expect.any(Function))

    const exitListener = vi.mocked(window.oxe.terminal.onExit).mock.calls[0][1]
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

  test('large paste sends one bracketed-paste envelope instead of one per chunk', () => {
    // Regression for the "large pastes randomly fail" bug: terminal.paste()
    // wraps EVERY call in \x1b[200~ / \x1b[201~. Chunking by calling paste()
    // repeatedly used to emit N separate envelopes, which readline-based
    // shells/CLIs can misread as N separate pastes (an embedded newline right
    // after a chunk boundary gets treated as a literal Enter). The fix sends
    // a single opening/closing marker and feeds the raw chunks through
    // terminal.input() instead.
    vi.useFakeTimers()
    render(<TerminalView paneId="pane-1" isRunning themeId="dracula" prefs={TERMINAL_PREFS_DEFAULTS} onInput={vi.fn()} onResize={vi.fn()} />)

    const bigText = 'a'.repeat(9000) // > one 4096 chunk, < three
    window.dispatchEvent(new CustomEvent('oxe:terminal-insert-text', {
      detail: { paneId: 'pane-1', text: bigText }
    }))
    vi.runAllTimers()
    vi.useRealTimers()

    // terminal.paste() (which self-wraps) must not be used for the chunked path.
    expect(terminalState.paste).not.toHaveBeenCalled()

    const calls = terminalState.input.mock.calls
    expect(calls[0]).toEqual(['\x1b[200~', false])
    expect(calls[calls.length - 1]).toEqual(['\x1b[201~', false])

    // Exactly one opening and one closing marker, regardless of chunk count.
    const markerCalls = calls.filter((c) => c[0] === '\x1b[200~' || c[0] === '\x1b[201~')
    expect(markerCalls).toHaveLength(2)

    // The raw chunks between the markers reassemble to the original text.
    const contentChunks = calls.slice(1, -1)
    expect(contentChunks.every((c) => c[1] === true)).toBe(true)
    expect(contentChunks.map((c) => c[0]).join('')).toBe(bigText)
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

  test('native copy events preserve a long terminal selection', async () => {
    const selection = 'curl https://api.example.test ' + 'x'.repeat(20_000)
    terminalState.getSelection.mockReturnValue(selection)
    render(<TerminalView paneId="pane-1" isRunning themeId="dracula" prefs={TERMINAL_PREFS_DEFAULTS} onInput={vi.fn()} onResize={vi.fn()} />)

    const copyEvent = new Event('copy', { bubbles: true, cancelable: true }) as ClipboardEvent
    const setData = vi.fn()
    Object.defineProperty(copyEvent, 'clipboardData', { value: { setData } })
    screen.getByTestId('terminal-view').dispatchEvent(copyEvent)

    expect(copyEvent.defaultPrevented).toBe(true)
    expect(setData).toHaveBeenCalledWith('text/plain', selection)
    await vi.waitFor(() => expect(window.oxe.clipboard.writeText).toHaveBeenCalledWith(selection))
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

  test('streamed output pins the viewport instead of auto-scrolling while a selection is live', () => {
    // Reproduces the "can't copy during a long CLI session" bug: with an
    // active selection, new PTY output must not be allowed to auto-scroll the
    // terminal to the bottom (as xterm does by default), because that yanks
    // the rows out from under an in-progress mouse-drag or a just-finished
    // one, so the selection never has a chance to survive to Ctrl+C.
    terminalState.getSelection.mockReturnValue('selected output')
    render(<TerminalView paneId="pane-1" isRunning themeId="dracula" prefs={TERMINAL_PREFS_DEFAULTS} onInput={vi.fn()} onResize={vi.fn()} />)

    const dataListener = vi.mocked(window.oxe.terminal.onData).mock.calls[0][1]
    dataListener({ paneId: 'pane-1', data: 'more streamed tokens\r\n' })

    const writeCall = terminalState.write.mock.calls.find((call) => call[0] === 'more streamed tokens\r\n')
    expect(writeCall).toBeDefined()
    const onWritten = writeCall![1] as () => void
    onWritten()

    // Even though the mock buffer reports viewportY >= baseY ("at the
    // bottom"), the live selection must force the viewport to be restored
    // rather than left to xterm's default auto-scroll-to-bottom.
    expect(terminalState.scrollToLine).toHaveBeenCalledWith(0)
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

  test('OSC 52 copies TUI-owned selections to the Electron clipboard', async () => {
    render(<TerminalView paneId="pane-1" isRunning themeId="dracula" prefs={TERMINAL_PREFS_DEFAULTS} onInput={vi.fn()} onResize={vi.fn()} />)

    expect(terminalState.registerOscHandler).toHaveBeenCalledWith(52, expect.any(Function))
    const handler = terminalState.registerOscHandler.mock.calls[0][1] as (data: string) => Promise<boolean>
    const text = 'portal já está servindo'
    const bytes = new TextEncoder().encode(text)
    const encoded = btoa(String.fromCharCode(...bytes))

    await expect(handler(`c;${encoded}`)).resolves.toBe(true)
    expect(window.oxe.clipboard.writeText).toHaveBeenCalledWith(text)
  })

  test('OSC 52 never exposes clipboard contents or accepts malformed data', async () => {
    render(<TerminalView paneId="pane-1" isRunning themeId="dracula" prefs={TERMINAL_PREFS_DEFAULTS} onInput={vi.fn()} onResize={vi.fn()} />)

    const handler = terminalState.registerOscHandler.mock.calls[0][1] as (data: string) => Promise<boolean>
    await expect(handler('c;?')).resolves.toBe(true)
    await expect(handler('c;not valid base64!')).resolves.toBe(true)

    expect(window.oxe.clipboard.readText).not.toHaveBeenCalled()
    expect(window.oxe.clipboard.writeText).not.toHaveBeenCalled()
  })

  test('Ctrl+F opens the search overlay; typing runs incremental search; Escape closes it', () => {
    render(<TerminalView paneId="pane-1" isRunning themeId="dracula" prefs={TERMINAL_PREFS_DEFAULTS} onInput={vi.fn()} onResize={vi.fn()} />)

    expect(screen.queryByTestId('terminal-search')).not.toBeInTheDocument()

    const handler = terminalState.attachCustomKeyEventHandler.mock.calls[0][0] as (event: KeyboardEvent) => boolean
    const event = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, cancelable: true })
    let handled = true
    act(() => { handled = handler(event) })

    expect(handled).toBe(false) // must not reach the PTY
    expect(event.defaultPrevented).toBe(true)
    expect(screen.getByTestId('terminal-search')).toBeInTheDocument()

    const input = screen.getByLabelText('Search terminal')
    fireEvent.change(input, { target: { value: 'error' } })
    expect(searchState.findNext).toHaveBeenCalledWith('error', expect.objectContaining({ incremental: true }))

    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(searchState.findPrevious).toHaveBeenCalledWith('error', expect.objectContaining({ incremental: false }))

    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByTestId('terminal-search')).not.toBeInTheDocument()
    expect(searchState.clearDecorations).toHaveBeenCalled()
    expect(terminalState.focus).toHaveBeenCalled()
  })

  test('oxe:terminal-open-search event opens the overlay for the matching pane only', () => {
    render(<TerminalView paneId="pane-1" isRunning themeId="dracula" prefs={TERMINAL_PREFS_DEFAULTS} onInput={vi.fn()} onResize={vi.fn()} />)

    act(() => {
      window.dispatchEvent(new CustomEvent('oxe:terminal-open-search', { detail: { paneId: 'pane-2' } }))
    })
    expect(screen.queryByTestId('terminal-search')).not.toBeInTheDocument()

    act(() => {
      window.dispatchEvent(new CustomEvent('oxe:terminal-open-search', { detail: { paneId: 'pane-1' } }))
    })
    expect(screen.getByTestId('terminal-search')).toBeInTheDocument()
  })

  test('oxe:terminal-clear event clears the matching pane only', () => {
    render(<TerminalView paneId="pane-1" isRunning themeId="dracula" prefs={TERMINAL_PREFS_DEFAULTS} onInput={vi.fn()} onResize={vi.fn()} />)

    window.dispatchEvent(new CustomEvent('oxe:terminal-clear', { detail: { paneId: 'pane-2' } }))
    expect(terminalState.clear).not.toHaveBeenCalled()

    window.dispatchEvent(new CustomEvent('oxe:terminal-clear', { detail: { paneId: 'pane-1' } }))
    expect(terminalState.clear).toHaveBeenCalledTimes(1)
  })
})
