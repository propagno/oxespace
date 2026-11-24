// OXE-392: on quit, every terminal's exit reaches JS before the environment tears down, so node-pty's exit callback
// never calls into a dying environment (the uncaught Napi::Error in SetupExitCallback/CallJS that aborts the app). A
// terminal that exits at once is drained in milliseconds; one still running after the grace is SIGKILLed; the deadline
// bounds a terminal that never reports and is logged once, as a count. Nothing starts once the quit began, including a
// launch already racing it. Fake node-pty: no process is spawned.
import { afterEach, describe, expect, test, vi } from 'vitest'
import { openInMemoryDatabase } from '../../../electron/main/db/index'
import { WorkspaceService } from '../../../electron/main/services/workspace.service'
import { TerminalManager } from '../../../electron/main/services/terminal.service'

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

let nextPid = 40_000
function fakePtyModule() {
  const instances: Array<ReturnType<typeof fakePty>> = []
  return { instances, spawn: vi.fn(() => { const pty = fakePty(); instances.push(pty); return pty }) }
}
function fakePty() {
  const exits: Array<(event: { exitCode: number }) => void> = []
  return {
    pid: nextPid++,
    write: vi.fn(), resize: vi.fn(), kill: vi.fn(),
    onData: vi.fn(() => ({ dispose: vi.fn() })),
    onExit: vi.fn((handler: (event: { exitCode: number }) => void) => { exits.push(handler); return { dispose: vi.fn() } }),
    emitExit: (exitCode = 0) => { for (const handler of exits) handler({ exitCode }) }
  }
}
type Drain = (options?: Record<string, unknown>) => Promise<{ exited: number; pending: number; ms: number }>
const drainOf = (manager: TerminalManager): Drain => {
  const fn = (manager as unknown as { stopAllAndDrain?: Drain }).stopAllAndDrain
  if (typeof fn !== 'function') throw new Error('TerminalManager has no stopAllAndDrain')
  return fn.bind(manager)
}

async function withShells(count: number) {
  const db = openInMemoryDatabase()
  const workspace = new WorkspaceService(db).create({ rootPath: process.cwd(), layout: count >= 4 ? '2x2' : '1x2', autoStart: false })
  const pty = fakePtyModule()
  const manager = new TerminalManager(db, { pty, platform: 'linux' })
  manager.setAgentsFullAccess(false)
  for (const pane of workspace.panes.slice(0, count)) await manager.start({ workspaceId: workspace.id, paneId: pane.id })
  expect(pty.spawn).toHaveBeenCalledTimes(count)
  return { db, workspace, pty, manager }
}

describe('OXE-392 · terminals are drained on quit', () => {
  test('the quit waits until every stopped terminal has reported its exit, and is fast when they exit at once', async () => {
    const { db, pty, manager } = await withShells(2)
    try {
      let settled = false
      const drained = drainOf(manager)({ forceKill: vi.fn() }).then(result => { settled = true; return result })
      await Promise.resolve(); await Promise.resolve()
      expect(settled, 'still waiting while both terminals are alive').toBe(false)
      pty.instances[0].emitExit()
      await Promise.resolve()
      expect(settled, 'one terminal is still alive').toBe(false)
      pty.instances[1].emitExit()
      const result = await drained
      expect(result).toMatchObject({ exited: 2, pending: 0 })
      expect(result.ms).toBeLessThan(250)
    } finally { db.close() }
  })

  test('a terminal still running after the grace is SIGKILLed, and the deadline is logged once, as a count', async () => {
    const { db, pty, manager } = await withShells(2)
    vi.useFakeTimers()
    const warn = vi.fn()
    const forceKill = vi.fn()
    try {
      const drained = drainOf(manager)({ graceMs: 1_500, deadlineMs: 3_000, forceKill, warn })
      pty.instances[0].emitExit()
      await vi.advanceTimersByTimeAsync(1_499)
      expect(forceKill).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(forceKill).toHaveBeenCalledTimes(1)
      expect(forceKill).toHaveBeenCalledWith(pty.instances[1])
      await vi.advanceTimersByTimeAsync(1_500)
      expect(await drained).toMatchObject({ exited: 1, pending: 1 })
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn.mock.calls[0][0]).toBe('[terminal] quit: 1 terminal(s) still running after 3000 ms')
    } finally { db.close() }
  })

  test('nothing is spawned once the quit began, not even a launch already racing it', async () => {
    const { db, workspace, pty, manager } = await withShells(1)
    try {
      const pane = workspace.panes[1]
      expect(pane, 'a second, idle pane').toBeDefined()
      const racing = manager.start({ workspaceId: workspace.id, paneId: pane.id }).catch(() => undefined)
      const drained = drainOf(manager)({ forceKill: vi.fn() })
      pty.instances[0].emitExit()
      await racing
      await manager.start({ workspaceId: workspace.id, paneId: pane.id }).catch(() => undefined)
      expect(pty.spawn, 'no process after the quit began').toHaveBeenCalledTimes(1)
      expect(await drained).toMatchObject({ pending: 0 })
    } finally { db.close() }
  })
})
