import { act, render } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  createPtyResizeDebouncer,
  isValidPtyGrid,
  MIN_VALID_PTY_COLS,
  MIN_VALID_PTY_ROWS,
  PTY_RESIZE_DEBOUNCE_MS
} from '../../../src/components/Terminal/resizeDebounce'
import { TerminalView } from '../../../src/components/Terminal/TerminalView'
import { TERMINAL_PREFS_DEFAULTS } from '../../../src/store/terminal-prefs.store'

const mockState = {
  nextCols: 120,
  nextRows: 32,
  activeTerminal: null as { cols: number; rows: number } | null,
  fitSpy: vi.fn(),
  resizeCallback: null as (() => void) | null
}

vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn().mockImplementation(function () {
    const instance = {
      cols: 80,
      rows: 24,
      options: {},
      loadAddon: vi.fn(),
      registerLinkProvider: vi.fn(() => ({ dispose: vi.fn() })),
      open: vi.fn(),
      write: vi.fn((_data: string, cb?: () => void) => cb?.()),
      focus: vi.fn(),
      dispose: vi.fn(),
      paste: vi.fn(),
      input: vi.fn(),
      modes: { bracketedPasteMode: true, mouseTrackingMode: 'none' },
      refresh: vi.fn(),
      clear: vi.fn(),
      reset: vi.fn(),
      scrollLines: vi.fn(),
      unicode: { activeVersion: '6' },
      scrollToBottom: vi.fn(),
      scrollToLine: vi.fn(),
      attachCustomKeyEventHandler: vi.fn(),
      attachCustomWheelEventHandler: vi.fn(),
      parser: { registerOscHandler: vi.fn(() => ({ dispose: vi.fn() })) },
      getSelection: vi.fn(() => ''),
      clearSelection: vi.fn(),
      onSelectionChange: vi.fn(() => ({ dispose: vi.fn() })),
      buffer: {
        active: { type: 'normal', baseY: 0, viewportY: 0, cursorY: 0, length: 0, getLine: vi.fn(() => null) }
      },
      onData: vi.fn(() => ({ dispose: vi.fn() }))
    }
    mockState.activeTerminal = instance
    return instance
  })
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn().mockImplementation(function () {
    return {
      fit: vi.fn(() => {
        mockState.fitSpy()
        if (mockState.activeTerminal) {
          mockState.activeTerminal.cols = mockState.nextCols
          mockState.activeTerminal.rows = mockState.nextRows
        }
      }),
      proposeDimensions: vi.fn(() => ({ cols: mockState.nextCols, rows: mockState.nextRows }))
    }
  })
}))
vi.mock('@xterm/addon-unicode11', () => ({ Unicode11Addon: vi.fn() }))
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: vi.fn() }))
vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: vi.fn().mockImplementation(function () {
    return { onContextLoss: vi.fn(), dispose: vi.fn() }
  })
}))
vi.mock('@xterm/addon-search', () => ({
  SearchAddon: vi.fn().mockImplementation(function () {
    return {
      findNext: vi.fn(),
      findPrevious: vi.fn(),
      clearDecorations: vi.fn(),
      onDidChangeResults: vi.fn(() => ({ dispose: vi.fn() })),
      dispose: vi.fn()
    }
  })
}))

const flushMicrotasks = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('OXE-451 A1 · Trailing pty.resize debounce and transient dimension filter', () => {
  beforeEach(() => {
    mockState.nextCols = 120
    mockState.nextRows = 32
    mockState.activeTerminal = null
    mockState.fitSpy.mockClear()
    mockState.resizeCallback = null

    global.ResizeObserver = class {
      constructor(private readonly callback: ResizeObserverCallback) {
        mockState.resizeCallback = () => this.callback([], this as unknown as ResizeObserver)
      }
      observe(): void {}
      disconnect(): void {}
      unobserve(): void {}
      takeRecords(): ResizeObserverEntry[] {
        return []
      }
    }

    window.oxe = {
      app: { version: '1.6.3', platform: 'win32' },
      workspace: {} as typeof window.oxe.workspace,
      terminal: {
        start: vi.fn(),
        write: vi.fn(),
        resize: vi.fn(),
        stop: vi.fn(),
        restart: vi.fn(),
        attach: vi.fn().mockResolvedValue({ running: true, seq: 1, prologue: '', replay: '', truncated: false, altScreen: false }),
        detach: vi.fn().mockResolvedValue(undefined),
        status: vi.fn().mockResolvedValue({ running: true, seq: 1, altScreen: false }),
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

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  test('debouncer emits initial valid grid immediately, drops cols < 20 / rows < 4, coalesces bursts, and cancels flicker', () => {
    expect(PTY_RESIZE_DEBOUNCE_MS).toBeGreaterThanOrEqual(90)
    expect(PTY_RESIZE_DEBOUNCE_MS).toBeLessThanOrEqual(120)
    expect(MIN_VALID_PTY_COLS).toBe(20)
    expect(MIN_VALID_PTY_ROWS).toBe(4)

    expect(isValidPtyGrid(19, 32)).toBe(false)
    expect(isValidPtyGrid(20, 3)).toBe(false)
    expect(isValidPtyGrid(0, 0)).toBe(false)
    expect(isValidPtyGrid(Number.NaN, 32)).toBe(false)
    expect(isValidPtyGrid(20, 4)).toBe(true)
    expect(isValidPtyGrid(120, 32)).toBe(true)

    vi.useFakeTimers()
    const onEmit = vi.fn()
    const debouncer = createPtyResizeDebouncer({ onEmit })

    // Edge A1.e1: transient narrow initial mount is ignored; first valid mount emits immediately.
    expect(debouncer.report(12, 32)).toBe('ignored')
    expect(onEmit).not.toHaveBeenCalled()
    expect(debouncer.lastEmitted()).toBeNull()

    expect(debouncer.report(120, 32)).toBe('immediate')
    expect(onEmit).toHaveBeenCalledTimes(1)
    expect(onEmit).toHaveBeenLastCalledWith(120, 32)
    onEmit.mockClear()

    // Multi-step layout burst with transient <20 glitch coalesces into 1 trailing emit.
    expect(debouncer.report(108, 32)).toBe('debounced')
    vi.advanceTimersByTime(30)
    expect(debouncer.report(90, 32)).toBe('debounced')
    vi.advanceTimersByTime(20)
    expect(debouncer.report(14, 32)).toBe('ignored')
    vi.advanceTimersByTime(20)
    expect(debouncer.report(60, 32)).toBe('debounced')

    vi.advanceTimersByTime(PTY_RESIZE_DEBOUNCE_MS - 1)
    expect(onEmit).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(onEmit).toHaveBeenCalledTimes(1)
    expect(onEmit).toHaveBeenLastCalledWith(60, 32)
    onEmit.mockClear()

    // Edge A1.e1 (idempotence / flicker): returning to lastEmitted before timeout emits 0 calls.
    expect(debouncer.report(48, 32)).toBe('debounced')
    vi.advanceTimersByTime(40)
    expect(debouncer.report(60, 32)).toBe('unchanged')
    vi.advanceTimersByTime(PTY_RESIZE_DEBOUNCE_MS * 2)
    expect(onEmit).not.toHaveBeenCalled()

    // Cancel drops pending timer cleanly.
    expect(debouncer.report(88, 32)).toBe('debounced')
    debouncer.cancel()
    vi.advanceTimersByTime(PTY_RESIZE_DEBOUNCE_MS * 2)
    expect(onEmit).not.toHaveBeenCalled()
    debouncer.dispose()
  })

  test('TerminalView separates local fitAddon.fit() from debounced onResize IPC and cancels pending resize on hide', async () => {
    vi.useFakeTimers()
    const onResize = vi.fn()
    const host = document.body.appendChild(document.createElement('div'))
    host.className = 'workspace-host'
    try {
      const view = render(
        createElement(TerminalView, {
          paneId: 'pane-debounce',
          workspaceId: 'ws-debounce',
          isRunning: true,
          themeId: 'dracula',
          prefs: TERMINAL_PREFS_DEFAULTS,
          onInput: vi.fn(),
          onResize
        }),
        { container: host }
      )

      // Initial mount fit emits real dimensions immediately.
      await flushMicrotasks()
      act(() => { vi.advanceTimersByTime(20) })
      expect(onResize).toHaveBeenCalledTimes(1)
      expect(onResize).toHaveBeenLastCalledWith(120, 32)

      // Advance past mount settle timer so it does not interfere with reflow burst measurements.
      act(() => { vi.advanceTimersByTime(300) })
      onResize.mockClear()
      mockState.fitSpy.mockClear()

      // Simulate sidebar toggle + side panel + 1->2->3 split storm including a transient 12-col glitch.
      const sequence: Array<[number, number]> = [
        [108, 32],
        [92, 32],
        [12, 32],
        [70, 32],
        [58, 32]
      ]
      for (const [cols, rows] of sequence) {
        mockState.nextCols = cols
        mockState.nextRows = rows
        act(() => {
          mockState.resizeCallback?.()
          vi.advanceTimersByTime(20)
        })
      }

      // Local xterm fit ran on every layout tick, while PTY IPC waited for stabilization.
      expect(mockState.fitSpy.mock.calls.length).toBeGreaterThanOrEqual(5)
      expect(onResize).not.toHaveBeenCalled()

      act(() => { vi.advanceTimersByTime(PTY_RESIZE_DEBOUNCE_MS) })
      expect(onResize).toHaveBeenCalledTimes(1)
      expect(onResize).toHaveBeenCalledWith(58, 32)
      for (const [cols, rows] of onResize.mock.calls) {
        expect(cols).toBeGreaterThanOrEqual(MIN_VALID_PTY_COLS)
        expect(rows).toBeGreaterThanOrEqual(MIN_VALID_PTY_ROWS)
      }

      // Edge: hide before debounce fires cancels timer and re-syncs notified so reveal emits cleanly.
      onResize.mockClear()
      mockState.nextCols = 90
      mockState.nextRows = 32
      act(() => {
        mockState.resizeCallback?.()
        vi.advanceTimersByTime(20)
      })
      expect(onResize).not.toHaveBeenCalled()

      host.classList.add('workspace-host-hidden')
      await flushMicrotasks()
      act(() => { vi.advanceTimersByTime(PTY_RESIZE_DEBOUNCE_MS * 2) })
      expect(onResize).not.toHaveBeenCalled()

      host.classList.remove('workspace-host-hidden')
      await flushMicrotasks()
      act(() => { vi.advanceTimersByTime(50 + PTY_RESIZE_DEBOUNCE_MS) })
      expect(onResize).toHaveBeenCalledTimes(1)
      expect(onResize).toHaveBeenLastCalledWith(90, 32)

      view.unmount()
    } finally {
      host.remove()
    }
  })
})
