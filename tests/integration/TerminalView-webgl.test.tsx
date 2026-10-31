import { render, waitFor } from '@testing-library/react'
import { Terminal } from '@xterm/xterm'
import { WebglAddon } from '@xterm/addon-webgl'
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
  Terminal: vi.fn().mockImplementation(function () { return {
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
  } })
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn().mockImplementation(function () { return {
    fit: vi.fn()
  } })
}))

vi.mock('@xterm/addon-unicode11', () => ({
  Unicode11Addon: vi.fn()
}))

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: vi.fn()
}))

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: vi.fn().mockImplementation(function () { return {
    onContextLoss: vi.fn(),
    dispose: vi.fn()
  } })
}))

vi.mock('@xterm/addon-search', () => ({
  SearchAddon: vi.fn().mockImplementation(function () { return {
    findNext: searchState.findNext,
    findPrevious: searchState.findPrevious,
    clearDecorations: searchState.clearDecorations,
    onDidChangeResults: vi.fn(() => ({ dispose: vi.fn() })),
    dispose: vi.fn()
  } })
}))


describe('TerminalView WebGL renderer, loaded on first use', () => {
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
        attach: vi.fn().mockResolvedValue({ running: false, seq: 0, prologue: '', replay: '', truncated: false, altScreen: false }),
        detach: vi.fn(),
        status: vi.fn().mockResolvedValue({ running: false, seq: 0, altScreen: false }),
        onData: vi.fn(() => vi.fn()),
        onExit: vi.fn(() => vi.fn()),
        onActivity: vi.fn(() => vi.fn())
      },
      clipboard: {
        saveImageToTemp: vi.fn().mockResolvedValue(null),
        readText: vi.fn().mockResolvedValue(''),
        writeText: vi.fn().mockResolvedValue(true)
      }
    } as unknown as typeof window.oxe
  })

  // jsdom has no WebGL2: give the preflight a context so the addon path runs.
  const withWebgl2 = (): void => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((kind: string) =>
      kind === 'webgl2' ? { getExtension: () => null } : null) as unknown as HTMLCanvasElement['getContext'])
  }
  const loadedAddons = (): unknown[] => vi.mocked(Terminal).mock.results.flatMap(result =>
    vi.mocked((result.value as { loadAddon: (addon: unknown) => void }).loadAddon).mock.calls.map(call => call[0]))

  test('loads the WebGL addon on first use, after the pane mounted, and hands it to the terminal', async () => {
    withWebgl2()
    vi.mocked(WebglAddon).mockClear()
    render(<TerminalView paneId="pane-webgl" isRunning themeId="dracula" prefs={TERMINAL_PREFS_DEFAULTS} onInput={vi.fn()} onResize={vi.fn()} />)
    // The module is still on its way: the pane draws with the DOM renderer meanwhile.
    expect(WebglAddon).not.toHaveBeenCalled()
    await waitFor(() => expect(WebglAddon).toHaveBeenCalledTimes(1))
    const addon = vi.mocked(WebglAddon).mock.results[0].value
    expect(loadedAddons()).toContain(addon)
  })

  test('a pane closed before the addon arrives never creates one', async () => {
    withWebgl2()
    vi.mocked(WebglAddon).mockClear()
    // The class is cached after the first load; a fresh module copy starts without it.
    vi.resetModules()
    const { TerminalView: FreshTerminalView } = await import('../../src/components/Terminal/TerminalView')
    const { WebglAddon: FreshWebglAddon } = await import('@xterm/addon-webgl')
    const view = render(<FreshTerminalView paneId="pane-gone" isRunning themeId="dracula" prefs={TERMINAL_PREFS_DEFAULTS} onInput={vi.fn()} onResize={vi.fn()} />)
    view.unmount()
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(FreshWebglAddon).not.toHaveBeenCalled()
    // Mounted and kept, the same fresh copy does load it: the test above is not passing for want of a context.
    render(<FreshTerminalView paneId="pane-kept" isRunning themeId="dracula" prefs={TERMINAL_PREFS_DEFAULTS} onInput={vi.fn()} onResize={vi.fn()} />)
    await waitFor(() => expect(FreshWebglAddon).toHaveBeenCalledTimes(1))
  })
})
