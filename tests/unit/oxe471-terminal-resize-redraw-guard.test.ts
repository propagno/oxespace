import { act, render } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  MAX_MIRROR_BUFFERED_BYTES,
  MAX_MIRROR_CHUNK_BYTES,
  PaneScreen
} from '../../electron/main/services/agent-state/screen'
import { PTY_RESIZE_DEBOUNCE_MS } from '../../src/components/Terminal/resizeDebounce'
import {
  createResizeRedrawGuard,
  RESIZE_REDRAW_ARM_MS,
  RESIZE_REDRAW_MAX_BYTES,
  RESIZE_REDRAW_MAX_HOLD_MS,
  RESIZE_REDRAW_SETTLE_MS,
  RESIZE_REDRAW_SYNC_SETTLE_MS
} from '../../src/components/Terminal/resizeRedrawGuard'
import {
  createTerminalWriteScheduler,
  MAX_BUFFERED_BYTES,
  MAX_BYTES_PER_FRAME
} from '../../src/components/Terminal/terminalWriteScheduler'
import { TerminalView } from '../../src/components/Terminal/TerminalView'
import { usePaneLayoutStore } from '../../src/store/pane-layout.store'
import { TERMINAL_PREFS_DEFAULTS } from '../../src/store/terminal-prefs.store'
import { useTerminalStore } from '../../src/store/terminal.store'
import type { WorkspacePane } from '../../shared/types/workspace'

const mockState = {
  nextCols: 120,
  nextRows: 32,
  activeTerminal: null as { cols: number; rows: number } | null,
  resizeCallback: null as (() => void) | null,
  onDataHandler: null as ((event: { paneId: string; data: string }) => void) | null,
  terminalInputHandler: null as ((data: string) => void) | null,
  writeSpy: vi.fn((_data: string, cb?: () => void) => cb?.()),
  scrollToBottomSpy: vi.fn()
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
      write: mockState.writeSpy,
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
      scrollToBottom: mockState.scrollToBottomSpy,
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
      onData: vi.fn((handler: (data: string) => void) => {
        mockState.terminalInputHandler = handler
        return { dispose: vi.fn() }
      })
    }
    mockState.activeTerminal = instance
    return instance
  })
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn().mockImplementation(function () {
    return {
      fit: vi.fn(() => {
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
vi.mock('../../src/components/Terminal/terminalPaths', () => ({
  attachTerminalPaths: () => ({ dispose: vi.fn() })
}))

function makePane(id: string, row = 0, col = 0): WorkspacePane {
  return {
    id,
    workspaceId: 'ws-471',
    type: 'terminal',
    rowIndex: row,
    columnIndex: col,
    shellProfileId: 'builtin-claude',
    status: 'idle',
    agentProfileId: null,
    agentName: null,
    displayName: null,
    createdAt: null,
    modelOverride: null,
    rootPath: null
  }
}

const flushMicrotasks = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('OXE-471 · resizeRedrawGuard unit behavior', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  test('never arms on initial mount or same-width resize, and passes normal non-clear output through at 0ms', () => {
    vi.useFakeTimers()
    const onFlush = vi.fn()
    const guard = createResizeRedrawGuard({ onFlush })

    // Initial mount records cols and stays idle (startup prompts are never intercepted).
    guard.notifyPtyResize(120, 32)
    expect(guard.state()).toBe('idle')
    expect(guard.ingest('\x1b[2J\x1b[3J\x1b[Hboot')).toBe(false)

    // Height-only resize keeps cols identical -> stays idle.
    guard.notifyPtyResize(120, 48)
    expect(guard.state()).toBe('idle')
    expect(guard.ingest('\x1b[2J\x1b[3J\x1b[Hheight-only')).toBe(false)

    // Column change arms guard, but ordinary shell text without clear/DEC-2026 passes straight through.
    guard.notifyPtyResize(60, 48)
    expect(guard.state()).toBe('armed')
    expect(guard.ingest('PS C:\\repo> ls\r\n')).toBe(false)
    expect(guard.ingest('file1.ts  file2.ts\r\n')).toBe(false)
    expect(onFlush).not.toHaveBeenCalled()

    // Arm window expires cleanly back to idle.
    vi.advanceTimersByTime(RESIZE_REDRAW_ARM_MS)
    expect(guard.state()).toBe('idle')
    expect(guard.ingest('\x1b[2J\x1b[3J\x1b[Hlate-clear')).toBe(false)

    guard.dispose()
  })

  test('coalesces a 500KB+ multi-chunk post-resize redraw off-screen and flushes once in a single DEC 2026 envelope', () => {
    vi.useFakeTimers()
    const flushed: Array<{ payload: string; rawBytes: number; truncated: boolean }> = []
    const guard = createResizeRedrawGuard({
      onFlush: (payload, meta) => flushed.push({ payload, ...meta })
    })

    guard.notifyPtyResize(120, 32)
    guard.notifyPtyResize(60, 32)
    expect(guard.state()).toBe('armed')

    // Chunk 1: clear + blank footer stub (inside DEC 2026 markers that must be stripped internally).
    expect(guard.ingest('\x1b[?2026h\x1b[2J\x1b[3J\x1b[H  ? for shortcuts\x1b[?2026l')).toBe(true)
    expect(guard.state()).toBe('holding')
    expect(flushed).toHaveLength(0)

    // Chunks 2..11: 550 KB of history replay streaming over 400ms.
    const historyChunk = 'OXE-288..OXE-469 '.repeat(3500) // ~59.5 KB each
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(40)
      expect(guard.ingest(`\x1b[?2026h${historyChunk}\r\n\x1b[?2026l`)).toBe(true)
    }
    vi.advanceTimersByTime(40)
    expect(guard.ingest('> Final prompt ready\r\n  ? for shortcuts')).toBe(true)
    expect(flushed).toHaveLength(0)

    // Still holding right before settle deadline.
    vi.advanceTimersByTime(RESIZE_REDRAW_SETTLE_MS - 1)
    expect(flushed).toHaveLength(0)

    // Settle fires -> single atomic DEC-2026 flush with full >550 KB intact.
    vi.advanceTimersByTime(1)
    expect(flushed).toHaveLength(1)
    expect(guard.state()).toBe('idle')
    expect(flushed[0].truncated).toBe(false)
    expect(flushed[0].rawBytes).toBeGreaterThan(550 * 1024)
    expect(flushed[0].payload.startsWith('\x1b[?2026h')).toBe(true)
    expect(flushed[0].payload.endsWith('\x1b[?2026l')).toBe(true)
    // No intermediate DEC-2026 open/close inside the envelope.
    const inner = flushed[0].payload.slice('\x1b[?2026h'.length, -'\x1b[?2026l'.length)
    expect(inner).not.toContain('\x1b[?2026h')
    expect(inner).not.toContain('\x1b[?2026l')
    expect(inner).toContain('> Final prompt ready')

    guard.dispose()
  })

  test('uses shorter sync settle window when a DEC 2026 block closes cleanly without a screen clear', () => {
    vi.useFakeTimers()
    const onFlush = vi.fn()
    const guard = createResizeRedrawGuard({ onFlush })

    guard.notifyPtyResize(120, 32)
    guard.notifyPtyResize(80, 32)
    expect(guard.ingest('\x1b[?2026h\x1b[1;1HClean TUI frame\x1b[?2026l')).toBe(true)

    vi.advanceTimersByTime(RESIZE_REDRAW_SYNC_SETTLE_MS - 1)
    expect(onFlush).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onFlush).toHaveBeenCalledTimes(1)
    expect(onFlush.mock.calls[0][0]).toBe('\x1b[?2026h\x1b[1;1HClean TUI frame\x1b[?2026l')

    guard.dispose()
  })

  test('discards dead pre-clear stub when a second \\x1b[3J arrives while holding, preserving everything after it', () => {
    vi.useFakeTimers()
    const flushed: string[] = []
    const guard = createResizeRedrawGuard({ onFlush: (payload) => flushed.push(payload) })

    guard.notifyPtyResize(120, 32)
    guard.notifyPtyResize(60, 32)

    expect(guard.ingest('\x1b[2J\x1b[3J\x1b[HDEAD-STUB ? for shortcuts')).toBe(true)
    vi.advanceTimersByTime(50)
    expect(guard.ingest('\x1b[2J\x1b[3J\x1b[HKEPT-HISTORY-LINE-1\r\nKEPT-PROMPT> ')).toBe(true)

    vi.advanceTimersByTime(RESIZE_REDRAW_SETTLE_MS)
    expect(flushed).toHaveLength(1)
    expect(flushed[0]).toBe('\x1b[?2026h\x1b[2J\x1b[3J\x1b[HKEPT-HISTORY-LINE-1\r\nKEPT-PROMPT> \x1b[?2026l')
    expect(flushed[0]).not.toContain('DEAD-STUB')

    guard.dispose()
  })

  test('flushes immediately on user keypress (preemptOnInput), enforces MAX_HOLD_MS & maxBytes, and cleans up on dispose', () => {
    vi.useFakeTimers()
    const flushed: Array<{ payload: string; truncated: boolean }> = []
    const guard = createResizeRedrawGuard({
      maxBytes: 64,
      onFlush: (payload, meta) => flushed.push({ payload, truncated: meta.truncated })
    })

    // 1. Keypress preemption flushes with 0ms wait.
    guard.notifyPtyResize(120, 32)
    guard.notifyPtyResize(60, 32)
    expect(guard.ingest('\x1b[2J\x1b[HPartial')).toBe(true)
    guard.preemptOnInput()
    expect(flushed).toHaveLength(1)
    expect(flushed[0].payload).toBe('\x1b[?2026h\x1b[2J\x1b[HPartial\x1b[?2026l')
    expect(guard.state()).toBe('idle')

    // 2. Continuous stream hits RESIZE_REDRAW_MAX_HOLD_MS and caps bytes safely.
    flushed.length = 0
    guard.notifyPtyResize(90, 32)
    expect(guard.ingest('\x1b[2J\x1b[H' + 'A'.repeat(40))).toBe(true)
    for (let elapsed = 0; elapsed < RESIZE_REDRAW_MAX_HOLD_MS; elapsed += 100) {
      vi.advanceTimersByTime(100)
      if (flushed.length > 0) break
      guard.ingest('\x1b[38;2;255;0;128m' + 'B'.repeat(40))
    }
    expect(flushed).toHaveLength(1)
    expect(flushed[0].truncated).toBe(true)
    expect(flushed[0].payload.startsWith('\x1b[?2026h')).toBe(true)
    expect(flushed[0].payload.endsWith('\x1b[?2026l')).toBe(true)
    expect(RESIZE_REDRAW_MAX_BYTES).toBe(4 * 1024 * 1024)

    // 3. dispose() cancels active timers and never flushes.
    flushed.length = 0
    guard.notifyPtyResize(110, 32)
    expect(guard.ingest('\x1b[2J\x1b[HNeverFlushed')).toBe(true)
    guard.dispose()
    vi.advanceTimersByTime(RESIZE_REDRAW_MAX_HOLD_MS * 2)
    expect(flushed).toHaveLength(0)
  })
})

describe('OXE-471 · TerminalView integration with resizeRedrawGuard and activeMaxBufferedBytes', () => {
  beforeEach(() => {
    mockState.nextCols = 120
    mockState.nextRows = 32
    mockState.activeTerminal = null
    mockState.resizeCallback = null
    mockState.onDataHandler = null
    mockState.terminalInputHandler = null
    mockState.writeSpy.mockReset().mockImplementation((_data: string, cb?: () => void) => cb?.())
    mockState.scrollToBottomSpy.mockClear()

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
        detach: vi.fn().mockResolvedValue({ seq: 1 }),
        status: vi.fn().mockResolvedValue({ running: true, seq: 1, altScreen: false }),
        onData: vi.fn((_paneId: string, cb: (event: { paneId: string; data: string }) => void) => {
          mockState.onDataHandler = cb
          return vi.fn()
        }),
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
    useTerminalStore.setState({ panes: {}, pendingCommands: {}, activePaneId: null })
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  test('absorbs an Antigravity resize redraw burst with ZERO intermediate blank writes and ONE atomic DEC-2026 write', async () => {
    vi.useFakeTimers()
    const onResize = vi.fn()
    const host = document.body.appendChild(document.createElement('div'))
    host.className = 'workspace-host'
    try {
      const view = render(
        createElement(TerminalView, {
          paneId: 'pane-agy-471',
          workspaceId: 'ws-471',
          isRunning: true,
          themeId: 'dracula',
          prefs: TERMINAL_PREFS_DEFAULTS,
          onInput: vi.fn(),
          onResize
        }),
        { container: host }
      )

      // Complete initial mount fit (120x32) and attach handshake.
      await flushMicrotasks()
      act(() => { vi.advanceTimersByTime(300) })
      expect(onResize).toHaveBeenCalledWith(120, 32)
      onResize.mockClear()
      mockState.writeSpy.mockClear()

      // Simulate pane split narrowing width 120 -> 60.
      mockState.nextCols = 60
      mockState.nextRows = 32
      act(() => {
        mockState.resizeCallback?.()
        vi.advanceTimersByTime(20)
      })
      expect(onResize).not.toHaveBeenCalled()
      act(() => { vi.advanceTimersByTime(PTY_RESIZE_DEBOUNCE_MS) })
      expect(onResize).toHaveBeenCalledTimes(1)
      expect(onResize).toHaveBeenCalledWith(60, 32)

      // Simulate agy.exe ConPTY resize response: clear + footer stub + 500 KB history + final prompt.
      const historyBlock = 'OXE-288..OXE-469 conversation turn line\r\n'.repeat(2500) // ~100 KB per chunk
      act(() => {
        mockState.onDataHandler?.({
          paneId: 'pane-agy-471',
          data: '\x1b[?2026h\x1b[2J\x1b[3J\x1b[H  ? for shortcuts\x1b[?2026l'
        })
      })
      expect(mockState.writeSpy).not.toHaveBeenCalled()

      for (let i = 0; i < 5; i++) {
        act(() => {
          vi.advanceTimersByTime(50)
          mockState.onDataHandler?.({
            paneId: 'pane-agy-471',
            data: `\x1b[?2026h${historyBlock}\x1b[?2026l`
          })
        })
        expect(mockState.writeSpy).not.toHaveBeenCalled()
      }

      act(() => {
        vi.advanceTimersByTime(30)
        mockState.onDataHandler?.({
          paneId: 'pane-agy-471',
          data: '❯ Ready after split\r\n  ? for shortcuts'
        })
      })
      // Still zero intermediate writes before settle.
      expect(mockState.writeSpy).not.toHaveBeenCalled()

      // Settle fires -> exactly ONE atomic DEC-2026 write containing the entire redraw.
      act(() => { vi.advanceTimersByTime(RESIZE_REDRAW_SETTLE_MS) })
      expect(mockState.writeSpy).toHaveBeenCalledTimes(1)
      const [payload] = mockState.writeSpy.mock.calls[0] as [string, (() => void) | undefined]
      expect(payload.startsWith('\x1b[?2026h')).toBe(true)
      expect(payload.endsWith('\x1b[?2026l')).toBe(true)
      expect(payload).toContain('❯ Ready after split')
      expect(payload.length).toBeGreaterThan(500 * 1024)
      expect(mockState.scrollToBottomSpy).toHaveBeenCalled()

      view.unmount()
    } finally {
      host.remove()
    }
  })

  test('terminalWriteScheduler allows larger activeMaxBufferedBytes while visible and enforces MAX_BUFFERED_BYTES when paused', () => {
    const writes: Array<{ chunk: string; truncated: boolean }> = []
    const frames: Array<() => void> = []
    const scheduler = createTerminalWriteScheduler({
      paused: false,
      maxBytesPerFrame: MAX_BYTES_PER_FRAME,
      maxBufferedBytes: MAX_BUFFERED_BYTES,
      activeMaxBufferedBytes: 2 * 1024 * 1024,
      write: (chunk, done, meta) => {
        writes.push({ chunk, truncated: meta.truncated })
        done()
      },
      scheduleFrame: (cb) => frames.push(cb),
      cancelFrame: vi.fn()
    })

    // Visible burst of 512 KB (> 256 KB hidden cap) does NOT truncate while visible.
    const chunk64k = 'V'.repeat(64 * 1024)
    for (let i = 0; i < 8; i++) scheduler.enqueue(chunk64k)
    expect(scheduler.wasTruncated()).toBe(false)
    expect(scheduler.pendingLength()).toBe(512 * 1024)

    // Switching to paused (hidden) immediately enforces MAX_BUFFERED_BYTES (256 KB).
    scheduler.setPaused(true)
    expect(scheduler.wasTruncated()).toBe(true)
    expect(scheduler.pendingLength()).toBeLessThanOrEqual(MAX_BUFFERED_BYTES)

    scheduler.dispose()
  })
})

describe('OXE-471 · PaneScreen main-process burst coalescing', () => {
  test('drops 500 KB of dead pre-clear history before feeding @xterm/headless and reads the final bottom screen accurately', async () => {
    const pane = new PaneScreen(80, 12)
    try {
      const headlessTerminal = (pane as unknown as {
        terminal: { write: (data: string, cb?: () => void) => void }
      }).terminal
      const writeSpy = vi.spyOn(headlessTerminal, 'write')

      // 1. Single huge >64 KB burst containing 500 KB of dead history before \x1b[2J\x1b[3J\x1b[H.
      const deadHistory = 'DEAD-HISTORY-OXE-288 '.repeat(25_000) // ~525 KB
      expect(deadHistory.length).toBeGreaterThan(MAX_MIRROR_CHUNK_BYTES)
      await pane.write(`${deadHistory}\x1b[2J\x1b[3J\x1b[HFinal Live Line\r\n  ? for shortcuts`)

      expect(writeSpy).toHaveBeenCalledTimes(1)
      const fedSingle = writeSpy.mock.calls[0][0]
      expect(fedSingle).not.toContain('DEAD-HISTORY-OXE-288')
      expect(fedSingle.length).toBeLessThan(1024)
      expect(pane.read().screen).toBe('Final Live Line\n  ? for shortcuts')

      // 2. Massive 500 KB post-clear history replay caps bytes fed to @xterm/headless near MAX_MIRROR_BUFFERED_BYTES.
      writeSpy.mockClear()
      const hugePostClear = `\x1b[2J\x1b[3J\x1b[H${'OLD-TURN-LINE\r\n'.repeat(35_000)}❯ Bottom Prompt\r\n  ? for shortcuts`
      expect(hugePostClear.length).toBeGreaterThan(500 * 1024)
      await pane.write(hugePostClear)

      expect(writeSpy).toHaveBeenCalledTimes(1)
      const fedCapped = writeSpy.mock.calls[0][0]
      expect(fedCapped.length).toBeLessThanOrEqual(MAX_MIRROR_BUFFERED_BYTES + 32)
      const snap = pane.read()
      expect(snap.screen).toContain('❯ Bottom Prompt')
      expect(snap.screen).toContain('? for shortcuts')

      // 3. Coalescing while busy: multiple queued chunks with a late clear collapse into one bounded drain.
      writeSpy.mockClear()
      const p1 = pane.write('first-small-chunk\r\n')
      expect(pane.busy).toBe(true)
      const p2 = pane.write('QUEUED-DEAD-CHUNK '.repeat(5_000))
      const p3 = pane.write('\x1b[2J\x1b[3J\x1b[HCoalesced Final\r\n  ? for shortcuts')
      await Promise.all([p1, p2, p3])

      expect(pane.busy).toBe(false)
      const coalescedPayloads = writeSpy.mock.calls.slice(1).map((c) => c[0])
      expect(coalescedPayloads.join('')).not.toContain('QUEUED-DEAD-CHUNK')
      expect(pane.read().screen).toBe('Coalesced Final\n  ? for shortcuts')
    } finally {
      pane.dispose()
    }
  })
})

describe('OXE-471 · pane-layout.store reserveSplit eliminates double-resize on split', () => {
  beforeEach(() => {
    usePaneLayoutStore.setState({ trees: {} })
  })

  test('sync() places a newly created pane directly in the reserved direction and subsequent split() is an idempotent no-op', () => {
    const store = usePaneLayoutStore.getState()
    store.sync('ws-471', [makePane('p1')])

    // Wide 1600x800 viewport would normally auto-pick 'horizontal', but we reserve 'vertical' (split down).
    store.reserveSplit('ws-471', 'p1', 'vertical')
    store.sync('ws-471', [makePane('p1'), makePane('p2')], { width: 1600, height: 800 })

    const afterSync = usePaneLayoutStore.getState().trees['ws-471']
    expect(afterSync).toEqual({
      kind: 'split',
      direction: 'vertical',
      sizes: [50, 50],
      children: [{ kind: 'leaf', paneId: 'p1' }, { kind: 'leaf', paneId: 'p2' }]
    })

    // Follow-up split() from createPane().then(...) must be an exact no-op (zero state update / zero 2nd resize).
    const subscriber = vi.fn()
    const unsubscribe = usePaneLayoutStore.subscribe(subscriber)
    try {
      store.split('ws-471', 'p1', 'p2', 'vertical')
      expect(usePaneLayoutStore.getState().trees['ws-471']).toBe(afterSync)
      expect(subscriber).not.toHaveBeenCalled()
    } finally {
      unsubscribe()
    }
  })

  test('supports horizontal reservation on a tall viewport, chained 1x1 -> 1x2 -> 1x3 splits, and cancelReservedSplit', () => {
    const store = usePaneLayoutStore.getState()
    store.sync('ws-471', [makePane('p1')])

    // Tall 600x1200 viewport would normally auto-pick 'vertical', but we reserve 'horizontal' (split right).
    store.reserveSplit('ws-471', 'p1', 'horizontal')
    store.sync('ws-471', [makePane('p1'), makePane('p2')], { width: 600, height: 1200 })
    const tree1x2 = usePaneLayoutStore.getState().trees['ws-471']
    expect(tree1x2).toEqual({
      kind: 'split',
      direction: 'horizontal',
      sizes: [50, 50],
      children: [{ kind: 'leaf', paneId: 'p1' }, { kind: 'leaf', paneId: 'p2' }]
    })
    store.split('ws-471', 'p1', 'p2', 'horizontal')
    expect(usePaneLayoutStore.getState().trees['ws-471']).toBe(tree1x2)

    // Chain 1x2 -> 1x3 splitting p2 horizontally -> flattened [50, 25, 25] directly on sync().
    store.reserveSplit('ws-471', 'p2', 'horizontal')
    store.sync('ws-471', [makePane('p1'), makePane('p2'), makePane('p3')], { width: 600, height: 1200 })
    const tree1x3 = usePaneLayoutStore.getState().trees['ws-471']
    expect(tree1x3).toEqual({
      kind: 'split',
      direction: 'horizontal',
      sizes: [50, 25, 25],
      children: [{ kind: 'leaf', paneId: 'p1' }, { kind: 'leaf', paneId: 'p2' }, { kind: 'leaf', paneId: 'p3' }]
    })
    store.split('ws-471', 'p2', 'p3', 'horizontal')
    expect(usePaneLayoutStore.getState().trees['ws-471']).toBe(tree1x3)

    // Failed createPane cancels reservation so future unrelated sync falls back to normal heuristic.
    store.reserveSplit('ws-471', 'p1', 'vertical')
    store.cancelReservedSplit('ws-471', 'p1', 'vertical')
    store.sync('ws-471', [makePane('p1'), makePane('p2'), makePane('p3'), makePane('p4')], { width: 1600, height: 800 })
    // Largest pane is p1 (50% of 1600 = 800px wide vs 800px tall -> horizontal fallback).
    expect(usePaneLayoutStore.getState().trees['ws-471']).toMatchObject({
      kind: 'split',
      direction: 'horizontal'
    })
  })
})
