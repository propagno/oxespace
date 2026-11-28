import { MessageChannel as WorkerMessageChannel } from 'node:worker_threads'
import type { IDisposable, IPty } from 'node-pty'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createPtyHostRuntime } from '../../electron/main/workers/pty-host'
import type { DirectPortLike } from '../../electron/main/workers/ptyDirectPort'
import type { PtyHostEvent, PtyHostRequest } from '../../electron/main/services/terminal/pty-host-protocol'
import { HostedPty, utilityPtyModule, type PtyHostProcess } from '../../electron/main/services/terminal/utility-pty'
import { SessionOutput, type TerminalSession } from '../../electron/main/services/terminal/session-output'
import { PtyInputQueue } from '../../electron/main/services/pty-input-queue'
import { PtyOutputBatcher } from '../../electron/main/services/pty-output-batcher'
import { PtyRingBuffer } from '../../electron/main/services/pty-ring-buffer'
import { PtyModeTracker } from '../../electron/main/services/pty-mode-tracker'
import { Da1Filter } from '../../electron/main/services/pty-da1'
import { createOxeApi, type PreloadIpc } from '../../electron/preload/api'
import { IPC_CHANNELS, type TerminalDataEvent } from '../../shared/types/ipc'
import { TERMINAL_PTY_PORT_CHANNEL } from '../../shared/types/ipc/terminal'

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

function createFakeNodePty(pid = 2001): FakeNodePty {
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
    emitData(data: string) { for (const l of dataListeners) l(data) },
    emitExit(exitCode: number, signal?: number) {
      for (const l of exitListeners) l({ exitCode, ...(signal !== undefined ? { signal } : {}) })
    }
  }
}

interface FakePreloadBus {
  ipc: PreloadIpc
  invoke: ReturnType<typeof vi.fn>
  emitIpc: (channel: string, payload: unknown, ports?: unknown[]) => void
}

function createFakePreloadBus(handlers: Record<string, (...args: unknown[]) => unknown> = {}): FakePreloadBus {
  const channelListeners = new Map<string, Set<(event: unknown, payload: unknown) => void>>()
  const invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
    const fn = handlers[channel]
    return fn ? fn(...args) : undefined
  })
  const ipc: PreloadIpc = {
    invoke,
    on(channel, listener) {
      let set = channelListeners.get(channel)
      if (!set) { set = new Set(); channelListeners.set(channel, set) }
      set.add(listener as (event: unknown, payload: unknown) => void)
    },
    removeListener(channel, listener) {
      channelListeners.get(channel)?.delete(listener as (event: unknown, payload: unknown) => void)
    }
  }
  return {
    ipc,
    invoke,
    emitIpc(channel: string, payload: unknown, ports: unknown[] = []) {
      const event = { ports }
      for (const listener of [...(channelListeners.get(channel) ?? [])]) {
        listener(event, payload)
      }
    }
  }
}

function createSession(paneId: string, pty: IPty, output: SessionOutput): TerminalSession {
  return {
    sessionId: `sess-${paneId}`,
    launchDirectory: '/tmp',
    executable: 'pwsh',
    startedAt: Date.now(),
    paneId,
    workspaceId: 'ws-1',
    pty,
    directHostId: pty instanceof HostedPty ? pty.hostSessionId : undefined,
    inputQueue: new PtyInputQueue(pty),
    outputBatcher: new PtyOutputBatcher(paneId, (ev) => output.onBatch(ev), 5),
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
}

async function flushMicrotasks(ms = 25): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms))
}

async function waitFor(condition: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for condition')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

/** Wires a full in-memory pty-host runtime <-> utilityPtyModule <-> SessionOutput <-> Preload API harness using real MessageChannels. */
function createEndToEndHarness(options: { highWatermark?: number; lowWatermark?: number; batchMs?: number } = {}) {
  const fakes: FakeNodePty[] = []
  const runtimes: ReturnType<typeof createPtyHostRuntime>[] = []
  const mainIpcEmitted: TerminalDataEvent[] = []
  const observerChunks: Array<{ paneId: string; data: string }> = []
  const outputNotified: string[] = []
  const openPorts: Array<{ close?: () => void }> = []

  const sessions = new Map<string, TerminalSession>()
  const output = new SessionOutput({
    sessions,
    takeExited: () => undefined,
    scanShellCwd: () => undefined,
    emitData: (ev) => {
      mainIpcEmitted.push(ev)
      preloadBus.emitIpc(IPC_CHANNELS.terminal.onData, ev)
    },
    emitActivity: () => undefined
  })
  output.onOutput(paneId => outputNotified.push(paneId))

  const preloadBus = createFakePreloadBus({
    [IPC_CHANNELS.terminal.attach]: (input) => output.attach(input as { paneId: string; sinceSeq?: number }),
    [IPC_CHANNELS.terminal.detach]: (input) => output.detach(input as { paneId: string; parked?: boolean }),
    [IPC_CHANNELS.terminal.ack]: (paneId, chars) => output.ack(String(paneId), Number(chars))
  })
  const api = createOxeApi(preloadBus.ipc, undefined, { listenPortChannel: true })

  const mod = utilityPtyModule(() => {
    let messageCb: (event: PtyHostEvent) => void = () => undefined
    let exitCb: (code: number) => void = () => undefined
    const runtime = createPtyHostRuntime(
      (ev) => messageCb(ev),
      () => {
        const fake = createFakeNodePty(3000 + fakes.length)
        fakes.push(fake)
        return fake.pty
      },
      {
        batchMs: options.batchMs ?? 1,
        highWatermark: options.highWatermark,
        lowWatermark: options.lowWatermark
      }
    )
    runtimes.push(runtime)
    const proc: PtyHostProcess & { triggerExit: (code: number) => void } = {
      postMessage(request: PtyHostRequest, transfer?: unknown[]) {
        runtime.handle(request, transfer as DirectPortLike[] | undefined)
      },
      onMessage(cb) { messageCb = cb },
      onExit(cb) { exitCb = cb },
      kill() { runtime.dispose() },
      triggerExit(code: number) {
        runtime.dispose()
        exitCb(code)
      }
    }
    return proc
  })

  function attachRendererWindow(windowId = 1, targetBus = preloadBus) {
    return mod.attachWindow!(
      windowId,
      (port2) => targetBus.emitIpc(TERMINAL_PTY_PORT_CHANNEL, { windowId }, [port2]),
      () => {
        const ch = new WorkerMessageChannel()
        openPorts.push(ch.port1, ch.port2)
        return { port1: ch.port1, port2: ch.port2 }
      }
    )
  }

  function spawnPane(paneId: string) {
    const pty = mod.spawn('pwsh', [], { cols: 80, rows: 24 }) as HostedPty
    pty.bindPane(paneId)
    const session = createSession(paneId, pty, output)
    sessions.set(paneId, session)
    pty.onData((data) => {
      output.receive(session, data, pty.lastDataMeta)
      observerChunks.push({ paneId, data })
    })
    const fake = fakes[fakes.length - 1]
    return { pty, session, fake }
  }

  function cleanup() {
    mod.dispose()
    for (const p of openPorts) { try { p.close?.() } catch { /* closed */ } }
  }

  return {
    mod,
    output,
    sessions,
    preloadBus,
    api,
    fakes,
    runtimes,
    mainIpcEmitted,
    observerChunks,
    outputNotified,
    attachRendererWindow,
    spawnPane,
    cleanup
  }
}

const cleanups: Array<() => void> = []

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  for (const fn of cleanups.splice(0).reverse()) fn()
})

describe('OXE-488 · Direct MessagePort ptyHost <-> Renderer', () => {
  test('1. delivers live PTY output directly over real MessageChannel with monotonic seq, zero Main IPC fan-out, and zero duplicates', async () => {
    const h = createEndToEndHarness()
    cleanups.push(() => h.cleanup())

    const detachWin = h.attachRendererWindow(1)
    cleanups.push(detachWin)

    const { fake } = h.spawnPane('pane-1')
    const received: TerminalDataEvent[] = []
    const unsub = h.api.terminal.onData('pane-1', ev => received.push(ev))
    cleanups.push(unsub)

    const attached = await h.api.terminal.attach({ paneId: 'pane-1' })
    expect(attached.running).toBe(true)
    expect(attached.ptyId).toBe(1)

    // Emit 3 distinct batches after attach; each should arrive directly over MessagePort.
    fake.emitData('alpha-')
    await waitFor(() => received.length >= 1)
    fake.emitData('beta-')
    await waitFor(() => received.length >= 2)
    fake.emitData('gamma')
    await waitFor(() => received.length >= 3)

    expect(received.map(r => r.data)).toEqual(['alpha-', 'beta-', 'gamma'])
    expect(received.map(r => r.seq)).toEqual([1, 2, 3])
    // CRITICAL: Main NEVER emitted terminal:data over IPC on the hot path!
    expect(h.mainIpcEmitted).toHaveLength(0)

    // Verify diagnostics confirm direct MessagePort transport is active.
    const stats = h.api.terminal.getTransportStats!()
    expect(stats.transport).toBe('message-port')
    expect(stats.portConnected).toBe(true)
    expect(stats.directFrames).toBe(3)
    expect(stats.directBytes).toBe('alpha-beta-gamma'.length)
    expect(stats.fallbackFrames).toBe(0)
    expect(stats.dedupedFrames).toBe(0)

    const hostStats = h.runtimes[0].directPortStats()
    expect(hostStats.connectedPorts).toBe(1)
    expect(hostStats.directFrames).toBe(3)
    expect(hostStats.directBytes).toBe('alpha-beta-gamma'.length)

    // Simulate duplicate delivery arriving on IPC fallback with an already-delivered seq -> MUST be dropped!
    h.preloadBus.emitIpc(IPC_CHANNELS.terminal.onData, { paneId: 'pane-1', ptyId: 1, seq: 2, data: 'beta-' })
    h.preloadBus.emitIpc(IPC_CHANNELS.terminal.onData, { paneId: 'pane-1', ptyId: 1, seq: 3, data: 'gamma' })
    expect(received.map(r => r.data)).toEqual(['alpha-', 'beta-', 'gamma'])
    expect(h.api.terminal.getTransportStats!().dedupedFrames).toBe(2)

    // Simulate attach transition overtake: port frame seq=5 arrives BEFORE in-flight IPC frame seq=4.
    const channel = new WorkerMessageChannel()
    cleanups.push(() => { channel.port1.close(); channel.port2.close() })
    h.preloadBus.emitIpc(TERMINAL_PTY_PORT_CHANNEL, { windowId: 1 }, [channel.port2])
    channel.port1.postMessage({ t: 'data', paneId: 'pane-1', ptyId: 1, seq: 5, data: 'fifth' })
    await flushMicrotasks(10)
    // Held briefly while waiting for seq=4!
    expect(received.map(r => r.data)).toEqual(['alpha-', 'beta-', 'gamma'])
    // Now seq=4 arrives over IPC -> delivers seq=4 then immediately drains seq=5 in strict FIFO order!
    h.preloadBus.emitIpc(IPC_CHANNELS.terminal.onData, { paneId: 'pane-1', ptyId: 1, seq: 4, data: 'fourth-' })
    expect(received.map(r => r.data)).toEqual(['alpha-', 'beta-', 'gamma', 'fourth-', 'fifth'])
    expect(h.api.terminal.getTransportStats!().reorderedFrames).toBe(1)
  })

  test('2. runs 100k/5k flow-control ACK loop directly over MessagePort bypassing Main IPC without deadlock', async () => {
    const h = createEndToEndHarness({ highWatermark: 100_000, lowWatermark: 5_000 })
    cleanups.push(() => h.cleanup())

    const detachWin = h.attachRendererWindow(1)
    cleanups.push(detachWin)

    const { fake } = h.spawnPane('pane-fc')
    const received: TerminalDataEvent[] = []
    const unsub = h.api.terminal.onData('pane-fc', ev => received.push(ev))
    cleanups.push(unsub)

    await h.api.terminal.attach({ paneId: 'pane-fc' })
    h.preloadBus.invoke.mockClear()

    // Pump 110k chars (> 100k highWatermark) -> pty-host pauses node-pty!
    fake.emitData('A'.repeat(60_000))
    fake.emitData('B'.repeat(50_000))
    await waitFor(() => received.reduce((acc, ev) => acc + ev.data.length, 0) >= 110_000)

    expect(fake.pause).toHaveBeenCalledTimes(1)
    expect(fake.resume).not.toHaveBeenCalled()
    expect(received.reduce((acc, ev) => acc + ev.data.length, 0)).toBe(110_000)

    // Renderer sends ACKs directly over MessagePort (21 x 5,000 = 105,000 -> leaves 5,000 <= lowWatermark).
    for (let i = 0; i < 20; i++) h.api.terminal.ack?.('pane-fc', 5_000)
    await waitFor(() => h.runtimes[0].directPortStats().directAcks >= 20)
    // Still at 10,000 unacked (> 5,000) -> remains paused.
    expect(fake.resume).not.toHaveBeenCalled()

    h.api.terminal.ack?.('pane-fc', 5_000)
    await waitFor(() => fake.resume.mock.calls.length >= 1)
    // Now at 5,000 <= lowWatermark -> resumed cleanly!
    expect(fake.resume).toHaveBeenCalledTimes(1)

    // CRITICAL: Zero IPC `terminal:ack` calls crossed Electron Main!
    expect(h.preloadBus.invoke).not.toHaveBeenCalledWith(IPC_CHANNELS.terminal.ack, expect.anything(), expect.anything())
    expect(h.api.terminal.getTransportStats!().directAcks).toBe(21)
    expect(h.api.terminal.getTransportStats!().fallbackAcks).toBe(0)
    expect(h.runtimes[0].directPortStats().directAcks).toBe(21)

    // Non-direct pane (e.g. remote SSH pane) still falls back to IPC ACK cleanly.
    await h.api.terminal.ack?.('ssh-pane-1', 5_000)
    expect(h.preloadBus.invoke).toHaveBeenCalledWith(IPC_CHANNELS.terminal.ack, 'ssh-pane-1', 5_000)
    expect(h.api.terminal.getTransportStats!().fallbackAcks).toBe(1)
  })

  test('3. handles renderer reload / port disconnect & re-attach with sinceSeq replay, zero port leaks, and no flow-control deadlock', async () => {
    const h = createEndToEndHarness({ highWatermark: 100_000, lowWatermark: 5_000 })
    cleanups.push(() => h.cleanup())

    const detachFirst = h.attachRendererWindow(1)
    const { fake } = h.spawnPane('pane-reload')
    const firstReceived: TerminalDataEvent[] = []
    h.api.terminal.onData('pane-reload', ev => firstReceived.push(ev))
    await h.api.terminal.attach({ paneId: 'pane-reload' })

    // Pump enough data to pause the PTY via flow control.
    fake.emitData('1'.repeat(110_000))
    await waitFor(() => fake.pause.mock.calls.length >= 1)
    expect(fake.pause).toHaveBeenCalledTimes(1)
    expect(h.runtimes[0].directPortStats().connectedPorts).toBe(1)

    // Simulate renderer crash / disconnect: detaching last port MUST immediately resume paused PTY and drop port count to 0!
    detachFirst()
    expect(h.runtimes[0].directPortStats().connectedPorts).toBe(0)
    expect(fake.resume).toHaveBeenCalledTimes(1)

    // Output produced while renderer is reloading still accrues in Main's ring buffer!
    fake.emitData('during-reload-output')
    await waitFor(() => (h.output.peek('pane-reload')?.data ?? '').includes('during-reload-output'))

    // Reloaded renderer comes back with a fresh Preload API instance and a fresh MessageChannel.
    const reloadedBus = createFakePreloadBus({
      [IPC_CHANNELS.terminal.attach]: (input) => h.output.attach(input as { paneId: string; sinceSeq?: number }),
      [IPC_CHANNELS.terminal.detach]: (input) => h.output.detach(input as { paneId: string; parked?: boolean }),
      [IPC_CHANNELS.terminal.ack]: (paneId, chars) => h.output.ack(String(paneId), Number(chars))
    })
    const reloadedApi = createOxeApi(reloadedBus.ipc, undefined, { listenPortChannel: true })
    const detachSecond = h.attachRendererWindow(1, reloadedBus)
    cleanups.push(detachSecond)

    // Connected port count stays 1 (old port closed, no leak).
    expect(h.runtimes[0].directPortStats().connectedPorts).toBe(1)

    const secondReceived: TerminalDataEvent[] = []
    reloadedApi.terminal.onData('pane-reload', ev => secondReceived.push(ev))
    const reattached = await reloadedApi.terminal.attach({ paneId: 'pane-reload' })

    // Replay catches up with ALL output including what arrived while reloading!
    expect(reattached.running).toBe(true)
    expect(reattached.replay).toContain('during-reload-output')

    // Subsequent live output flows directly over the fresh MessagePort!
    fake.emitData('after-reload-live')
    await waitFor(() => secondReceived.length >= 1)
    expect(secondReceived.map(e => e.data)).toEqual(['after-reload-live'])
    expect(reloadedApi.terminal.getTransportStats!().transport).toBe('message-port')
    expect(reloadedApi.terminal.getTransportStats!().directFrames).toBe(1)
  })

  test('4. preserves parked panes, PtyRingBuffer, readSince, peek, and PaneScreen observer continuity while direct port is active', async () => {
    const h = createEndToEndHarness()
    cleanups.push(() => h.cleanup())

    const detachWin = h.attachRendererWindow(1)
    cleanups.push(detachWin)

    const { fake } = h.spawnPane('pane-obs')
    const received: TerminalDataEvent[] = []
    const unsub = h.api.terminal.onData('pane-obs', ev => received.push(ev))
    cleanups.push(unsub)

    await h.api.terminal.attach({ paneId: 'pane-obs' })
    fake.emitData('live-line-1\r\n')
    await waitFor(() => received.length >= 1)

    // Direct port delivered to Renderer while Main skipped webContents.send:
    expect(received.map(e => e.data)).toEqual(['live-line-1\r\n'])
    expect(h.mainIpcEmitted).toHaveLength(0)

    // Main's PtyRingBuffer, peek(), readSince(), onOutput, and PaneScreen/AgentState observer ALL received it!
    expect(h.output.peek('pane-obs')?.data).toBe('live-line-1\r\n')
    expect(h.output.readSince('pane-obs', 0)?.data).toBe('live-line-1\r\n')
    expect(h.observerChunks).toEqual([{ paneId: 'pane-obs', data: 'live-line-1\r\n' }])
    expect(h.outputNotified).toContain('pane-obs')

    // Park the pane (hidden workspace) -> detaches direct route and returns exact cursor!
    const detached = await h.api.terminal.detach({ paneId: 'pane-obs', parked: true })
    expect(detached).toBeDefined()
    const parkedSeq = detached!.seq

    // Output while parked accrues in ring & observer, and is NOT pushed to Renderer!
    fake.emitData('parked-line-2\r\n')
    await waitFor(() => (h.output.peek('pane-obs')?.data ?? '').includes('parked-line-2\r\n'))
    expect(received.map(e => e.data)).toEqual(['live-line-1\r\n'])
    expect(h.observerChunks.map(c => c.data).join('')).toBe('live-line-1\r\nparked-line-2\r\n')

    // Unpark with sinceSeq -> receives exact delta in replay, and resumes direct MessagePort streaming with 0ms delay!
    const unparked = await h.api.terminal.attach({ paneId: 'pane-obs', sinceSeq: parkedSeq })
    expect(unparked.running).toBe(true)
    expect(unparked.truncated).toBe(false)
    expect(unparked.replay).toBe('parked-line-2\r\n')

    fake.emitData('resumed-line-3\r\n')
    await waitFor(() => received.length >= 2)
    expect(received.map(e => e.data)).toEqual(['live-line-1\r\n', 'resumed-line-3\r\n'])
    expect(h.mainIpcEmitted).toHaveLength(0)
    expect(h.output.peek('pane-obs')?.data).toBe('live-line-1\r\nparked-line-2\r\nresumed-line-3\r\n')
  })

  test('5. gracefully falls back to Electron IPC when MessagePort is unavailable', async () => {
    const h = createEndToEndHarness()
    cleanups.push(() => h.cleanup())

    // Notice: NO attachRendererWindow() called — MessagePort is unavailable!
    const { fake } = h.spawnPane('pane-fallback')
    const received: TerminalDataEvent[] = []
    const unsub = h.api.terminal.onData('pane-fallback', ev => received.push(ev))
    cleanups.push(unsub)

    await h.api.terminal.attach({ paneId: 'pane-fallback' })
    fake.emitData('fallback-hello')
    await waitFor(() => received.length >= 1)

    // Delivered cleanly over Main IPC fallback!
    expect(received.map(e => e.data)).toEqual(['fallback-hello'])
    expect(h.mainIpcEmitted).toHaveLength(1)

    // ACKs fall back cleanly to IPC invoke.
    await h.api.terminal.ack?.('pane-fallback', 5_000)
    expect(h.preloadBus.invoke).toHaveBeenCalledWith(IPC_CHANNELS.terminal.ack, 'pane-fallback', 5_000)

    const stats = h.api.terminal.getTransportStats!()
    expect(stats.transport).toBe('ipc-fallback')
    expect(stats.portConnected).toBe(false)
    expect(stats.directFrames).toBe(0)
    expect(stats.fallbackFrames).toBe(1)
    expect(stats.fallbackBytes).toBe('fallback-hello'.length)
    expect(stats.fallbackAcks).toBe(1)

    const hostStats = h.runtimes[0].directPortStats()
    expect(hostStats.connectedPorts).toBe(0)
    expect(hostStats.directFrames).toBe(0)
    expect(hostStats.fallbackFrames).toBeGreaterThanOrEqual(1)
  })
})
