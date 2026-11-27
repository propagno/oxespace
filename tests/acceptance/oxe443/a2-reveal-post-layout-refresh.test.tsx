import { act, render, waitFor } from '@testing-library/react'
import { WebglAddon } from '@xterm/addon-webgl'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { TerminalView } from '../../../src/components/Terminal/TerminalView'
import { TERMINAL_PREFS_DEFAULTS } from '../../../src/store/terminal-prefs.store'

const syncScrollArea = vi.fn()
const webglDispose = vi.fn()

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
  const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
    const id = nextId++
    queue.set(id, cb)
    return id
  })
  const caf = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id: number) => {
    queue.delete(id)
  })
  const flushWave = () => {
    const batch = Array.from(queue.entries())
    queue.clear()
    for (const [, cb] of batch) cb(performance.now())
  }
  return { raf, caf, flushWave, pending: () => queue.size }
}

const flushMicrotasks = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('OXE-443 A2 · Post-layout reveal loads WebGL and forces refresh even without size change', () => {
  beforeEach(() => {
    syncScrollArea.mockClear()
    webglDispose.mockClear()
    vi.mocked(WebglAddon).mockClear()
    terminalState.refresh.mockClear()
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
    vi.restoreAllMocks()
  })

  test('defers WebglAddon creation and forces terminal.refresh plus syncScrollArea after reveal frames even when cols and rows do not change', async () => {
    const manualRaf = createManualRaf()
    const host = document.body.appendChild(document.createElement('div'))
    host.className = 'workspace-host'
    try {
      render(
        <TerminalView
          paneId="pane-reveal"
          workspaceId="ws-reveal"
          isRunning
          themeId="dracula"
          prefs={TERMINAL_PREFS_DEFAULTS}
          onInput={vi.fn()}
          onResize={vi.fn()}
        />,
        { container: host }
      )
      // Complete initial mount fit so notified=(120, 32) and WebglAddon is loaded.
      await flushMicrotasks()
      act(() => { manualRaf.flushWave() })
      await waitFor(() => expect(WebglAddon).toHaveBeenCalledTimes(1))

      // Hide host -> disposes WebGL.
      host.classList.add('workspace-host-hidden')
      await flushMicrotasks()
      expect(webglDispose).toHaveBeenCalledTimes(1)

      vi.mocked(WebglAddon).mockClear()
      terminalState.refresh.mockClear()
      syncScrollArea.mockClear()

      // Reveal host with identical 120x32 dimensions (dimensionsChanged === false).
      host.classList.remove('workspace-host-hidden')
      await flushMicrotasks()

      // Must NOT recreate WebGL or refresh synchronously in the MutationObserver microtask before layout settles.
      expect(WebglAddon).toHaveBeenCalledTimes(0)
      expect(terminalState.refresh).toHaveBeenCalledTimes(0)

      // Flush post-layout reveal animation frames (double-rAF).
      act(() => { manualRaf.flushWave() })
      act(() => { manualRaf.flushWave() })

      expect(WebglAddon).toHaveBeenCalledTimes(1)
      expect(terminalState.refresh).toHaveBeenCalledWith(0, 31)
      expect(syncScrollArea).toHaveBeenCalledWith(true)
    } finally {
      host.remove()
    }
  })

  test('cancels pending post-layout reveal frames when hidden again before frame fires', async () => {
    const manualRaf = createManualRaf()
    const host = document.body.appendChild(document.createElement('div'))
    host.className = 'workspace-host'
    try {
      render(
        <TerminalView
          paneId="pane-reveal-cancel"
          workspaceId="ws-reveal"
          isRunning
          themeId="dracula"
          prefs={TERMINAL_PREFS_DEFAULTS}
          onInput={vi.fn()}
          onResize={vi.fn()}
        />,
        { container: host }
      )
      await flushMicrotasks()
      act(() => { manualRaf.flushWave() })

      host.classList.add('workspace-host-hidden')
      await flushMicrotasks()
      vi.mocked(WebglAddon).mockClear()
      terminalState.refresh.mockClear()

      // Reveal then hide again before the scheduled reveal frames fire.
      host.classList.remove('workspace-host-hidden')
      await flushMicrotasks()
      host.classList.add('workspace-host-hidden')
      await flushMicrotasks()

      act(() => { manualRaf.flushWave() })
      act(() => { manualRaf.flushWave() })

      expect(WebglAddon).toHaveBeenCalledTimes(0)
      expect(terminalState.refresh).toHaveBeenCalledTimes(0)
    } finally {
      host.remove()
    }
  })
})
