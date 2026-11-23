import { describe, expect, test, vi } from 'vitest'
import { openInMemoryDatabase } from '../electron/main/db/index'
import { WorkspaceService } from '../electron/main/services/workspace.service'
import { TerminalManager, type TerminalObserver } from '../electron/main/services/terminal.service'
import { terminalLevers } from '../shared/terminal-levers'
import { createTerminalWriteScheduler } from '../src/components/Terminal/terminalWriteScheduler'

/*
 * OXE-411 · The levers measured by e2e/perf/terminal-load-breakdown.spec.ts are off unless OXESPACE_TERM_LEVERS names
 * them: the app behaves as before the card. The measurements are in docs/validation/terminal-load-breakdown.md.
 */
function fakePty() {
  let onData: ((data: string) => void) | undefined
  const pty = {
    pid: 0, process: 'agent', write: vi.fn(), resize: vi.fn(), kill: vi.fn(),
    onData: vi.fn((handler: (data: string) => void) => { onData = handler; return { dispose: vi.fn() } }),
    onExit: vi.fn(() => ({ dispose: vi.fn() }))
  }
  return { pty, print: (data: string) => onData?.(data) }
}

async function startAgent(env: NodeJS.ProcessEnv) {
  const db = openInMemoryDatabase()
  const workspace = new WorkspaceService(db).create({ rootPath: 'C:/repo', layout: '1x1', autoStart: false })
  const { pty, print } = fakePty()
  const observed: string[] = []
  const observer: TerminalObserver = { start: vi.fn(), output: (_paneId, data) => { observed.push(data) }, resize: vi.fn(), exit: vi.fn() }
  const emitted: string[] = []
  const manager = new TerminalManager(db, { pty: { spawn: vi.fn(() => pty as never) }, platform: 'linux', env, observer, emitData: event => { emitted.push(event.data) } })
  await manager.start({ workspaceId: workspace.id, paneId: workspace.panes[0].id, agentCommand: 'my-agent' })
  return { manager, db, print, observed, emitted }
}

describe('the terminal load levers (OXE-411)', () => {
  test('every lever is off by default', async () => {
    expect([...terminalLevers(undefined)]).toEqual([])
    expect([...terminalLevers('')]).toEqual([])
    expect([...terminalLevers('X, , hm')]).toEqual([])

    // No lever: the agent mirror is fed and output reaches the window in the usual 16 ms batch.
    const { manager, db, print, observed, emitted } = await startAgent({ PATH: process.env.PATH ?? '' })
    try {
      print('hello')
      expect(observed.join('')).toBe('hello')
      await vi.waitFor(() => expect(emitted.join('')).toBe('hello'), { timeout: 1_000 })
    } finally { manager.stopAll(); db.close() }
  })

  test('OXESPACE_TERM_LEVERS turns on exactly the levers it names', () => {
    expect([...terminalLevers('h, M ,i, q')].sort()).toEqual(['H', 'I', 'M', 'Q'])
    expect([...terminalLevers('M')]).toEqual(['M'])
  })

  test('lever M still feeds the mirror of a pane started as an agent', async () => {
    const { manager, db, print, observed } = await startAgent({ PATH: process.env.PATH ?? '', OXESPACE_TERM_LEVERS: 'M' })
    try {
      print('agent says hi')
      expect(observed.join('')).toBe('agent says hi')
    } finally { manager.stopAll(); db.close() }
  })
})

describe('lever Q: the write scheduler as a queue of chunks (OXE-411)', () => {
  /** Drives a scheduler by hand: frames run when asked, and each write completes when asked. */
  function drive(queue: boolean, inputs: string[], maxBytesPerFrame: number) {
    const frames: Array<() => void> = []
    const dones: Array<() => void> = []
    const written: string[] = []
    const scheduler = createTerminalWriteScheduler({
      queue, maxBytesPerFrame, immediateBytes: 8,
      write: (chunk, done) => { written.push(chunk); dones.push(done) },
      scheduleFrame: cb => { frames.push(cb); return frames.length },
      cancelFrame: () => undefined
    })
    const pending: number[] = []
    inputs.forEach((data, index) => {
      scheduler.enqueue(data)
      // Interleave: a write completes every other input, a frame runs every third.
      if (index % 2 === 0) dones.shift()?.()
      if (index % 3 === 0) frames.shift()?.()
      pending.push(scheduler.pendingLength())
    })
    for (let guard = 0; guard < 10_000 && (frames.length || dones.length); guard++) { dones.shift()?.(); frames.shift()?.() }
    return { written, pending, left: scheduler.pendingLength() }
  }

  test('writes the same slices in the same order as the string scheduler, with the same backpressure', () => {
    let seed = 7
    const random = (): number => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31 }
    const inputs = Array.from({ length: 400 }, (_, index) => `${index}:${'x'.repeat(Math.floor(random() * 3000))}\r\n`)
    for (const max of [64, 1024, 65536]) {
      const before = drive(false, inputs, max)
      const after = drive(true, inputs, max)
      expect(after.written).toEqual(before.written)
      expect(after.pending).toEqual(before.pending)
      expect(after.left).toBe(0)
      expect(after.written.join('')).toBe(inputs.join(''))
    }
  })
})
