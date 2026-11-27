import { act, render, waitFor } from '@testing-library/react'
import { WebglAddon } from '@xterm/addon-webgl'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { MAX_WEBGL_CONTEXTS } from '../../../src/components/Terminal/webglBudget'
import {
  createWarmWebglPool,
  getActiveWebglContextCount,
  WARM_HIDDEN_IDLE_MS,
  WARM_WEBGL_POOL_SIZE
} from '../../../src/components/Terminal/webglPool'
import { TerminalView } from '../../../src/components/Terminal/TerminalView'
import { TERMINAL_PREFS_DEFAULTS } from '../../../src/store/terminal-prefs.store'

const webglInstances: Array<{ dispose: ReturnType<typeof vi.fn> }> = []

const terminalState = {
  write: vi.fn((_data: string, cb?: () => void) => cb?.()),
  refresh: vi.fn(),
  reset: vi.fn()
}

vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn().mockImplementation(function () {
    return {
      cols: 120,
      rows: 32,
      options: {},
      loadAddon: vi.fn(),
      registerLinkProvider: vi.fn(() => ({ dispose: vi.fn() })),
      open: vi.fn(),
      write: terminalState.write,
      focus: vi.fn(),
      dispose: vi.fn(),
      paste: vi.fn(),
      input: vi.fn(),
      modes: { bracketedPasteMode: true, mouseTrackingMode: 'none' },
      refresh: terminalState.refresh,
      clear: vi.fn(),
      reset: terminalState.reset,
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
      _core: { viewport: { syncScrollArea: vi.fn() } },
      onData: vi.fn(() => ({ dispose: vi.fn() }))
    }
  })
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn().mockImplementation(function () {
    return { fit: vi.fn() }
  })
}))
vi.mock('@xterm/addon-unicode11', () => ({ Unicode11Addon: vi.fn() }))
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: vi.fn() }))
vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: vi.fn().mockImplementation(function () {
    const inst = { onContextLoss: vi.fn(), dispose: vi.fn() }
    webglInstances.push(inst)
    return inst
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

describe('OXE-451 A3 · Deterministic WebGL LRU eviction, idle TTL, and MAX_WEBGL_CONTEXTS budget', () => {
  beforeEach(() => {
    webglInstances.length = 0
    vi.mocked(WebglAddon).mockClear()
    terminalState.write.mockReset().mockImplementation((_data: string, cb?: () => void) => cb?.())
    terminalState.refresh.mockClear()
    terminalState.reset.mockClear()

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((type: string) =>
      type === 'webgl2' ? ({ getExtension: () => null } as unknown as WebGL2RenderingContext) : null
    ) as unknown as typeof HTMLCanvasElement.prototype.getContext)

    global.ResizeObserver = class {
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
        attach: vi.fn().mockResolvedValue({ running: true, seq: 10, prologue: '', replay: '', truncated: false, altScreen: false }),
        detach: vi.fn().mockResolvedValue({ seq: 10 }),
        status: vi.fn().mockResolvedValue({ running: true, seq: 10, altScreen: false }),
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

  test('evicts strictly the LRU hidden pane past WARM_WEBGL_POOL_SIZE, honors MRU promotion, and never evicts visible panes', () => {
    vi.useFakeTimers()
    const evicted: string[] = []
    const pool = createWarmWebglPool({ maxWarm: WARM_WEBGL_POOL_SIZE, idleMs: WARM_HIDDEN_IDLE_MS })
    try {
      const makeEvict = (id: string) => () => { evicted.push(id) }

      for (let i = 1; i <= 8; i++) {
        pool.touchVisible(`p${i}`, makeEvict(`p${i}`))
        if (i < 8) pool.markHidden(`p${i}`, makeEvict(`p${i}`))
      }
      expect(pool.size()).toBe(8)
      expect(evicted).toEqual([])

      // Revisit p1 -> promotes p1 to MRU so p2 becomes oldest hidden LRU.
      pool.touchVisible('p1', makeEvict('p1'))
      pool.markHidden('p1', makeEvict('p1'))
      expect(evicted).toEqual([])

      // Adding p9 evicts ONLY p2 (not p1!).
      pool.touchVisible('p9', makeEvict('p9'))
      expect(evicted).toEqual(['p2'])
      expect(pool.size()).toBe(8)
      expect(pool.has('p1')).toBe(true)
      expect(pool.has('p2')).toBe(false)

      // Adding p10 evicts ONLY p3.
      pool.touchVisible('p10', makeEvict('p10'))
      expect(evicted).toEqual(['p2', 'p3'])
      expect(pool.size()).toBe(8)

      // Edge: opening 10 visible panes at once evicts all remaining hidden panes, NEVER visible panes.
      const visibleEvicted: string[] = []
      for (let i = 1; i <= 10; i++) {
        pool.touchVisible(`v${i}`, () => { visibleEvicted.push(`v${i}`) })
      }
      expect(visibleEvicted).toEqual([])
      for (let i = 1; i <= 10; i++) {
        expect(pool.has(`v${i}`)).toBe(true)
      }
    } finally {
      pool.dispose()
    }
  })

  test('auto-evicts hidden panes after WARM_HIDDEN_IDLE_MS (60s) and cancels idle timer when revisited before TTL', () => {
    vi.useFakeTimers()
    const evicted: string[] = []
    const pool = createWarmWebglPool({ maxWarm: WARM_WEBGL_POOL_SIZE, idleMs: WARM_HIDDEN_IDLE_MS })
    try {
      pool.touchVisible('p1', () => evicted.push('p1'))
      pool.touchVisible('p2', () => evicted.push('p2'))
      pool.markHidden('p1', () => evicted.push('p1'))
      pool.markHidden('p2', () => evicted.push('p2'))

      vi.advanceTimersByTime(30_000)
      expect(evicted).toEqual([])

      // Revisit p1 at 30s -> cancels original timer and resets TTL.
      pool.touchVisible('p1', () => evicted.push('p1'))
      pool.markHidden('p1', () => evicted.push('p1'))

      // At 60s total: p2 expires and evicts; p1 still has 30s left.
      vi.advanceTimersByTime(30_000)
      expect(evicted).toEqual(['p2'])
      expect(pool.has('p1')).toBe(true)

      // At 90s total: p1 expires and evicts cleanly.
      vi.advanceTimersByTime(30_000)
      expect(evicted).toEqual(['p2', 'p1'])
      expect(pool.size()).toBe(0)
    } finally {
      pool.dispose()
    }
  })

  test('TerminalView LRU eviction releases WebGL2 and parks oldest hidden pane, keeping active contexts <= MAX_WEBGL_CONTEXTS and recovering via contiguous unpark', async () => {
    const pool = createWarmWebglPool({ maxWarm: 2, idleMs: 60_000 })
    const host1 = document.body.appendChild(document.createElement('div'))
    const host2 = document.body.appendChild(document.createElement('div'))
    const host3 = document.body.appendChild(document.createElement('div'))
    host1.className = 'workspace-host'
    host2.className = 'workspace-host workspace-host-hidden'
    host3.className = 'workspace-host workspace-host-hidden'

    let view1: ReturnType<typeof render> | null = null
    let view2: ReturnType<typeof render> | null = null
    let view3: ReturnType<typeof render> | null = null
    try {
      view1 = render(
        createElement(TerminalView, {
          paneId: 'pane-lru-1',
          workspaceId: 'ws-1',
          isRunning: true,
          themeId: 'dracula',
          prefs: TERMINAL_PREFS_DEFAULTS,
          warmPool: pool,
          onInput: vi.fn(),
          onResize: vi.fn()
        }),
        { container: host1 }
      )
      view2 = render(
        createElement(TerminalView, {
          paneId: 'pane-lru-2',
          workspaceId: 'ws-2',
          isRunning: true,
          themeId: 'dracula',
          prefs: TERMINAL_PREFS_DEFAULTS,
          warmPool: pool,
          onInput: vi.fn(),
          onResize: vi.fn()
        }),
        { container: host2 }
      )
      view3 = render(
        createElement(TerminalView, {
          paneId: 'pane-lru-3',
          workspaceId: 'ws-3',
          isRunning: true,
          themeId: 'dracula',
          prefs: TERMINAL_PREFS_DEFAULTS,
          warmPool: pool,
          onInput: vi.fn(),
          onResize: vi.fn()
        }),
        { container: host3 }
      )

      await waitFor(() => expect(webglInstances).toHaveLength(1))
      await waitFor(() => expect(window.oxe.terminal.attach).toHaveBeenCalledTimes(3))
      await flushMicrotasks()
      const webgl1 = webglInstances[0]

      // Switch 1 -> 2: both fit inside maxWarm=2, so 1 stays warm.
      vi.mocked(window.oxe.terminal.detach).mockClear()
      host1.classList.add('workspace-host-hidden')
      host2.classList.remove('workspace-host-hidden')
      await waitFor(() => expect(webglInstances).toHaveLength(2))
      const webgl2 = webglInstances[1]
      expect(webgl1.dispose).not.toHaveBeenCalled()
      expect(window.oxe.terminal.detach).not.toHaveBeenCalledWith({ paneId: 'pane-lru-1', parked: true })
      expect(getActiveWebglContextCount()).toBeLessThanOrEqual(2)

      // Switch 2 -> 3: exceeds maxWarm=2 -> evicts ONLY pane-lru-1 (oldest hidden).
      host2.classList.add('workspace-host-hidden')
      host3.classList.remove('workspace-host-hidden')
      await waitFor(() => expect(webglInstances).toHaveLength(3))

      expect(webgl1.dispose).toHaveBeenCalledTimes(1)
      expect(webgl2.dispose).not.toHaveBeenCalled()
      await waitFor(() => expect(window.oxe.terminal.detach).toHaveBeenCalledWith({ paneId: 'pane-lru-1', parked: true }))
      expect(window.oxe.terminal.detach).not.toHaveBeenCalledWith({ paneId: 'pane-lru-2', parked: true })
      expect(getActiveWebglContextCount()).toBeLessThanOrEqual(2)
      expect(getActiveWebglContextCount()).toBeLessThanOrEqual(MAX_WEBGL_CONTEXTS)

      // Returning to evicted pane-lru-1 recovers via contiguous delta unpark without terminal.reset().
      terminalState.reset.mockClear()
      vi.mocked(window.oxe.terminal.attach).mockResolvedValueOnce({
        running: true,
        seq: 18,
        prologue: '',
        replay: 'recovered-after-evict\r\n',
        truncated: false,
        altScreen: false
      })
      host3.classList.add('workspace-host-hidden')
      host1.classList.remove('workspace-host-hidden')
      await flushMicrotasks()

      await waitFor(() =>
        expect(window.oxe.terminal.attach).toHaveBeenLastCalledWith({ paneId: 'pane-lru-1', sinceSeq: 10 })
      )
      await waitFor(() => expect(terminalState.write).toHaveBeenCalledWith('recovered-after-evict\r\n'))
      expect(terminalState.reset).not.toHaveBeenCalled()
      expect(getActiveWebglContextCount()).toBeLessThanOrEqual(2)
      expect(getActiveWebglContextCount()).toBeLessThanOrEqual(MAX_WEBGL_CONTEXTS)
    } finally {
      view1?.unmount()
      view2?.unmount()
      view3?.unmount()
      pool.dispose()
      host1.remove()
      host2.remove()
      host3.remove()
    }
  })
})
