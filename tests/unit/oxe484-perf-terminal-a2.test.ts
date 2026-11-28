import { act, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'
import type { IDisposable, IPty } from 'node-pty'
import { SearchAddon } from '@xterm/addon-search'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { openInMemoryDatabase } from '../../electron/main/db/index'
import { WorkspaceService } from '../../electron/main/services/workspace.service'
import { TerminalManager } from '../../electron/main/services/terminal.service'
import {
  CONPTY_DATA_FLUSH_TIMEOUT_MS,
  CONPTY_KILL_SPAWN_THROTTLE_MS,
  ConptyKillSpawnThrottle,
  createDataFlushGuard,
  drainWithTimeout,
  windowsConptyForkOptions
} from '../../electron/main/workers/conptyProtections'
import { createPtyHostRuntime } from '../../electron/main/workers/pty-host'
import type { PtyHostEvent } from '../../electron/main/services/terminal/pty-host-protocol'
import { UI_SCALE_EVENT } from '../../shared/uiScale'
import {
  COLS_REFLOW_DEBOUNCE_MS,
  COLS_REFLOW_MIN_BUFFER_LINES,
  createTerminalReflowDebouncer
} from '../../src/components/Terminal/terminalReflowDebouncer'
import {
  createLazySearchAddon,
  SEARCH_HIGHLIGHT_LIMIT
} from '../../src/components/Terminal/terminalSearchAddon'
import {
  createTerminalLinkCache,
  LINK_CACHE_MAX_ENTRIES,
  LINK_CACHE_TTL_MS
} from '../../src/components/Terminal/terminalLinkCache'
import {
  createAdaptiveSmoothScrollController,
  safeClearTextureAtlas,
  SMOOTH_SCROLL_DURATION_MS,
  SMOOTH_SCROLL_FLOOD_BYTES,
  SMOOTH_SCROLL_RECOVER_IDLE_MS
} from '../../src/components/Terminal/terminalSmoothScroll'
import { findPathsInLine, registerTerminalPathLinks } from '../../src/components/Terminal/terminalPathLinks'
import { TerminalView } from '../../src/components/Terminal/TerminalView'
import { parseProjectPath, stripMarkdownPathWrappers } from '../../src/lib/projectPath'
import { TERMINAL_PREFS_DEFAULTS } from '../../src/store/terminal-prefs.store'

const mockState = {
  nextCols: 120,
  nextRows: 32,
  bufferLines: 0,
  activeTerminal: null as {
    cols: number
    rows: number
    options: Record<string, unknown>
    resize: ReturnType<typeof vi.fn>
    clearTextureAtlas: ReturnType<typeof vi.fn>
    loadAddon: ReturnType<typeof vi.fn>
  } | null,
  fitSpy: vi.fn(),
  resizeCallback: null as (() => void) | null,
  keyHandler: null as ((event: KeyboardEvent) => boolean) | null,
  searchFindNext: vi.fn(),
  searchClearDecorations: vi.fn()
}

vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn().mockImplementation(function () {
    const instance = {
      cols: 80,
      rows: 24,
      options: {} as Record<string, unknown>,
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
      clearTextureAtlas: vi.fn(),
      resize: vi.fn((cols: number, rows: number) => {
        instance.cols = cols
        instance.rows = rows
      }),
      scrollLines: vi.fn(),
      unicode: { activeVersion: '6' },
      scrollToBottom: vi.fn(),
      scrollToLine: vi.fn(),
      attachCustomKeyEventHandler: vi.fn((fn: (event: KeyboardEvent) => boolean) => {
        mockState.keyHandler = fn
      }),
      attachCustomWheelEventHandler: vi.fn(),
      parser: { registerOscHandler: vi.fn(() => ({ dispose: vi.fn() })) },
      getSelection: vi.fn(() => ''),
      clearSelection: vi.fn(),
      onSelectionChange: vi.fn(() => ({ dispose: vi.fn() })),
      buffer: {
        get normal() {
          return {
            type: 'normal',
            baseY: Math.max(0, mockState.bufferLines - instance.rows),
            viewportY: Math.max(0, mockState.bufferLines - instance.rows),
            cursorY: 0,
            length: mockState.bufferLines,
            getLine: vi.fn(() => null)
          }
        },
        get active() {
          return {
            type: 'normal',
            baseY: Math.max(0, mockState.bufferLines - instance.rows),
            viewportY: Math.max(0, mockState.bufferLines - instance.rows),
            cursorY: 0,
            length: mockState.bufferLines,
            getLine: vi.fn(() => null)
          }
        }
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
      findNext: mockState.searchFindNext,
      findPrevious: vi.fn(),
      clearDecorations: mockState.searchClearDecorations,
      onDidChangeResults: vi.fn(() => ({ dispose: vi.fn() })),
      dispose: vi.fn()
    }
  })
}))
vi.mock('../../src/components/Terminal/terminalPaths', () => ({
  attachTerminalPaths: () => ({ dispose: vi.fn() })
}))

function createFakeNodePty(pid = 2001): {
  pty: IPty
  kill: ReturnType<typeof vi.fn>
  emitData: (data: string) => void
  emitExit: (exitCode: number) => void
} {
  const dataListeners = new Set<(data: string) => void>()
  const exitListeners = new Set<(e: { exitCode: number; signal?: number }) => void>()
  const kill = vi.fn()
  const pty: IPty = {
    pid,
    cols: 80,
    rows: 24,
    process: 'pwsh',
    handleFlowControl: false,
    onData(listener): IDisposable {
      dataListeners.add(listener)
      return { dispose: () => { dataListeners.delete(listener) } }
    },
    onExit(listener): IDisposable {
      exitListeners.add(listener)
      return { dispose: () => { exitListeners.delete(listener) } }
    },
    write: vi.fn(),
    resize: vi.fn(),
    clear: vi.fn(),
    kill,
    pause: vi.fn(),
    resume: vi.fn()
  }
  return {
    pty,
    kill,
    emitData: (data) => { for (const l of dataListeners) l(data) },
    emitExit: (exitCode) => { for (const l of exitListeners) l({ exitCode }) }
  }
}

describe('OXE-484 · 1. Asymmetric cols reflow debounce (100ms)', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  test('applies rows-only immediately, debounces cols by 100ms on large buffers, and applies immediately on small buffers', () => {
    vi.useFakeTimers()
    let bufferLines = 500
    let size = { cols: 120, rows: 32 }
    const applyRows = vi.fn((rows: number) => { size = { ...size, rows } })
    const applyColsAndRows = vi.fn((cols: number, rows: number) => { size = { cols, rows } })

    const debouncer = createTerminalReflowDebouncer({
      getBufferLength: () => bufferLines,
      getCurrentSize: () => size,
      applyRows,
      applyColsAndRows
    })

    expect(COLS_REFLOW_DEBOUNCE_MS).toBe(100)
    expect(COLS_REFLOW_MIN_BUFFER_LINES).toBe(200)

    // Vertical-only resize on large buffer -> immediate O(1) rows resize, 0 reflows.
    expect(debouncer.resize(120, 44)).toBe('immediate-rows')
    expect(applyRows).toHaveBeenCalledWith(44, { deferPty: false })
    expect(applyColsAndRows).not.toHaveBeenCalled()
    expect(debouncer.hasPending()).toBe(false)

    // Continuous horizontal drag on large buffer -> debounced by 100ms, final size exact.
    applyRows.mockClear()
    expect(debouncer.resize(108, 44)).toBe('debounced-cols')
    vi.advanceTimersByTime(30)
    expect(debouncer.resize(96, 48)).toBe('debounced-cols')
    // Simultaneous rows delta applied immediately during horizontal drag (PTY deferred until cols settle).
    expect(applyRows).toHaveBeenCalledWith(48, { deferPty: true })
    vi.advanceTimersByTime(30)
    expect(debouncer.resize(84, 48)).toBe('debounced-cols')
    expect(applyColsAndRows).not.toHaveBeenCalled()

    vi.advanceTimersByTime(COLS_REFLOW_DEBOUNCE_MS - 1)
    expect(applyColsAndRows).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(applyColsAndRows).toHaveBeenCalledTimes(1)
    expect(applyColsAndRows).toHaveBeenCalledWith(84, 48, true)

    // Small buffer (< 200 lines) -> immediate full fit with 0ms delay.
    applyColsAndRows.mockClear()
    bufferLines = 40
    expect(debouncer.resize(100, 48)).toBe('immediate-full')
    expect(applyColsAndRows).toHaveBeenCalledWith(100, 48, false)
    debouncer.dispose()
  })

  test('TerminalView runs rows-only immediately and debounces cols fit during drag when buffer >= 200 lines', async () => {
    vi.useFakeTimers()
    mockState.nextCols = 120
    mockState.nextRows = 32
    mockState.bufferLines = 500
    mockState.fitSpy.mockClear()
    mockState.resizeCallback = null

    global.ResizeObserver = class {
      constructor(private readonly callback: ResizeObserverCallback) {
        mockState.resizeCallback = () => this.callback([], this as unknown as ResizeObserver)
      }
      observe(): void {}
      disconnect(): void {}
      unobserve(): void {}
      takeRecords(): ResizeObserverEntry[] { return [] }
    }
    window.oxe = {
      app: { version: '1.6.3', platform: 'win32' },
      workspace: {} as typeof window.oxe.workspace,
      terminal: {
        start: vi.fn(), write: vi.fn(), resize: vi.fn(), stop: vi.fn(), restart: vi.fn(),
        attach: vi.fn().mockResolvedValue({ running: true, seq: 1, prologue: '', replay: '', truncated: false, altScreen: false }),
        detach: vi.fn().mockResolvedValue(undefined),
        status: vi.fn().mockResolvedValue({ running: true, seq: 1, altScreen: false }),
        onData: vi.fn(() => vi.fn()), onExit: vi.fn(() => vi.fn()), onActivity: vi.fn(() => vi.fn())
      },
      clipboard: { saveImageToTemp: vi.fn().mockResolvedValue(null), readText: vi.fn().mockResolvedValue(''), writeText: vi.fn().mockResolvedValue(true) }
    } as unknown as typeof window.oxe

    const onResize = vi.fn()
    const view = render(
      createElement(TerminalView, {
        paneId: 'pane-reflow',
        workspaceId: 'ws-reflow',
        isRunning: true,
        themeId: 'dracula',
        prefs: TERMINAL_PREFS_DEFAULTS,
        onInput: vi.fn(),
        onResize
      })
    )

    // Initial mount fit applies immediately.
    act(() => { vi.advanceTimersByTime(300) })
    expect(onResize).toHaveBeenCalledWith(120, 32)
    onResize.mockClear()
    mockState.fitSpy.mockClear()
    mockState.activeTerminal!.resize.mockClear()

    // Vertical-only resize -> immediate terminal.resize(120, 42) + immediate onResize(120, 42), 0 fitAddon.fit() reflows.
    mockState.nextCols = 120
    mockState.nextRows = 42
    act(() => {
      mockState.resizeCallback?.()
      vi.advanceTimersByTime(20)
    })
    expect(mockState.activeTerminal!.resize).toHaveBeenCalledWith(120, 42)
    expect(mockState.fitSpy).not.toHaveBeenCalled()
    expect(onResize).toHaveBeenCalledTimes(1)
    expect(onResize).toHaveBeenLastCalledWith(120, 42)

    // Horizontal drag burst -> 0 fitAddon.fit() calls during drag, 1 fit at drag end (+100ms).
    onResize.mockClear()
    for (const cols of [110, 98, 86, 72]) {
      mockState.nextCols = cols
      act(() => {
        mockState.resizeCallback?.()
        vi.advanceTimersByTime(20)
      })
    }
    expect(mockState.fitSpy).not.toHaveBeenCalled()
    expect(onResize).not.toHaveBeenCalled()

    act(() => { vi.advanceTimersByTime(COLS_REFLOW_DEBOUNCE_MS) })
    expect(mockState.fitSpy).toHaveBeenCalledTimes(1)
    expect(onResize).toHaveBeenCalledTimes(1)
    expect(onResize).toHaveBeenLastCalledWith(72, 42)
    view.unmount()
  })
})

describe('OXE-484 · 2. Lazy SearchAddon with highlightLimit: 1000', () => {
  beforeEach(() => {
    vi.mocked(SearchAddon).mockClear()
    mockState.searchFindNext.mockClear()
    mockState.searchClearDecorations.mockClear()
    mockState.keyHandler = null
    mockState.bufferLines = 0
    global.ResizeObserver = class {
      observe(): void {}
      disconnect(): void {}
      unobserve(): void {}
      takeRecords(): ResizeObserverEntry[] { return [] }
    }
    window.oxe = {
      app: { version: '1.6.3', platform: 'win32' },
      workspace: {} as typeof window.oxe.workspace,
      terminal: {
        start: vi.fn(), write: vi.fn(), resize: vi.fn(), stop: vi.fn(), restart: vi.fn(),
        attach: vi.fn().mockResolvedValue({ running: false, seq: 0, prologue: '', replay: '', truncated: false, altScreen: false }),
        detach: vi.fn().mockResolvedValue(undefined),
        status: vi.fn().mockResolvedValue({ running: false, seq: 0, altScreen: false }),
        onData: vi.fn(() => vi.fn()), onExit: vi.fn(() => vi.fn()), onActivity: vi.fn(() => vi.fn())
      },
      clipboard: { saveImageToTemp: vi.fn().mockResolvedValue(null), readText: vi.fn().mockResolvedValue(''), writeText: vi.fn().mockResolvedValue(true) }
    } as unknown as typeof window.oxe
  })

  test('createLazySearchAddon defers instantiation until ensure(), passes highlightLimit: 1000, and disposes cleanly', () => {
    const loadAddon = vi.fn()
    const resultsDispose = vi.fn()
    const createAddon = vi.fn((_opts) => ({
      onDidChangeResults: vi.fn(() => ({ dispose: resultsDispose })),
      findNext: vi.fn(),
      findPrevious: vi.fn(),
      clearDecorations: vi.fn(),
      dispose: vi.fn()
    }) as unknown as SearchAddon)

    const ctrl = createLazySearchAddon({
      terminal: { loadAddon },
      onResults: vi.fn(),
      createAddon
    })

    expect(SEARCH_HIGHLIGHT_LIMIT).toBe(1000)
    expect(ctrl.isLoaded()).toBe(false)
    expect(ctrl.current()).toBeNull()
    expect(createAddon).not.toHaveBeenCalled()
    expect(loadAddon).not.toHaveBeenCalled()

    const first = ctrl.ensure()
    expect(createAddon).toHaveBeenCalledTimes(1)
    expect(createAddon).toHaveBeenCalledWith({ highlightLimit: 1000 })
    expect(loadAddon).toHaveBeenCalledTimes(1)
    expect(ctrl.isLoaded()).toBe(true)
    expect(ctrl.ensure()).toBe(first)
    expect(createAddon).toHaveBeenCalledTimes(1)

    ctrl.dispose()
    expect(resultsDispose).toHaveBeenCalledTimes(1)
    expect(ctrl.current()).toBeNull()
    expect(ctrl.ensure()).toBeNull()
  })

  test('TerminalView does NOT instantiate SearchAddon on mount; loads it with highlightLimit: 1000 on Ctrl+F', () => {
    const view = render(
      createElement(TerminalView, {
        paneId: 'pane-lazy-search',
        isRunning: true,
        themeId: 'dracula',
        prefs: TERMINAL_PREFS_DEFAULTS,
        onInput: vi.fn(),
        onResize: vi.fn()
      })
    )

    expect(SearchAddon).not.toHaveBeenCalled()

    // Trigger Ctrl+F -> SearchAddon instantiated once with { highlightLimit: 1000 }.
    act(() => {
      mockState.keyHandler?.(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, cancelable: true }))
    })
    expect(SearchAddon).toHaveBeenCalledTimes(1)
    expect(SearchAddon).toHaveBeenCalledWith({ highlightLimit: 1000 })

    const input = screen.getByLabelText('Search terminal')
    fireEvent.change(input, { target: { value: 'token' } })
    expect(mockState.searchFindNext).toHaveBeenCalledWith('token', expect.objectContaining({ incremental: true }))
    expect(SearchAddon).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(input, { key: 'Escape' })
    expect(mockState.searchClearDecorations).toHaveBeenCalledTimes(1)
    view.unmount()
  })
})

describe('OXE-484 · 3. 10s Link Provider TTL Cache & projectPath **~/ Markdown fix', () => {
  const ROOT = '/home/a/project'

  test('strips Markdown wrappers and prevents malformed **~/ paths in parseProjectPath and findPathsInLine', () => {
    expect(stripMarkdownPathWrappers('**~/foo/bar.ts**')).toBe('~/foo/bar.ts')
    expect(stripMarkdownPathWrappers('**src/app.ts:42**')).toBe('src/app.ts:42')
    expect(stripMarkdownPathWrappers('**`./file.ts`**')).toBe('./file.ts')

    expect(parseProjectPath('**~/foo/bar.ts**', ROOT)).toBeNull()
    expect(parseProjectPath('**~/project/file.ts**', ROOT)).toBeNull()
    expect(parseProjectPath('**./file.ts**', ROOT)).toEqual({ relativePath: 'file.ts' })
    expect(parseProjectPath('**src/app.ts:42**', ROOT)).toEqual({ relativePath: 'src/app.ts', line: 42 })
    expect(parseProjectPath('src/app.ts:42', ROOT)).toEqual({ relativePath: 'src/app.ts', line: 42 })

    const line = 'Updated **src/app.ts:42** and ignored **~/foo/bar.ts** plus **./file.ts**.'
    const found = findPathsInLine(line, ROOT)
    expect(found).toEqual([
      {
        start: line.indexOf('src/app.ts:42'),
        end: line.indexOf('src/app.ts:42') + 'src/app.ts:42'.length,
        text: 'src/app.ts:42',
        path: { relativePath: 'src/app.ts', line: 42 }
      },
      {
        start: line.indexOf('./file.ts'),
        end: line.indexOf('./file.ts') + './file.ts'.length,
        text: './file.ts',
        path: { relativePath: 'file.ts' }
      }
    ])
  })

  test('createTerminalLinkCache enforces 10s TTL and bounded 500-entry LRU eviction', () => {
    expect(LINK_CACHE_TTL_MS).toBe(10_000)
    expect(LINK_CACHE_MAX_ENTRIES).toBe(500)

    let clock = 1_000
    const cache = createTerminalLinkCache<boolean>({ maxEntries: 3, ttlMs: 10_000, now: () => clock })
    cache.set('a', true)
    cache.set('b', false)
    cache.set('c', true)
    // Touch 'a' so 'b' becomes LRU.
    expect(cache.get('a')).toBe(true)
    cache.set('d', true)
    expect(cache.size()).toBe(3)
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('a')).toBe(true)

    // Advance past 10s TTL -> expired entries return undefined.
    clock += 10_000
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('c')).toBeUndefined()
    expect(cache.get('d')).toBeUndefined()
    expect(cache.size()).toBe(0)
  })

  test('registerTerminalPathLinks caches existence checks for 10s and invalidates after TTL', async () => {
    let clock = 10_000
    let provided: ((lineNumber: number, cb: (links: unknown[] | undefined) => void) => void) | null = null
    const fakeTerm = {
      buffer: {
        active: {
          getLine: () => ({ translateToString: () => 'See **src/app.ts:42** and src/missing.ts' })
        }
      },
      registerLinkProvider: vi.fn((provider: { provideLinks: typeof provided }) => {
        provided = provider.provideLinks
        return { dispose: vi.fn() }
      })
    }

    let missingExists = false
    const exists = vi.fn(async (_scope, path) => path.relativePath === 'src/app.ts' || (path.relativePath === 'src/missing.ts' && missingExists))

    const disposable = registerTerminalPathLinks(fakeTerm as never, {
      scope: () => ({ workspaceId: 'ws-1', rootPath: ROOT }),
      openInOxespace: vi.fn(),
      openExternal: vi.fn(),
      hovered: vi.fn(),
      hint: () => 'Ctrl+click',
      exists,
      now: () => clock
    })

    const queryLine = (): Promise<unknown[] | undefined> =>
      new Promise((resolve) => provided!(1, (links) => resolve(links)))

    // First hover probes both paths once.
    const first = await queryLine()
    expect(first).toHaveLength(1)
    expect(exists).toHaveBeenCalledTimes(2)

    // Repeated hovers within 10s hit cache synchronously (0 extra probes).
    clock += 5_000
    let syncLinks: unknown[] | undefined
    provided!(1, (links) => { syncLinks = links })
    expect(syncLinks).toHaveLength(1)
    expect(exists).toHaveBeenCalledTimes(2)

    // After 10s TTL expires and file appears on disk -> re-probes and sees both links.
    missingExists = true
    clock += 5_000
    const afterExpiry = await queryLine()
    expect(afterExpiry).toHaveLength(2)
    expect(exists).toHaveBeenCalledTimes(4)
    disposable.dispose()
  })
})

describe('OXE-484 · 4. ConPTY Protections & Adaptive smoothScrollDuration / clearTextureAtlas', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  test('windowsConptyForkOptions enables useConptyDll + conptyInheritCursor on win32 only, and TerminalManager passes them', async () => {
    expect(windowsConptyForkOptions('win32')).toEqual({ useConptyDll: true, conptyInheritCursor: true })
    expect(windowsConptyForkOptions('linux')).toEqual({})
    expect(windowsConptyForkOptions('darwin')).toEqual({})

    const db = openInMemoryDatabase()
    const workspace = new WorkspaceService(db).create({ rootPath: 'C:/repo', layout: '1x1', autoStart: false })
    const fake = createFakeNodePty(3001)
    const spawn = vi.fn(() => fake.pty)
    const manager = new TerminalManager(db, { pty: { spawn }, platform: 'win32' })
    try {
      await manager.start({ workspaceId: workspace.id, paneId: workspace.panes[0].id, agentCommand: 'codex' })
      expect(spawn.mock.calls[0][2]).toMatchObject({ useConptyDll: true, conptyInheritCursor: true })
    } finally {
      manager.stopAll()
      db.close()
    }
  })

  test('ConptyKillSpawnThrottle and pty-host throttle rapid kill+spawn by 250ms on win32 only', () => {
    vi.useFakeTimers()
    expect(CONPTY_KILL_SPAWN_THROTTLE_MS).toBe(250)

    // Direct throttle check: non-win32 never throttles.
    const linuxThrottle = new ConptyKillSpawnThrottle({ platform: 'linux' })
    linuxThrottle.recordKill()
    expect(linuxThrottle.remainingDelayMs()).toBe(0)
    linuxThrottle.dispose()

    // pty-host on win32: initial spawn is immediate; spawn right after kill waits 250ms.
    const events: PtyHostEvent[] = []
    const spawned: number[] = []
    const runtime = createPtyHostRuntime(
      (ev) => events.push(ev),
      () => {
        const fake = createFakeNodePty(4000 + spawned.length)
        spawned.push(fake.pty.pid)
        return fake.pty
      },
      { platform: 'win32' }
    )

    runtime.handle({ t: 'spawn', id: 1, file: 'pwsh', args: [], options: { cols: 80, rows: 24 } })
    expect(spawned).toHaveLength(1)

    runtime.handle({ t: 'kill', id: 1 })
    runtime.handle({ t: 'spawn', id: 2, file: 'pwsh', args: [], options: { cols: 80, rows: 24 } })
    expect(spawned).toHaveLength(1) // throttled during 250ms ConPTY cooldown

    vi.advanceTimersByTime(CONPTY_KILL_SPAWN_THROTTLE_MS - 1)
    expect(spawned).toHaveLength(1)

    vi.advanceTimersByTime(1)
    expect(spawned).toHaveLength(2)
    expect(events.some(ev => ev.t === 'spawned' && ev.id === 2)).toBe(true)
    runtime.dispose()
  })

  test('DataFlushGuard and drainWithTimeout bound exit drain to 250ms without hanging or dropping trailing output', async () => {
    vi.useFakeTimers()
    expect(CONPTY_DATA_FLUSH_TIMEOUT_MS).toBe(250)

    const flushes = vi.fn()
    const completed = vi.fn()
    const guard = createDataFlushGuard({ flush: flushes, quietMs: 50, timeoutMs: CONPTY_DATA_FLUSH_TIMEOUT_MS })

    guard.beginExit(completed)
    expect(flushes).toHaveBeenCalledTimes(1)
    expect(completed).not.toHaveBeenCalled()

    // Continuous trailing output keeps resetting quiet timer, but hard 250ms ceiling still completes exit!
    for (let t = 0; t < 240; t += 40) {
      vi.advanceTimersByTime(40)
      guard.notifyData()
    }
    expect(completed).not.toHaveBeenCalled()
    vi.advanceTimersByTime(10)
    expect(completed).toHaveBeenCalledTimes(1)
    guard.dispose()

    // drainWithTimeout bounds hung promises to 250ms.
    const never = new Promise<void>(() => undefined)
    const raced = drainWithTimeout(never, CONPTY_DATA_FLUSH_TIMEOUT_MS)
    vi.advanceTimersByTime(CONPTY_DATA_FLUSH_TIMEOUT_MS)
    await expect(raced).resolves.toBe('timed-out')
  })

  test('adaptive smoothScrollDuration toggles on WebGL fallback, flood throughput, and trackpad gestures; clearTextureAtlas fires on font/theme/DPI', () => {
    vi.useFakeTimers()
    const termOptions: Record<string, unknown> = {}
    const ctrl = createAdaptiveSmoothScrollController({
      terminal: { options: termOptions },
      webglActive: false
    })

    // DOM fallback -> 0ms.
    expect(termOptions.smoothScrollDuration).toBe(0)
    expect(ctrl.currentDuration()).toBe(0)

    // WebGL active -> 125ms.
    ctrl.setWebglActive(true)
    expect(termOptions.smoothScrollDuration).toBe(SMOOTH_SCROLL_DURATION_MS)
    expect(ctrl.currentDuration()).toBe(125)

    // High throughput flood -> disables to 0ms, then recovers after calm window.
    ctrl.recordThroughput(SMOOTH_SCROLL_FLOOD_BYTES)
    expect(ctrl.isFlooding()).toBe(true)
    expect(termOptions.smoothScrollDuration).toBe(0)

    vi.advanceTimersByTime(SMOOTH_SCROLL_RECOVER_IDLE_MS)
    expect(ctrl.isFlooding()).toBe(false)
    expect(termOptions.smoothScrollDuration).toBe(125)

    // Precision trackpad gesture disables smooth scroll; discrete mouse wheel restores it.
    ctrl.onWheel({ deltaMode: 0, deltaY: 8 })
    expect(termOptions.smoothScrollDuration).toBe(0)
    ctrl.onWheel({ deltaMode: 1, deltaY: 3 })
    expect(termOptions.smoothScrollDuration).toBe(125)

    // WebGL context loss fallback -> 0ms.
    ctrl.setWebglActive(false)
    expect(termOptions.smoothScrollDuration).toBe(0)
    ctrl.dispose()

    // safeClearTextureAtlas handles real method and missing/throwing mocks safely.
    const clearSpy = vi.fn()
    expect(safeClearTextureAtlas({ clearTextureAtlas: clearSpy })).toBe(true)
    expect(clearSpy).toHaveBeenCalledTimes(1)
    expect(safeClearTextureAtlas({})).toBe(false)

    // TerminalView invokes clearTextureAtlas on UI_SCALE_EVENT and font/theme updates.
    global.ResizeObserver = class {
      observe(): void {}
      disconnect(): void {}
      unobserve(): void {}
      takeRecords(): ResizeObserverEntry[] { return [] }
    }
    window.oxe = {
      app: { version: '1.6.3', platform: 'win32' },
      workspace: {} as typeof window.oxe.workspace,
      terminal: {
        start: vi.fn(), write: vi.fn(), resize: vi.fn(), stop: vi.fn(), restart: vi.fn(),
        attach: vi.fn().mockResolvedValue({ running: false, seq: 0, prologue: '', replay: '', truncated: false, altScreen: false }),
        detach: vi.fn().mockResolvedValue(undefined),
        status: vi.fn().mockResolvedValue({ running: false, seq: 0, altScreen: false }),
        onData: vi.fn(() => vi.fn()), onExit: vi.fn(() => vi.fn()), onActivity: vi.fn(() => vi.fn())
      },
      clipboard: { saveImageToTemp: vi.fn().mockResolvedValue(null), readText: vi.fn().mockResolvedValue(''), writeText: vi.fn().mockResolvedValue(true) }
    } as unknown as typeof window.oxe

    const view = render(
      createElement(TerminalView, {
        paneId: 'pane-atlas',
        isRunning: true,
        themeId: 'dracula',
        prefs: TERMINAL_PREFS_DEFAULTS,
        onInput: vi.fn(),
        onResize: vi.fn()
      })
    )
    act(() => { vi.advanceTimersByTime(50) })
    mockState.activeTerminal!.clearTextureAtlas.mockClear()

    act(() => {
      window.dispatchEvent(new Event(UI_SCALE_EVENT))
    })
    expect(mockState.activeTerminal!.clearTextureAtlas).toHaveBeenCalled()

    mockState.activeTerminal!.clearTextureAtlas.mockClear()
    view.rerender(
      createElement(TerminalView, {
        paneId: 'pane-atlas',
        isRunning: true,
        themeId: 'nord',
        prefs: { ...TERMINAL_PREFS_DEFAULTS, fontSize: 16 },
        onInput: vi.fn(),
        onResize: vi.fn()
      })
    )
    act(() => { vi.advanceTimersByTime(50) })
    expect(mockState.activeTerminal!.clearTextureAtlas).toHaveBeenCalled()
    view.unmount()
  })
})
