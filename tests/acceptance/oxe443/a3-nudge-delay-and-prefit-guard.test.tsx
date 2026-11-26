import { act, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { openInMemoryDatabase } from '../../../electron/main/db/index'
import { NUDGE_REDRAW_DELAY_MS, TerminalManager } from '../../../electron/main/services/terminal.service'
import { WorkspaceService } from '../../../electron/main/services/workspace.service'
import { TerminalView } from '../../../src/components/Terminal/TerminalView'
import { TERMINAL_PREFS_DEFAULTS } from '../../../src/store/terminal-prefs.store'

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
      // Unfitted default xterm geometry before FitAddon ever measures the container.
      cols: 80,
      rows: 24,
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
        active: { type: 'alternate', baseY: 0, viewportY: 0, cursorY: 0, length: 24, getLine: vi.fn(() => null) }
      },
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

function createFakePty() {
  let dataHandler: ((data: string) => void) | null = null
  return {
    pid: 2222,
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: vi.fn((handler: (data: string) => void) => {
      dataHandler = handler
      return { dispose: vi.fn() }
    }),
    onExit: vi.fn(() => ({ dispose: vi.fn() })),
    emitData(data: string) {
      dataHandler?.(data)
    }
  }
}

function createFakePtyModule() {
  const instances: Array<ReturnType<typeof createFakePty>> = []
  return {
    instances,
    spawn: vi.fn(() => {
      const instance = createFakePty()
      instances.push(instance)
      return instance
    })
  }
}

describe('OXE-443 A3 · Deterministic nudgeRedraw (>= 50ms, cancellable) and pre-fit onResize guard', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  test('nudgeRedraw holds bounce for at least 50ms and cancels pending restore on resize, detach, or stop', async () => {
    expect(NUDGE_REDRAW_DELAY_MS).toBeGreaterThanOrEqual(50)
    vi.useFakeTimers()

    const db = openInMemoryDatabase()
    const workspace = new WorkspaceService(db).create({ rootPath: 'C:/repo', layout: '1x1', autoStart: false })
    const pty = createFakePtyModule()
    const manager = new TerminalManager(db, { pty, platform: 'win32' })
    const paneId = workspace.panes[0].id
    try {
      await manager.start({ workspaceId: workspace.id, paneId, cols: 100, rows: 30 })
      pty.instances[0].emitData('\x1b[?1049hTUI')
      vi.advanceTimersByTime(30)

      manager.detach({ paneId })
      pty.instances[0].resize.mockClear()

      // Fresh attach without sinceSeq on altScreen requires a rows redraw nudge.
      manager.attach({ paneId })
      manager.resize({ paneId, cols: 100, rows: 30 })
      expect(pty.instances[0].resize).toHaveBeenCalledTimes(1)
      expect(pty.instances[0].resize).toHaveBeenLastCalledWith(100, 29)

      // Edge A3.e2: before 50ms, bounce must still be held so ConPTY / TUI sees the size delta.
      vi.advanceTimersByTime(49)
      expect(pty.instances[0].resize).toHaveBeenCalledTimes(1)

      // After NUDGE_REDRAW_DELAY_MS completes, restore fires once.
      vi.advanceTimersByTime(NUDGE_REDRAW_DELAY_MS)
      expect(pty.instances[0].resize).toHaveBeenCalledTimes(2)
      expect(pty.instances[0].resize).toHaveBeenLastCalledWith(100, 30)

      // Edge A3.e3: a newer resize before the bounce finishes cancels the stale restore timer.
      manager.detach({ paneId })
      manager.attach({ paneId })
      pty.instances[0].resize.mockClear()
      manager.resize({ paneId, cols: 100, rows: 30 })
      expect(pty.instances[0].resize).toHaveBeenLastCalledWith(100, 29)
      vi.advanceTimersByTime(20)
      manager.resize({ paneId, cols: 112, rows: 36 })
      vi.advanceTimersByTime(NUDGE_REDRAW_DELAY_MS * 2)
      expect(pty.instances[0].resize).toHaveBeenCalledTimes(2)
      expect(pty.instances[0].resize).toHaveBeenLastCalledWith(112, 36)

      // Edge A3.e3: detach() cancels any in-flight nudge restore timer.
      manager.detach({ paneId })
      manager.attach({ paneId })
      pty.instances[0].resize.mockClear()
      manager.resize({ paneId, cols: 112, rows: 36 })
      expect(pty.instances[0].resize).toHaveBeenCalledTimes(1)
      manager.detach({ paneId })
      vi.advanceTimersByTime(NUDGE_REDRAW_DELAY_MS * 2)
      expect(pty.instances[0].resize).toHaveBeenCalledTimes(1)

      // Edge A3.e1: minimum 1x1 geometry never bounces to 0 cols or 0 rows.
      manager.attach({ paneId })
      manager.resize({ paneId, cols: 1, rows: 1 })
      manager.detach({ paneId })
      manager.attach({ paneId })
      pty.instances[0].resize.mockClear()
      manager.resize({ paneId, cols: 1, rows: 1 })
      vi.advanceTimersByTime(NUDGE_REDRAW_DELAY_MS * 2)
      for (const [cols, rows] of pty.instances[0].resize.mock.calls) {
        expect(cols).toBeGreaterThanOrEqual(1)
        expect(rows).toBeGreaterThanOrEqual(1)
      }
    } finally {
      manager.stopAll()
      db.close()
    }
  })

  test('TerminalView never emits unfitted 80x24 onResize after attach while hidden or before first fit', async () => {
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
        attach: vi.fn().mockResolvedValue({
          running: true,
          seq: 1,
          prologue: '\x1b[?1049h',
          replay: '',
          truncated: false,
          altScreen: true
        }),
        detach: vi.fn().mockResolvedValue({ seq: 1 }),
        status: vi.fn().mockResolvedValue({ running: true, seq: 1, altScreen: true }),
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

    const onResize = vi.fn()
    const host = document.body.appendChild(document.createElement('div'))
    host.className = 'workspace-host workspace-host-hidden'
    try {
      render(
        <TerminalView
          paneId="pane-prefit"
          workspaceId="ws-hidden"
          isRunning
          themeId="dracula"
          prefs={TERMINAL_PREFS_DEFAULTS}
          onInput={vi.fn()}
          onResize={onResize}
        />,
        { container: host }
      )
      await waitFor(() => expect(window.oxe.terminal.attach).toHaveBeenCalledWith({ paneId: 'pane-prefit' }))
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 40))
      })
      expect(onResize).not.toHaveBeenCalled()
    } finally {
      host.remove()
    }
  })
})
