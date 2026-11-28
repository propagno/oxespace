import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IDisposable, IPty } from 'node-pty'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  ORIGIN_BATCH_MAX_BYTES,
  ORIGIN_BATCH_MS,
  PtyOriginBatcher
} from '../../electron/main/workers/ptyOriginBatcher'
import {
  FLOW_CONTROL_HIGH_WATERMARK,
  FLOW_CONTROL_LOW_WATERMARK,
  FLOW_CONTROL_WATCHDOG_MS,
  PtyFlowControl
} from '../../electron/main/workers/ptyFlowControl'
import { createPtyHostRuntime } from '../../electron/main/workers/pty-host'
import { createPtyDaemonServer } from '../../electron/main/workers/pty-daemon'
import { DaemonPtyClient } from '../../electron/main/services/terminal/daemon-pty'
import { generateDaemonToken } from '../../electron/main/services/terminal/pty-daemon-protocol'
import type { PtyHostEvent, PtyHostRequest } from '../../electron/main/services/terminal/pty-host-protocol'
import { HostedPty, utilityPtyModule, type PtyHostProcess } from '../../electron/main/services/terminal/utility-pty'
import { SessionOutput, type TerminalSession } from '../../electron/main/services/terminal/session-output'
import { PtyInputQueue } from '../../electron/main/services/pty-input-queue'
import { PtyOutputBatcher } from '../../electron/main/services/pty-output-batcher'
import { PtyRingBuffer } from '../../electron/main/services/pty-ring-buffer'
import { PtyModeTracker } from '../../electron/main/services/pty-mode-tracker'
import { Da1Filter } from '../../electron/main/services/pty-da1'
import { parseTerminalAckInput } from '../../electron/main/ipc/validation'
import { createOxeApi, type PreloadIpc } from '../../electron/preload/api'
import { IPC_CHANNELS } from '../../shared/types/ipc'
import {
  CHAR_COUNT_ACK_SIZE,
  createTerminalAckBatcher
} from '../../src/components/Terminal/terminalFlowControlAck'

interface FakeNodePty {
  pty: IPty
  pause: ReturnType<typeof vi.fn>
  resume: ReturnType<typeof vi.fn>
  resize: ReturnType<typeof vi.fn>
  write: ReturnType<typeof vi.fn>
  kill: ReturnType<typeof vi.fn>
  emitData: (data: string) => void
  emitExit: (exitCode: number, signal?: number) => void
}

function createFakeNodePty(pid = 1001): FakeNodePty {
  const dataListeners = new Set<(data: string) => void>()
  const exitListeners = new Set<(e: { exitCode: number; signal?: number }) => void>()
  const pause = vi.fn()
  const resume = vi.fn()
  const resize = vi.fn()
  const write = vi.fn()
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
    write,
    resize,
    clear: vi.fn(),
    kill,
    pause,
    resume
  }

  return {
    pty,
    pause,
    resume,
    resize,
    write,
    kill,
    emitData(data: string) {
      for (const listener of dataListeners) listener(data)
    },
    emitExit(exitCode: number, signal?: number) {
      for (const listener of exitListeners) listener({ exitCode, ...(signal !== undefined ? { signal } : {}) })
    }
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('OXE-483 · Origin 5ms / 32KiB PTY batcher', () => {
  test('coalesces burst chunks within 5ms while preserving order', () => {
    vi.useFakeTimers()
    const flushed: string[] = []
    const batcher = new PtyOriginBatcher({ onFlush: data => flushed.push(data) })

    expect(ORIGIN_BATCH_MS).toBe(5)
    expect(ORIGIN_BATCH_MAX_BYTES).toBe(32 * 1024)

    batcher.push('alpha ')
    batcher.push('beta ')
    batcher.push('gamma')
    expect(flushed).toEqual([])
    expect(batcher.pendingLength()).toBe(16)

    vi.advanceTimersByTime(ORIGIN_BATCH_MS - 1)
    expect(flushed).toEqual([])

    vi.advanceTimersByTime(1)
    expect(flushed).toEqual(['alpha beta gamma'])
    expect(batcher.pendingLength()).toBe(0)
    batcher.dispose()
  })

  test('flushes synchronously as soon as pending bytes reach 32 KiB', () => {
    vi.useFakeTimers()
    const flushed: string[] = []
    const batcher = new PtyOriginBatcher({ onFlush: data => flushed.push(data) })

    const half = 'A'.repeat(16 * 1024)
    const rest = 'B'.repeat(16 * 1024)
    batcher.push(half)
    expect(flushed).toEqual([])

    batcher.push(rest)
    expect(flushed).toEqual([half + rest])
    expect(batcher.pendingLength()).toBe(0)

    // No duplicate flush when the timer window elapses.
    vi.advanceTimersByTime(ORIGIN_BATCH_MS * 2)
    expect(flushed).toHaveLength(1)
    batcher.dispose()
  })

  test('flushes synchronously before resize/exit and cleans up timers on dispose', () => {
    vi.useFakeTimers()
    const flushed: string[] = []
    const batcher = new PtyOriginBatcher({ onFlush: data => flushed.push(data) })

    batcher.push('before-resize')
    batcher.flush()
    expect(flushed).toEqual(['before-resize'])
    vi.advanceTimersByTime(ORIGIN_BATCH_MS * 2)
    expect(flushed).toHaveLength(1)

    batcher.push('dropped-on-dispose')
    batcher.dispose()
    vi.advanceTimersByTime(ORIGIN_BATCH_MS * 2)
    expect(flushed).toHaveLength(1)
    expect(batcher.pendingLength()).toBe(0)
  })
})

describe('OXE-483 · End-to-end node-pty watermark flow controller', () => {
  test('pauses above 100k unacked chars, stays paused until <= 5k, and clamps at 0', () => {
    vi.useFakeTimers()
    const target = { pause: vi.fn(), resume: vi.fn() }
    const fc = new PtyFlowControl(target, { attached: true })

    expect(FLOW_CONTROL_HIGH_WATERMARK).toBe(100_000)
    expect(FLOW_CONTROL_LOW_WATERMARK).toBe(5_000)

    fc.onData(100_000)
    expect(target.pause).not.toHaveBeenCalled()
    expect(fc.isPaused).toBe(false)

    fc.onData(1)
    expect(target.pause).toHaveBeenCalledTimes(1)
    expect(fc.isPaused).toBe(true)

    // Additional data arriving while already paused does not double-pause.
    fc.onData(9_999)
    expect(target.pause).toHaveBeenCalledTimes(1)
    expect(fc.unacknowledgedChars).toBe(110_000)

    // ACK down to 5_001 -> must stay paused.
    fc.ack(104_999)
    expect(fc.unacknowledgedChars).toBe(5_001)
    expect(target.resume).not.toHaveBeenCalled()
    expect(fc.isPaused).toBe(true)

    // ACK 1 more -> 5_000 <= LOW_WATERMARK -> resumes cleanly!
    fc.ack(1)
    expect(fc.unacknowledgedChars).toBe(5_000)
    expect(target.resume).toHaveBeenCalledTimes(1)
    expect(fc.isPaused).toBe(false)

    // Over-ACK clamps cleanly at 0.
    fc.ack(50_000)
    expect(fc.unacknowledgedChars).toBe(0)
    fc.dispose()
  })

  test('never deadlocks detached/hidden/parked panes: unattached never pauses and detach immediately resets + resumes', () => {
    vi.useFakeTimers()
    const target = { pause: vi.fn(), resume: vi.fn() }
    const fc = new PtyFlowControl(target) // defaults to attached=false

    // Background agent with no renderer view pumps 500k chars -> never paused.
    fc.onData(500_000)
    expect(target.pause).not.toHaveBeenCalled()
    expect(fc.isPaused).toBe(false)
    expect(fc.unacknowledgedChars).toBe(0)

    // Attach renderer, flood past high watermark -> pauses.
    fc.setAttached(true)
    fc.onData(120_000)
    expect(target.pause).toHaveBeenCalledTimes(1)
    expect(fc.isPaused).toBe(true)

    // Pane detaches/parks -> immediately resets unacked to 0 and resumes!
    fc.setAttached(false)
    expect(fc.isPaused).toBe(false)
    expect(fc.unacknowledgedChars).toBe(0)
    expect(target.resume).toHaveBeenCalledTimes(1)

    // Further background output while detached never pauses again.
    fc.onData(300_000)
    expect(target.pause).toHaveBeenCalledTimes(1)
    fc.dispose()
  })

  test('safety watchdog force-resumes stalled PTY after 5s without ACKs, and resets when partial ACKs arrive', () => {
    vi.useFakeTimers()
    const target = { pause: vi.fn(), resume: vi.fn() }
    const onWatchdogResume = vi.fn()
    const fc = new PtyFlowControl(target, { attached: true, onWatchdogResume })

    fc.onData(120_000)
    expect(fc.isPaused).toBe(true)

    // Partial progress at 4s keeps watchdog alive without premature resume.
    vi.advanceTimersByTime(4_000)
    fc.ack(5_000)
    expect(target.resume).not.toHaveBeenCalled()

    vi.advanceTimersByTime(4_000)
    expect(target.resume).not.toHaveBeenCalled()

    // No ACKs for full watchdog interval (5s since last ACK) -> force resume!
    vi.advanceTimersByTime(FLOW_CONTROL_WATCHDOG_MS - 4_000)
    expect(target.resume).toHaveBeenCalledTimes(1)
    expect(onWatchdogResume).toHaveBeenCalledWith(115_000)
    expect(fc.isPaused).toBe(false)
    expect(fc.unacknowledgedChars).toBe(0)
    fc.dispose()
  })
})

describe('OXE-483 · pty-host runtime batching, ordering, and flow control', () => {
  test('batches burst chunks over 5ms, flushes synchronously before resize and exit, and enforces watermarks + ACKs', () => {
    vi.useFakeTimers()
    const events: PtyHostEvent[] = []
    const order: string[] = []
    const fake = createFakeNodePty(4242)
    fake.resize.mockImplementation((cols: number, rows: number) => {
      order.push(`resize:${cols}x${rows}`)
    })

    const runtime = createPtyHostRuntime(
      event => {
        events.push(event)
        if (event.t === 'data') order.push(`data:${event.data}`)
        if (event.t === 'exit') order.push(`exit:${event.exitCode}`)
      },
      () => fake.pty
    )

    runtime.handle({ t: 'spawn', id: 1, file: 'pwsh', args: [], options: { cols: 80, rows: 24 } })

    // Coalesce burst within 5ms.
    fake.emitData('one-')
    fake.emitData('two-')
    fake.emitData('three')
    expect(events.filter(e => e.t === 'data')).toHaveLength(0)
    vi.advanceTimersByTime(ORIGIN_BATCH_MS)
    expect(events.filter(e => e.t === 'data')).toEqual([{ t: 'data', id: 1, data: 'one-two-three' }])

    // Ordering before resize: pending chunk MUST flush synchronously before pty.resize().
    order.length = 0
    fake.emitData('pre-resize')
    runtime.handle({ t: 'resize', id: 1, cols: 120, rows: 40 })
    expect(order).toEqual(['data:pre-resize', 'resize:120x40'])

    // Flow control: enable, flood >100k -> pause, ACK down to <=5k -> resume.
    runtime.handle({ t: 'flow-control', id: 1, enabled: true })
    fake.emitData('X'.repeat(60_000))
    fake.emitData('Y'.repeat(50_000))
    expect(fake.pause).toHaveBeenCalledTimes(1)

    runtime.handle({ t: 'ack', id: 1, chars: 105_000 })
    expect(fake.resume).toHaveBeenCalledTimes(1)

    // Flood again, then disable flow-control (detach/park) -> immediate resume without deadlock.
    fake.emitData('Z'.repeat(110_000))
    expect(fake.pause).toHaveBeenCalledTimes(2)
    runtime.handle({ t: 'flow-control', id: 1, enabled: false })
    expect(fake.resume).toHaveBeenCalledTimes(2)

    // Ordering before exit: trailing data MUST flush before exit event.
    order.length = 0
    fake.emitData('final-words')
    fake.emitExit(0)
    expect(order).toEqual(['data:final-words', 'exit:0'])
    runtime.dispose()
  })
})

describe('OXE-483 · pty-daemon origin batching and synchronous flush ordering', () => {
  const cleanups: Array<() => Promise<void> | void> = []

  afterEach(async () => {
    for (const fn of cleanups.splice(0).reverse()) await fn()
  })

  test('coalesces burst chunks into a single daemon data event and flushes before exit', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'oxe483-daemon-'))
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    const endpoint = process.platform === 'win32'
      ? `\\\\.\\pipe\\oxespace-pty-oxe483-${randomUUID()}`
      : join(dir, 'oxespace-pty.sock')
    const token = generateDaemonToken()

    let fake: FakeNodePty | null = null
    const server = createPtyDaemonServer({
      endpoint,
      token,
      pty: {
        spawn: () => {
          fake = createFakeNodePty(5150)
          return fake.pty
        }
      }
    })
    await server.listen()
    cleanups.push(() => server.close())

    const client = new DaemonPtyClient({ endpoint, token })
    await client.connect()
    cleanups.push(() => client.detachClient())

    await client.spawnSession({
      sessionId: 'daemon-batch-1',
      file: 'pwsh',
      args: [],
      cwd: dir,
      cols: 80,
      rows: 24
    })
    const attached = await client.attachSession('daemon-batch-1')
    const received: string[] = []
    let exitedCode: number | null = null
    attached.pty.onData(chunk => received.push(chunk))
    attached.pty.onExit(ev => { exitedCode = ev.exitCode })

    // Emit 10 rapid tiny chunks synchronously — daemon origin batcher coalesces them into 1 frame.
    for (let i = 0; i < 10; i++) fake!.emitData(`c${i}|`)
    await new Promise(resolve => setTimeout(resolve, 40))
    expect(received).toEqual(['c0|c1|c2|c3|c4|c5|c6|c7|c8|c9|'])

    // Trailing chunk right before exit must arrive before exit completes.
    fake!.emitData('goodbye-tail')
    fake!.emitExit(0)
    await new Promise(resolve => setTimeout(resolve, 40))
    expect(received.join('')).toContain('goodbye-tail')
    expect(exitedCode).toBe(0)
  })
})

describe('OXE-483 · HostedPty, SessionOutput, Preload & IPC validation plumbing', () => {
  test('HostedPty forwards handleFlowControl and ackData, and SessionOutput auto-resumes on detach/park', () => {
    const sent: PtyHostRequest[] = []
    const fakeHost: PtyHostProcess = {
      postMessage: req => sent.push(req),
      onMessage: () => undefined,
      onExit: () => undefined,
      kill: () => undefined
    }
    const mod = utilityPtyModule(() => fakeHost)
    const hosted = mod.spawn('pwsh', [], { cols: 80, rows: 24 }) as HostedPty

    const sessions = new Map<string, TerminalSession>()
    const output = new SessionOutput({
      sessions,
      takeExited: () => undefined,
      scanShellCwd: () => undefined,
      emitData: () => undefined,
      emitActivity: () => undefined
    })

    const session: TerminalSession = {
      sessionId: 's-1',
      launchDirectory: '/tmp',
      executable: 'pwsh',
      startedAt: Date.now(),
      paneId: 'pane-fc',
      workspaceId: 'ws-1',
      pty: hosted,
      inputQueue: new PtyInputQueue(hosted),
      outputBatcher: new PtyOutputBatcher('pane-fc', () => undefined),
      ring: new PtyRingBuffer(),
      modes: new PtyModeTracker(),
      attached: true,
      viewAttached: false,
      da1: new Da1Filter(),
      da1Timer: null,
      lastActivityAt: Date.now(),
      cols: 80,
      rows: 24,
      activityNotifiedAt: 0
    }
    sessions.set('pane-fc', session)

    // Attach enables flow control on HostedPty.
    output.attach({ paneId: 'pane-fc' })
    expect(hosted.handleFlowControl).toBe(true)
    expect(sent).toContainEqual({ t: 'flow-control', id: 1, enabled: true })

    // ACK forwards through SessionOutput -> HostedPty -> pty-host protocol.
    output.ack('pane-fc', 5_000)
    expect(sent).toContainEqual({ t: 'ack', id: 1, chars: 5_000 })

    // Detach (parked) disables flow control so hidden pane can never deadlock.
    output.detach({ paneId: 'pane-fc', parked: true })
    expect(hosted.handleFlowControl).toBe(false)
    expect(sent).toContainEqual({ t: 'flow-control', id: 1, enabled: false })
  })

  test('in-process IPty fallback (OXESPACE_PTY_HOST=main) enforces flow control and auto-resumes on parked detach', () => {
    const fake = createFakeNodePty(8888)
    const sessions = new Map<string, TerminalSession>()
    const output = new SessionOutput({
      sessions,
      takeExited: () => undefined,
      scanShellCwd: () => undefined,
      emitData: () => undefined,
      emitActivity: () => undefined
    })

    const session: TerminalSession = {
      sessionId: 's-main',
      launchDirectory: '/tmp',
      executable: 'pwsh',
      startedAt: Date.now(),
      paneId: 'pane-main',
      workspaceId: 'ws-1',
      pty: fake.pty,
      inputQueue: new PtyInputQueue(fake.pty),
      outputBatcher: new PtyOutputBatcher('pane-main', () => undefined),
      ring: new PtyRingBuffer(),
      modes: new PtyModeTracker(),
      attached: true,
      viewAttached: false,
      da1: new Da1Filter(),
      da1Timer: null,
      lastActivityAt: Date.now(),
      cols: 80,
      rows: 24,
      activityNotifiedAt: 0
    }
    sessions.set('pane-main', session)

    // Before attach: background output never pauses.
    output.receive(session, 'A'.repeat(150_000))
    expect(fake.pause).not.toHaveBeenCalled()

    // Attach -> heavy output pauses -> parked detach immediately resumes!
    output.attach({ paneId: 'pane-main' })
    output.receive(session, 'B'.repeat(105_000))
    expect(fake.pause).toHaveBeenCalledTimes(1)

    output.detach({ paneId: 'pane-main', parked: true })
    expect(fake.resume).toHaveBeenCalledTimes(1)
    output.cleanup(session)
  })

  test('preload exposes terminal.ack(paneId, chars) and validation checks arguments', async () => {
    const ipc: PreloadIpc = {
      invoke: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      removeListener: vi.fn()
    }
    const api = createOxeApi(ipc)
    await api.terminal.ack?.('pane-1', 5_000)
    expect(ipc.invoke).toHaveBeenCalledWith(IPC_CHANNELS.terminal.ack, 'pane-1', 5_000)

    expect(parseTerminalAckInput('pane-1', 5_000)).toEqual({ paneId: 'pane-1', chars: 5_000 })
    expect(() => parseTerminalAckInput('', 5_000)).toThrow('paneId')
    expect(() => parseTerminalAckInput('pane-1', 0)).toThrow('chars')
    expect(() => parseTerminalAckInput('pane-1', -10)).toThrow('chars')
  })
})

describe('OXE-483 · Renderer ACK batcher', () => {
  test('batches parsed characters at 5,000-char threshold and flushes remaining on detach/unmount', () => {
    const sendAck = vi.fn().mockResolvedValue(undefined)
    const batcher = createTerminalAckBatcher({ paneId: 'pane-ui', sendAck })

    expect(CHAR_COUNT_ACK_SIZE).toBe(5_000)

    batcher.record(2_000)
    batcher.record(2_999)
    expect(sendAck).not.toHaveBeenCalled()
    expect(batcher.pending()).toBe(4_999)

    batcher.record(1)
    expect(sendAck).toHaveBeenCalledTimes(1)
    expect(sendAck).toHaveBeenCalledWith('pane-ui', 5_000)
    expect(batcher.pending()).toBe(0)

    batcher.record(1_234)
    expect(sendAck).toHaveBeenCalledTimes(1)
    batcher.flush()
    expect(sendAck).toHaveBeenCalledTimes(2)
    expect(sendAck).toHaveBeenLastCalledWith('pane-ui', 1_234)
    expect(batcher.pending()).toBe(0)
  })

  test('tolerates missing or rejecting sendAck in legacy test mocks without throwing', () => {
    const missing = createTerminalAckBatcher({ paneId: 'pane-legacy' })
    expect(() => {
      missing.record(10_000)
      missing.flush()
    }).not.toThrow()

    const failing = createTerminalAckBatcher({
      paneId: 'pane-fail',
      sendAck: () => Promise.reject(new Error('ipc closed'))
    })
    expect(() => {
      failing.record(6_000)
      failing.flush()
    }).not.toThrow()
  })
})
