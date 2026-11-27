import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, render, waitFor } from '@testing-library/react'
import { WebglAddon } from '@xterm/addon-webgl'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { MAX_WEBGL_CONTEXTS } from '../../../src/components/Terminal/webglBudget'
import {
  createWarmWebglPool,
  WARM_HIDDEN_IDLE_MS,
  WARM_WEBGL_POOL_SIZE
} from '../../../src/components/Terminal/webglPool'
import { TerminalView } from '../../../src/components/Terminal/TerminalView'
import { TERMINAL_PREFS_DEFAULTS } from '../../../src/store/terminal-prefs.store'

const syncScrollArea = vi.fn()
const webglDispose = vi.fn()
const dataHandlers = new Map<string, (event: { paneId: string; data: string }) => void>()

const terminalState = {
  write: vi.fn((_data: string, cb?: () => void) => cb?.()),
  focus: vi.fn(),
  dispose: vi.fn(),
  paste: vi.fn(),
  input: vi.fn(),
  refresh: vi.fn(),
  clear: vi.fn(),
  reset: vi.fn(),
  scrollLines: vi.fn(),
  scrollToBottom: vi.fn(),
  scrollToLine: vi.fn(),
  attachCustomKeyEventHandler: vi.fn(),
  attachCustomWheelEventHandler: vi.fn(),
  registerOscHandler: vi.fn(() => ({ dispose: vi.fn() })),
  getSelection: vi.fn(() => ''),
  clearSelection: vi.fn(),
  onSelectionChange: vi.fn(() => ({ dispose: vi.fn() }))
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
      focus: terminalState.focus,
      dispose: terminalState.dispose,
      paste: terminalState.paste,
      input: terminalState.input,
      modes: { bracketedPasteMode: true, mouseTrackingMode: 'none' },
      refresh: terminalState.refresh,
      clear: terminalState.clear,
      reset: terminalState.reset,
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
      _core: { viewport: { syncScrollArea } },
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
    return { onContextLoss: vi.fn(), dispose: webglDispose }
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

function createManualRaf() {
  let nextId = 1
  const queue = new Map<number, FrameRequestCallback>()
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
    const id = nextId++
    queue.set(id, cb)
    return id
  })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id: number) => {
    queue.delete(id)
  })
  const flushWave = (): void => {
    const batch = Array.from(queue.entries())
    queue.clear()
    for (const [, cb] of batch) cb(performance.now())
  }
  return { flushWave, pending: () => queue.size }
}

const flushMicrotasks = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('OXE-451 A2 · Warm WebGL2 LRU workspace switch in 1 frame without releaseWebgl or park', () => {
  beforeEach(() => {
    syncScrollArea.mockClear()
    webglDispose.mockClear()
    dataHandlers.clear()
    vi.mocked(WebglAddon).mockClear()
    terminalState.refresh.mockClear()
    terminalState.reset.mockClear()
    terminalState.write.mockReset().mockImplementation((_data: string, cb?: () => void) => cb?.())

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
        attach: vi.fn().mockResolvedValue({ running: true, seq: 1, prologue: '', replay: '', truncated: false, altScreen: false }),
        detach: vi.fn().mockResolvedValue({ seq: 1 }),
        status: vi.fn().mockResolvedValue({ running: true, seq: 1, altScreen: false }),
        onData: vi.fn((paneId: string, cb: (event: { paneId: string; data: string }) => void) => {
          dataHandlers.set(paneId, cb)
          return vi.fn(() => { dataHandlers.delete(paneId) })
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
    vi.restoreAllMocks()
  })

  test('keeps WebGL2 warm and unparked across workspace switch, pauses writes while hidden, and repaints in 1 frame on return', async () => {
    const manualRaf = createManualRaf()
    const pool = createWarmWebglPool({ maxWarm: WARM_WEBGL_POOL_SIZE, idleMs: WARM_HIDDEN_IDLE_MS })
    const hostA = document.body.appendChild(document.createElement('div'))
    const hostB = document.body.appendChild(document.createElement('div'))
    hostA.className = 'workspace-host'
    hostB.className = 'workspace-host workspace-host-hidden'

    let viewA: ReturnType<typeof render> | null = null
    let viewB: ReturnType<typeof render> | null = null
    try {
      viewA = render(
        createElement(TerminalView, {
          paneId: 'pane-ws-a',
          workspaceId: 'ws-a',
          isRunning: true,
          themeId: 'dracula',
          prefs: TERMINAL_PREFS_DEFAULTS,
          warmPool: pool,
          onInput: vi.fn(),
          onResize: vi.fn()
        }),
        { container: hostA }
      )
      viewB = render(
        createElement(TerminalView, {
          paneId: 'pane-ws-b',
          workspaceId: 'ws-b',
          isRunning: true,
          themeId: 'dracula',
          prefs: TERMINAL_PREFS_DEFAULTS,
          warmPool: pool,
          onInput: vi.fn(),
          onResize: vi.fn()
        }),
        { container: hostB }
      )

      await flushMicrotasks()
      act(() => { manualRaf.flushWave() })
      await waitFor(() => expect(WebglAddon).toHaveBeenCalledTimes(1))

      // Switch workspace A -> B: A stays warm in LRU pool (no releaseWebgl, no park).
      vi.mocked(window.oxe.terminal.detach).mockClear()
      hostA.classList.add('workspace-host-hidden')
      hostB.classList.remove('workspace-host-hidden')
      await flushMicrotasks()
      act(() => { manualRaf.flushWave() })
      act(() => { manualRaf.flushWave() })
      await waitFor(() => expect(WebglAddon).toHaveBeenCalledTimes(2))

      expect(webglDispose).toHaveBeenCalledTimes(0)
      expect(window.oxe.terminal.detach).not.toHaveBeenCalledWith({ paneId: 'pane-ws-a', parked: true })

      // Edge A2.e1: writes arriving while hidden warm pane is paused stay buffered until reveal.
      terminalState.write.mockClear()
      act(() => {
        dataHandlers.get('pane-ws-a')?.({ paneId: 'pane-ws-a', data: 'bg-line-1\r\n' })
        dataHandlers.get('pane-ws-a')?.({ paneId: 'pane-ws-a', data: 'bg-line-2\r\n' })
      })
      expect(terminalState.write).not.toHaveBeenCalled()

      // Switch BACK workspace B -> A: warm reveal finishes in 1 single rAF (<16ms).
      vi.mocked(WebglAddon).mockClear()
      webglDispose.mockClear()
      terminalState.refresh.mockClear()
      syncScrollArea.mockClear()
      vi.mocked(window.oxe.terminal.attach).mockClear()
      vi.mocked(window.oxe.terminal.detach).mockClear()

      hostB.classList.add('workspace-host-hidden')
      hostA.classList.remove('workspace-host-hidden')
      await flushMicrotasks()

      // Exactly ONE animation frame must repaint warm canvas and flush buffered writes.
      act(() => { manualRaf.flushWave() })

      expect(terminalState.refresh).toHaveBeenCalledWith(0, 31)
      expect(syncScrollArea).toHaveBeenCalledWith(true)
      expect(WebglAddon).toHaveBeenCalledTimes(0)
      expect(webglDispose).toHaveBeenCalledTimes(0)
      expect(window.oxe.terminal.detach).not.toHaveBeenCalled()
      expect(window.oxe.terminal.attach).not.toHaveBeenCalled()
      expect(terminalState.reset).not.toHaveBeenCalled()

      const written = terminalState.write.mock.calls.map((c) => c[0]).join('')
      expect(written).toContain('bg-line-1\r\nbg-line-2\r\n')
    } finally {
      viewA?.unmount()
      viewB?.unmount()
      pool.dispose()
      hostA.remove()
      hostB.remove()
    }
  })

  test('wires sharedWarmWebglPool in TerminalPane/GitHubPanel, removes pane cleanly on unmount, and preserves standalone OXE-443 contract', async () => {
    expect(WARM_WEBGL_POOL_SIZE).toBe(8)
    expect(WARM_WEBGL_POOL_SIZE).toBeLessThan(MAX_WEBGL_CONTEXTS)
    expect(WARM_HIDDEN_IDLE_MS).toBe(60_000)

    const terminalPaneSource = readFileSync(resolve(process.cwd(), 'src/components/Panes/TerminalPane.tsx'), 'utf8')
    const githubPanelSource = readFileSync(resolve(process.cwd(), 'src/components/GitHub/GitHubPanel.tsx'), 'utf8')
    expect(terminalPaneSource).toContain('sharedWarmWebglPool')
    expect(terminalPaneSource).toContain('warmPool={sharedWarmWebglPool}')
    expect(githubPanelSource).toContain('sharedWarmWebglPool')
    expect(githubPanelSource).toContain('warmPool={sharedWarmWebglPool}')

    // Unmount removes warm pane from pool cleanly without leaking entries.
    const pool = createWarmWebglPool({ maxWarm: 8, idleMs: 60_000 })
    const hostWarm = document.body.appendChild(document.createElement('div'))
    hostWarm.className = 'workspace-host'
    try {
      const view = render(
        createElement(TerminalView, {
          paneId: 'pane-unmount',
          workspaceId: 'ws-u',
          isRunning: true,
          themeId: 'dracula',
          prefs: TERMINAL_PREFS_DEFAULTS,
          warmPool: pool,
          onInput: vi.fn(),
          onResize: vi.fn()
        }),
        { container: hostWarm }
      )
      await waitFor(() => expect(pool.has('pane-unmount')).toBe(true))
      view.unmount()
      expect(pool.has('pane-unmount')).toBe(false)
      expect(pool.size()).toBe(0)
    } finally {
      pool.dispose()
      hostWarm.remove()
    }

    // Standalone TerminalView (no warmPool) retains eager dispose/park on hide for OXE-443 A1/A2.
    const manualRaf = createManualRaf()
    const hostLegacy = document.body.appendChild(document.createElement('div'))
    hostLegacy.className = 'workspace-host'
    try {
      const legacy = render(
        createElement(TerminalView, {
          paneId: 'pane-legacy',
          workspaceId: 'ws-legacy',
          isRunning: true,
          themeId: 'dracula',
          prefs: TERMINAL_PREFS_DEFAULTS,
          onInput: vi.fn(),
          onResize: vi.fn()
        }),
        { container: hostLegacy }
      )
      await flushMicrotasks()
      act(() => { manualRaf.flushWave() })
      await waitFor(() => expect(WebglAddon).toHaveBeenCalled())
      webglDispose.mockClear()

      hostLegacy.classList.add('workspace-host-hidden')
      await flushMicrotasks()
      expect(webglDispose).toHaveBeenCalledTimes(1)
      await waitFor(() => expect(window.oxe.terminal.detach).toHaveBeenCalledWith({ paneId: 'pane-legacy', parked: true }))
      legacy.unmount()
    } finally {
      hostLegacy.remove()
    }
  })
})
