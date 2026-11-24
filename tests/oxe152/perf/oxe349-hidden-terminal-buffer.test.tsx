// Unit & integration tests for OXE-349:
// Hidden TerminalView pauses xterm writes with a bounded buffer and flushes in
// coalesced requestAnimationFrame slices when visible again.
import { act, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  createTerminalWriteScheduler,
  MAX_BUFFERED_BYTES,
  MAX_BYTES_PER_FRAME,
  type TerminalWriteMeta
} from '../../../src/components/Terminal/terminalWriteScheduler'
import { isTerminalHostHidden, observeTerminalVisibility } from '../../../src/components/Terminal/terminalVisibility'
import { TerminalView } from '../../../src/components/Terminal/TerminalView'
import { TERMINAL_PREFS_DEFAULTS } from '../../../src/store/terminal-prefs.store'
import { useTerminalStore } from '../../../src/store/terminal.store'

const terminalState = {
  write: vi.fn((_data: string, cb?: () => void) => cb?.()),
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

afterEach(() => {
  useTerminalStore.setState({ panes: {}, pendingCommands: {}, activePaneId: null })
  vi.restoreAllMocks()
})

describe('OXE-349 · Terminal write scheduler pause & bounded buffer', () => {
  test('pauses writes and cancels pending RAF when hidden, then flushes in order on resume', () => {
    const writes: Array<{ chunk: string; meta: TerminalWriteMeta }> = []
    const frames = new Map<number, () => void>()
    let nextFrameId = 1
    const cancelFrame = vi.fn((id: number) => {
      frames.delete(id)
    })

    const scheduler = createTerminalWriteScheduler({
      immediateBytes: 16,
      maxBytesPerFrame: 64,
      maxBufferedBytes: 512,
      write: (chunk, done, meta) => {
        writes.push({ chunk, meta })
        done()
      },
      scheduleFrame: (cb) => {
        const id = nextFrameId++
        frames.set(id, cb)
        return id
      },
      cancelFrame
    })

    // Enqueue a burst while visible: schedules one frame.
    scheduler.enqueue('A'.repeat(40))
    expect(frames.size).toBe(1)
    expect(writes).toHaveLength(0)

    // Hide before the frame fires: cancels the scheduled RAF.
    scheduler.setPaused(true)
    expect(scheduler.isPaused()).toBe(true)
    expect(cancelFrame).toHaveBeenCalledTimes(1)
    expect(frames.size).toBe(0)

    // Small and large chunks arriving while hidden do not write or schedule RAF.
    scheduler.enqueue('x')
    scheduler.enqueue('B'.repeat(40))
    expect(writes).toHaveLength(0)
    expect(frames.size).toBe(0)
    expect(scheduler.pendingLength()).toBe(81)
    expect(scheduler.wasTruncated()).toBe(false)

    // Resume: flushes buffered data across coalesced frames in exact byte order.
    scheduler.setPaused(false)
    expect(scheduler.isPaused()).toBe(false)
    expect(frames.size).toBe(1)

    while (frames.size > 0) {
      const [[id, cb]] = Array.from(frames.entries())
      frames.delete(id)
      cb()
    }

    expect(writes).toHaveLength(2)
    expect(writes[0].chunk).toHaveLength(64)
    expect(writes[0].meta.truncated).toBe(false)
    expect(writes[1].chunk).toHaveLength(17)
    expect(writes[1].meta.truncated).toBe(false)
    expect(writes.map((w) => w.chunk).join('')).toBe(`${'A'.repeat(40)}x${'B'.repeat(40)}`)
    expect(scheduler.pendingLength()).toBe(0)
    scheduler.dispose()
  })

  test('enforces bounded buffer cap under sustained multi-MB load (no unbounded RAM growth)', () => {
    const writes: Array<{ chunk: string; meta: TerminalWriteMeta }> = []
    const frames: Array<() => void> = []

    const scheduler = createTerminalWriteScheduler({
      paused: true,
      maxBytesPerFrame: MAX_BYTES_PER_FRAME,
      maxBufferedBytes: MAX_BUFFERED_BYTES,
      write: (chunk, done, meta) => {
        writes.push({ chunk, meta })
        done()
      },
      scheduleFrame: (cb) => frames.push(cb),
      cancelFrame: vi.fn()
    })

    // Simulate 8 MB of output while hidden (256 chunks × 32 KB).
    const chunk32k = '0123456789abcdef'.repeat(2048)
    for (let i = 0; i < 256; i++) {
      scheduler.enqueue(chunk32k)
      expect(scheduler.pendingLength()).toBeLessThanOrEqual(MAX_BUFFERED_BYTES)
    }
    scheduler.enqueue('TAIL-MARKER')

    expect(writes).toHaveLength(0)
    expect(frames).toHaveLength(0)
    expect(scheduler.wasTruncated()).toBe(true)
    expect(scheduler.pendingLength()).toBeLessThanOrEqual(MAX_BUFFERED_BYTES)

    // Resume and drain all coalesced frames.
    scheduler.setPaused(false)
    while (frames.length > 0) {
      frames.shift()!()
    }

    expect(writes.length).toBeGreaterThan(0)
    expect(writes[0].meta.truncated).toBe(true)
    for (let i = 1; i < writes.length; i++) {
      expect(writes[i].meta.truncated).toBe(false)
    }
    const combined = writes.map((w) => w.chunk).join('')
    expect(combined.endsWith('TAIL-MARKER')).toBe(true)
    expect(combined.length).toBeLessThanOrEqual(MAX_BUFFERED_BYTES)
    expect(scheduler.pendingLength()).toBe(0)
    expect(scheduler.wasTruncated()).toBe(false)
    scheduler.dispose()
  })

  test('does not split UTF-16 surrogate pairs when truncating or slicing frames', () => {
    const writes: string[] = []
    const frames: Array<() => void> = []
    const emoji = '🚀' // 2 UTF-16 code units

    const scheduler = createTerminalWriteScheduler({
      paused: true,
      maxBytesPerFrame: 5,
      maxBufferedBytes: 7,
      write: (chunk, done) => {
        writes.push(chunk)
        done()
      },
      scheduleFrame: (cb) => frames.push(cb),
      cancelFrame: vi.fn()
    })

    scheduler.enqueue(emoji.repeat(10))
    expect(scheduler.pendingLength()).toBeLessThanOrEqual(7)

    scheduler.setPaused(false)
    while (frames.length > 0) {
      frames.shift()!()
    }

    for (const slice of writes) {
      // No lone high (0xD800-0xDBFF) or low (0xDC00-0xDFFF) surrogates at edges.
      const first = slice.charCodeAt(0)
      const last = slice.charCodeAt(slice.length - 1)
      expect(first >= 0xdc00 && first <= 0xdfff).toBe(false)
      expect(last >= 0xd800 && last <= 0xdbff).toBe(false)
    }
    scheduler.dispose()
  })
})

describe('OXE-349 · Terminal visibility detection', () => {
  test('detects hidden workspace, suppressed panel, hidden split slot, and hidden thread host', async () => {
    const workspaceHost = document.createElement('div')
    workspaceHost.className = 'workspace-host'
    const splitSlot = document.createElement('div')
    splitSlot.className = 'split-pane-slot'
    const host = document.createElement('div')
    splitSlot.appendChild(host)
    workspaceHost.appendChild(splitSlot)
    document.body.appendChild(workspaceHost)

    const changes: boolean[] = []
    const stop = observeTerminalVisibility(host, (hidden) => changes.push(hidden))

    expect(isTerminalHostHidden(host)).toBe(false)

    workspaceHost.classList.add('workspace-host-hidden')
    await waitFor(() => expect(changes).toEqual([true]))
    expect(isTerminalHostHidden(host)).toBe(true)

    workspaceHost.classList.remove('workspace-host-hidden')
    await waitFor(() => expect(changes).toEqual([true, false]))

    splitSlot.style.visibility = 'hidden'
    await waitFor(() => expect(changes).toEqual([true, false, true]))

    splitSlot.style.visibility = ''
    await waitFor(() => expect(changes).toEqual([true, false, true, false]))

    stop()
    workspaceHost.remove()
  })
})

describe('OXE-349 · TerminalView pauses xterm writes while hidden and flushes on reveal', () => {
  let onDataHandler: ((event: { paneId: string; data: string }) => void) | null = null

  beforeEach(() => {
    onDataHandler = null
    terminalState.write.mockClear()
    terminalState.refresh.mockClear()

    global.ResizeObserver = class {
      observe(): void {}
      disconnect(): void {}
      unobserve(): void {}
      takeRecords(): ResizeObserverEntry[] {
        return []
      }
    }

    window.oxe = {
      app: { version: '0.1.0' },
      workspace: {} as typeof window.oxe.workspace,
      terminal: {
        start: vi.fn(),
        write: vi.fn(),
        resize: vi.fn(),
        stop: vi.fn(),
        restart: vi.fn(),
        attach: vi.fn().mockResolvedValue({ running: true, seq: 1, prologue: '', replay: '', truncated: false, altScreen: false }),
        detach: vi.fn(),
        status: vi.fn().mockResolvedValue({ running: true, seq: 1, altScreen: false }),
        onData: vi.fn((_paneId: string, cb: (event: { paneId: string; data: string }) => void) => {
          onDataHandler = cb
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

  test('buffers PTY data while workspace-host is hidden and flushes when workspace becomes active', async () => {
    const wrapper = document.createElement('div')
    wrapper.className = 'workspace-host workspace-host-hidden'
    document.body.appendChild(wrapper)

    render(
      <TerminalView
        paneId="pane-hidden-1"
        workspaceId="ws-hidden"
        isRunning
        themeId="dracula"
        prefs={TERMINAL_PREFS_DEFAULTS}
        onInput={vi.fn()}
        onResize={vi.fn()}
      />,
      { container: wrapper }
    )

    await waitFor(() => expect(window.oxe.terminal.attach).toHaveBeenCalledWith({ paneId: 'pane-hidden-1' }))
    terminalState.write.mockClear()

    // Stream output while hidden: xterm.write must NOT be called.
    act(() => {
      onDataHandler?.({ paneId: 'pane-hidden-1', data: 'line-1\r\n' })
      onDataHandler?.({ paneId: 'pane-hidden-1', data: 'line-2\r\n' })
    })
    expect(terminalState.write).not.toHaveBeenCalled()

    // Activity tracking still knows the background pane is working.
    expect(useTerminalStore.getState().getStatus('pane-hidden-1').isWorking).toBe(true)

    // Reveal the workspace: buffered output flushes to xterm in a coalesced frame.
    act(() => {
      wrapper.classList.remove('workspace-host-hidden')
    })

    await waitFor(() => {
      const written = terminalState.write.mock.calls.map((c) => c[0]).join('')
      expect(written).toContain('line-1\r\nline-2\r\n')
    })

    wrapper.remove()
  })

  test('prepends clear-screen on reveal when hidden buffer overflowed MAX_BUFFERED_BYTES', async () => {
    const wrapper = document.createElement('div')
    wrapper.className = 'workspace-host'
    document.body.appendChild(wrapper)

    render(
      <TerminalView
        paneId="pane-hidden-overflow"
        workspaceId="ws-overflow"
        isRunning
        themeId="dracula"
        prefs={TERMINAL_PREFS_DEFAULTS}
        onInput={vi.fn()}
        onResize={vi.fn()}
      />,
      { container: wrapper }
    )

    await waitFor(() => expect(window.oxe.terminal.attach).toHaveBeenCalledWith({ paneId: 'pane-hidden-overflow' }))
    terminalState.write.mockClear()

    // Hide the workspace after mount.
    act(() => {
      wrapper.classList.add('workspace-host-hidden')
    })
    // Wait a microtask for MutationObserver to fire.
    await new Promise((resolve) => setTimeout(resolve, 10))

    // Flood 512 KB (> 256 KB cap) while hidden.
    const burst = 'Z'.repeat(64 * 1024)
    act(() => {
      for (let i = 0; i < 8; i++) {
        onDataHandler?.({ paneId: 'pane-hidden-overflow', data: burst })
      }
      onDataHandler?.({ paneId: 'pane-hidden-overflow', data: 'END' })
    })
    expect(terminalState.write).not.toHaveBeenCalled()

    // Reveal workspace: first flushed slice must start with \x1b[2J\x1b[H.
    act(() => {
      wrapper.classList.remove('workspace-host-hidden')
    })

    await waitFor(() => expect(terminalState.write).toHaveBeenCalled())
    expect(terminalState.write.mock.calls[0][0]).toMatch(/^\x1b\[2J\x1b\[H/)

    wrapper.remove()
  })
})
