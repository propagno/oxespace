import { act, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { openInMemoryDatabase } from '../../../electron/main/db/index'
import { TerminalManager } from '../../../electron/main/services/terminal.service'
import { WorkspaceService } from '../../../electron/main/services/workspace.service'
import { TerminalView } from '../../../src/components/Terminal/TerminalView'
import { TERMINAL_PREFS_DEFAULTS } from '../../../src/store/terminal-prefs.store'

const mockBufferActive = {
  type: 'normal' as 'normal' | 'alternate',
  baseY: 0,
  viewportY: 0,
  cursorY: 0,
  length: 0,
  getLine: vi.fn(() => null)
}

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
      buffer: { active: mockBufferActive },
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
    pid: 1234,
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

const settle = () => new Promise((resolve) => setTimeout(resolve, 25))

describe('OXE-443 A1 · Lever H contiguous reattach without terminal.reset()', () => {
  beforeEach(() => {
    mockBufferActive.type = 'normal'
    mockBufferActive.baseY = 0
    mockBufferActive.viewportY = 0
    terminalState.write.mockReset().mockImplementation((_data: string, cb?: () => void) => cb?.())
    terminalState.reset.mockClear()
    terminalState.scrollToLine.mockClear()
    terminalState.scrollToBottom.mockClear()

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

  test('SessionOutput.attach returns contiguous delta in altScreen when !truncated and clears pendingRedrawNudge', async () => {
    const db = openInMemoryDatabase()
    const workspace = new WorkspaceService(db).create({ rootPath: 'C:/repo', layout: '1x1', autoStart: false })
    const pty = createFakePtyModule()
    const manager = new TerminalManager(db, { pty, platform: 'linux' })
    const paneId = workspace.panes[0].id
    try {
      await manager.start({ workspaceId: workspace.id, paneId, cols: 120, rows: 32 })
      pty.instances[0].emitData('\x1b[?1049hTUI-INITIAL')
      await settle()

      const parked = manager.detach({ paneId, parked: true })
      expect(parked?.seq).toBeGreaterThan(0)

      pty.instances[0].emitData('\x1b[2;1HFRAME-DELTA')
      await settle()

      const attached = manager.attach({ paneId, sinceSeq: parked!.seq })
      expect(attached.running).toBe(true)
      expect(attached.altScreen).toBe(true)
      expect(attached.truncated).toBe(false)
      expect(attached.replay).toContain('FRAME-DELTA')

      // Contiguous delta reattach must not trigger a destructive bounce on same-size resize.
      pty.instances[0].resize.mockClear()
      manager.resize({ paneId, cols: 120, rows: 32 })
      expect(pty.instances[0].resize).toHaveBeenCalledTimes(1)
      expect(pty.instances[0].resize).toHaveBeenCalledWith(120, 32)

      // Edge A1.e1: empty delta returns replay='' without truncation or bounce.
      const parkedAgain = manager.detach({ paneId, parked: true })
      const emptyReattach = manager.attach({ paneId, sinceSeq: parkedAgain!.seq })
      expect(emptyReattach.running).toBe(true)
      expect(emptyReattach.altScreen).toBe(true)
      expect(emptyReattach.truncated).toBe(false)
      expect(emptyReattach.replay).toBe('')
    } finally {
      manager.stopAll()
      db.close()
    }
  })

  test('TerminalView applies contiguous altScreen delta without calling terminal.reset and handles empty delta', async () => {
    vi.mocked(window.oxe.terminal.attach).mockResolvedValueOnce({
      running: true,
      seq: 10,
      prologue: '\x1b[?1049h',
      replay: '',
      truncated: false,
      altScreen: true
    })
    vi.mocked(window.oxe.terminal.detach).mockResolvedValue({ seq: 10 } as never)

    const host = document.body.appendChild(document.createElement('div'))
    host.className = 'workspace-host'
    try {
      render(
        <TerminalView
          paneId="pane-alt-delta"
          workspaceId="ws-1"
          isRunning
          themeId="dracula"
          prefs={TERMINAL_PREFS_DEFAULTS}
          onInput={vi.fn()}
          onResize={vi.fn()}
        />,
        { container: host }
      )
      await waitFor(() => expect(window.oxe.terminal.attach).toHaveBeenCalledWith({ paneId: 'pane-alt-delta' }))
      terminalState.write.mockClear()
      terminalState.reset.mockClear()

      host.classList.add('workspace-host-hidden')
      await waitFor(() => expect(window.oxe.terminal.detach).toHaveBeenCalledWith({ paneId: 'pane-alt-delta', parked: true }))
      await act(async () => { await Promise.resolve() })

      vi.mocked(window.oxe.terminal.attach).mockResolvedValueOnce({
        running: true,
        seq: 15,
        prologue: '\x1b[?1049h',
        replay: '\x1b[2;1HDELTA-TUI',
        truncated: false,
        altScreen: true
      })
      host.classList.remove('workspace-host-hidden')

      await waitFor(() => expect(window.oxe.terminal.attach).toHaveBeenLastCalledWith({ paneId: 'pane-alt-delta', sinceSeq: 10 }))
      await waitFor(() => expect(terminalState.write).toHaveBeenCalledWith('\x1b[2;1HDELTA-TUI'))
      expect(terminalState.reset).not.toHaveBeenCalled()

      // Edge A1.e1: empty delta in altScreen writes nothing and never resets.
      terminalState.write.mockClear()
      vi.mocked(window.oxe.terminal.detach).mockResolvedValueOnce({ seq: 15 } as never)
      host.classList.add('workspace-host-hidden')
      await waitFor(() => expect(window.oxe.terminal.detach).toHaveBeenCalledTimes(2))
      await act(async () => { await Promise.resolve() })

      vi.mocked(window.oxe.terminal.attach).mockResolvedValueOnce({
        running: true,
        seq: 15,
        prologue: '\x1b[?1049h',
        replay: '',
        truncated: false,
        altScreen: true
      })
      host.classList.remove('workspace-host-hidden')
      await waitFor(() => expect(window.oxe.terminal.attach).toHaveBeenLastCalledWith({ paneId: 'pane-alt-delta', sinceSeq: 15 }))
      expect(terminalState.reset).not.toHaveBeenCalled()
    } finally {
      host.remove()
    }
  })

  test('TerminalView preserves normal-buffer scroll pin across contiguous delta reattach and survives hide-show race during pending park', async () => {
    mockBufferActive.type = 'normal'
    mockBufferActive.baseY = 200
    mockBufferActive.viewportY = 40

    vi.mocked(window.oxe.terminal.attach).mockResolvedValueOnce({
      running: true,
      seq: 20,
      prologue: '',
      replay: 'initial-history',
      truncated: false,
      altScreen: false
    })
    vi.mocked(window.oxe.terminal.detach).mockResolvedValueOnce({ seq: 20 } as never)

    const host = document.body.appendChild(document.createElement('div'))
    host.className = 'workspace-host'
    try {
      render(
        <TerminalView
          paneId="pane-scroll-race"
          workspaceId="ws-2"
          isRunning
          themeId="dracula"
          prefs={TERMINAL_PREFS_DEFAULTS}
          onInput={vi.fn()}
          onResize={vi.fn()}
        />,
        { container: host }
      )
      await waitFor(() => expect(terminalState.write).toHaveBeenCalledWith('initial-history'))
      terminalState.scrollToLine.mockClear()
      terminalState.reset.mockClear()

      // Part A: scrolled-up normal buffer preserves viewportY across delta reattach.
      host.classList.add('workspace-host-hidden')
      await waitFor(() => expect(window.oxe.terminal.detach).toHaveBeenCalledTimes(1))
      await act(async () => { await Promise.resolve() })

      vi.mocked(window.oxe.terminal.attach).mockResolvedValueOnce({
        running: true,
        seq: 25,
        prologue: '',
        replay: 'delta-line\r\n',
        truncated: false,
        altScreen: false
      })
      host.classList.remove('workspace-host-hidden')

      await waitFor(() => expect(terminalState.scrollToLine).toHaveBeenCalledWith(40))
      expect(terminalState.reset).not.toHaveBeenCalled()

      // Part B: rapid hide -> show while detach() is still in flight recovers cleanly without reset.
      let resolveDetach!: (value: { seq: number }) => void
      vi.mocked(window.oxe.terminal.detach).mockImplementationOnce(
        () => new Promise((resolve) => { resolveDetach = resolve }) as never
      )
      vi.mocked(window.oxe.terminal.attach).mockResolvedValueOnce({
        running: true,
        seq: 35,
        prologue: '',
        replay: 'race-delta',
        truncated: false,
        altScreen: false
      })

      host.classList.add('workspace-host-hidden')
      await waitFor(() => expect(window.oxe.terminal.detach).toHaveBeenCalledTimes(2))

      // Reveal BEFORE detach resolves.
      host.classList.remove('workspace-host-hidden')
      await act(async () => { await Promise.resolve() })

      resolveDetach({ seq: 30 })
      await waitFor(() => expect(window.oxe.terminal.attach).toHaveBeenLastCalledWith({ paneId: 'pane-scroll-race', sinceSeq: 30 }))
      await waitFor(() => {
        const written = terminalState.write.mock.calls.map((c) => c[0]).join('')
        expect(written).toContain('race-delta')
      })
      expect(terminalState.reset).not.toHaveBeenCalled()
    } finally {
      host.remove()
    }
  })
})
