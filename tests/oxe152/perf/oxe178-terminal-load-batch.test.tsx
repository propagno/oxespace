// Unit test for 1.5.2 Desempenho · Windows renderer under terminal load (Jira OXE-178, RT-3).
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createTerminalWriteScheduler, IMMEDIATE_CHUNK_BYTES, MAX_BYTES_PER_FRAME } from '../../../src/components/Terminal/terminalWriteScheduler'
import { useTerminalStore } from '../../../src/store/terminal.store'

afterEach(() => {
  useTerminalStore.setState({ panes: {}, pendingCommands: {}, activePaneId: null })
  vi.restoreAllMocks()
})

describe('OXE-178 · Frame-paced backpressured terminal write scheduler & activity fast-path', () => {
  test('flushes small interactive chunks immediately with zero frame delay (key echo fast-path)', () => {
    const writes: string[] = []
    const frames: Array<() => void> = []
    const scheduler = createTerminalWriteScheduler({
      write: (chunk, done) => {
        writes.push(chunk)
        done()
      },
      scheduleFrame: (cb) => frames.push(cb),
      cancelFrame: vi.fn()
    })

    scheduler.enqueue('a')
    expect(writes).toEqual(['a'])
    expect(frames).toHaveLength(0)

    const exact = 'x'.repeat(IMMEDIATE_CHUNK_BYTES)
    scheduler.enqueue(exact)
    expect(writes).toEqual(['a', exact])
    expect(frames).toHaveLength(0)
    scheduler.dispose()
  })

  test('coalesces bursty streaming chunks per animation frame with byte budget and backpressure', () => {
    const writes: string[] = []
    const pendingDones: Array<() => void> = []
    const frames: Array<() => void> = []
    const scheduler = createTerminalWriteScheduler({
      immediateBytes: 64,
      maxBytesPerFrame: 1024,
      write: (chunk, done) => {
        writes.push(chunk)
        pendingDones.push(done)
      },
      scheduleFrame: (cb) => frames.push(cb),
      cancelFrame: vi.fn()
    })

    const partA = 'A'.repeat(800)
    const partB = 'B'.repeat(800)
    const partC = 'C'.repeat(400)
    scheduler.enqueue(partA)
    scheduler.enqueue(partB)
    scheduler.enqueue(partC)

    // Buffered until the animation frame fires — only 1 frame scheduled for all 3 chunks.
    expect(writes).toHaveLength(0)
    expect(frames).toHaveLength(1)

    // First frame writes at most maxBytesPerFrame (1024) and waits for xterm callback.
    frames.shift()!()
    expect(writes).toHaveLength(1)
    expect(writes[0]).toHaveLength(1024)
    expect(frames).toHaveLength(0)

    // Backpressure: new data arriving while in-flight does not schedule another write yet.
    scheduler.enqueue('D'.repeat(200))
    expect(frames).toHaveLength(0)

    // Once xterm finishes the first slice, the next frame is scheduled.
    pendingDones.shift()!()
    expect(frames).toHaveLength(1)

    frames.shift()!()
    expect(writes).toHaveLength(2)
    expect(writes[1]).toHaveLength(1024)
    pendingDones.shift()!()

    frames.shift()!()
    expect(writes).toHaveLength(3)
    pendingDones.shift()!()

    // Exact byte order preserved across all slices.
    expect(writes.join('')).toBe(partA + partB + partC + 'D'.repeat(200))
    expect(scheduler.pendingLength()).toBe(0)
    expect(MAX_BYTES_PER_FRAME).toBe(64 * 1024)
    scheduler.dispose()
  })

  test('updateActivity handles 64 KB ANSI bursts with O(1) tail slicing and throttling', () => {
    const store = useTerminalStore.getState()
    const bigAnsi = `\x1b[32m${'load '.repeat(14000)}\x1b[0m\r\nfinal line\r\n`
    expect(bigAnsi.length).toBeGreaterThan(64 * 1024)

    store.updateActivity('pane-load', bigAnsi)
    const afterFirst = useTerminalStore.getState().getStatus('pane-load')
    expect(afterFirst.isWorking).toBe(true)
    expect(afterFirst.lastOutput).toContain('final line')

    // Second immediate burst within throttle window does not churn store timestamp.
    const firstAt = afterFirst.lastActivityAt
    store.updateActivity('pane-load', bigAnsi)
    expect(useTerminalStore.getState().getStatus('pane-load').lastActivityAt).toBe(firstAt)
  })
})
