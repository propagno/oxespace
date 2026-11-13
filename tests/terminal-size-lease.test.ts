import { afterEach, describe, expect, test, vi } from 'vitest'
import { openInMemoryDatabase } from '../electron/main/db/index'
import { WorkspaceService } from '../electron/main/services/workspace.service'
import { TerminalManager } from '../electron/main/services/terminal.service'
import { SIZE_LEASE_MS } from '../electron/main/services/terminal/size-lease'
import { RemoteCommands, parseCommandArgs } from '../electron/main/services/remote/commands'
import type { RemoteDesktop } from '../electron/main/services/remote/desktop'
import { REMOTE_COMMANDS, REMOTE_TERMINAL_GRID } from '../shared/remote/protocol'
import { DESKTOP_FEATURES } from '../electron/main/services/remote/connection'
import type { TerminalSizeLeaseEvent } from '../shared/types/ipc'

/*
 * 1.5.0 · A phone that has a terminal open sizes it for its own screen, so a full-screen CLI draws for the phone. The
 * desktop's size is kept and returns when the phone lets go, disconnects, stops renewing, or the person takes it back.
 */
const cleanups: Array<() => void> = []
afterEach(() => { vi.useRealTimers(); for (const cleanup of cleanups.splice(0)) cleanup() })

async function startPane() {
  const db = openInMemoryDatabase()
  const workspace = new WorkspaceService(db).create({ rootPath: 'C:/repo', layout: '1x1', autoStart: false })
  const paneId = workspace.panes[0].id
  const fake = {
    pid: 0, write: vi.fn(), resize: vi.fn(), kill: vi.fn(),
    onData: vi.fn(() => ({ dispose: vi.fn() })), onExit: vi.fn(() => ({ dispose: vi.fn() }))
  }
  const events: TerminalSizeLeaseEvent[] = []
  const manager = new TerminalManager(db, { pty: { spawn: vi.fn(() => fake as never) }, platform: 'win32', emitSizeLease: event => { events.push(event) } })
  cleanups.push(() => { manager.stopAll(); db.close() })
  await manager.start({ workspaceId: workspace.id, paneId, agentCommand: 'my-agent' })
  manager.resize({ paneId, cols: 120, rows: 40 })
  fake.resize.mockClear()
  const sizes = () => fake.resize.mock.calls.map(([cols, rows]) => `${cols}x${rows}`)
  return { manager, paneId, fake, events, sizes }
}

describe('a phone holds a terminal\'s size', () => {
  test('the process is sized for the phone, and the window is told', async () => {
    const pane = await startPane()
    expect(pane.manager.sizes.lease(pane.paneId, 'phone-a', 46, 28)).toBe('held')
    expect(pane.sizes()).toEqual(['46x28'])
    expect(pane.manager.sizes.get(pane.paneId)).toEqual({ cols: 46, rows: 28 })
    expect(pane.events).toEqual([{ paneId: pane.paneId, lease: { cols: 46, rows: 28 } }])
  })

  test('a pane with no process is not held', async () => {
    const pane = await startPane()
    expect(pane.manager.sizes.lease('no-such-pane', 'phone-a', 46, 28)).toBe('no-terminal')
    expect(pane.events).toEqual([])
  })

  test('while held, the desktop\'s own fit is remembered, not applied; letting go puts the latest one back', async () => {
    const pane = await startPane()
    pane.manager.sizes.lease(pane.paneId, 'phone-a', 46, 28)
    pane.manager.resize({ paneId: pane.paneId, cols: 150, rows: 50 })
    expect(pane.sizes()).toEqual(['46x28'])
    expect(pane.manager.sizes.release(pane.paneId, 'phone-a')).toBe(true)
    expect(pane.sizes()).toEqual(['46x28', '150x50'])
    expect(pane.manager.sizes.get(pane.paneId)).toBeNull()
    expect(pane.events.at(-1)).toEqual({ paneId: pane.paneId, lease: null })
    // Released: the desktop sizes the pane again.
    pane.manager.resize({ paneId: pane.paneId, cols: 100, rows: 30 })
    expect(pane.sizes().at(-1)).toBe('100x30')
  })

  test('renewing with the same grid neither resizes again nor tells the window again', async () => {
    const pane = await startPane()
    pane.manager.sizes.lease(pane.paneId, 'phone-a', 46, 28)
    pane.manager.sizes.lease(pane.paneId, 'phone-a', 46, 28)
    expect(pane.sizes()).toEqual(['46x28'])
    expect(pane.events).toHaveLength(1)
    // A rotated phone asks for another grid: that one is applied, and the desktop's size is still the one to return.
    pane.manager.sizes.lease(pane.paneId, 'phone-a', 96, 18)
    pane.manager.sizes.release(pane.paneId, 'phone-a')
    expect(pane.sizes()).toEqual(['46x28', '96x18', '120x40'])
  })

  test('another device cannot let go of a size it does not hold', async () => {
    const pane = await startPane()
    pane.manager.sizes.lease(pane.paneId, 'phone-a', 46, 28)
    expect(pane.manager.sizes.release(pane.paneId, 'phone-b')).toBe(false)
    expect(pane.manager.sizes.get(pane.paneId)).toEqual({ cols: 46, rows: 28 })
  })

  test('a phone that disconnects gives back every size it held', async () => {
    const pane = await startPane()
    pane.manager.sizes.lease(pane.paneId, 'phone-a', 46, 28)
    pane.manager.sizes.releaseOf('phone-b')
    expect(pane.manager.sizes.get(pane.paneId)).not.toBeNull()
    pane.manager.sizes.releaseOf('phone-a')
    expect(pane.manager.sizes.get(pane.paneId)).toBeNull()
    expect(pane.sizes().at(-1)).toBe('120x40')
  })

  test('a hold nobody renews ends by itself; a renewed one lasts', async () => {
    const pane = await startPane()
    vi.useFakeTimers()
    pane.manager.sizes.lease(pane.paneId, 'phone-a', 46, 28)
    vi.advanceTimersByTime(SIZE_LEASE_MS - 1_000)
    pane.manager.sizes.lease(pane.paneId, 'phone-a', 46, 28)
    vi.advanceTimersByTime(SIZE_LEASE_MS - 1_000)
    expect(pane.manager.sizes.get(pane.paneId)).toEqual({ cols: 46, rows: 28 })
    vi.advanceTimersByTime(2_000)
    expect(pane.sizes().at(-1)).toBe('120x40')
    expect(pane.events.at(-1)).toEqual({ paneId: pane.paneId, lease: null })
    expect(pane.manager.sizes.get(pane.paneId)).toBeNull()
  })

  test('the person takes the size back: that phone is refused until it leaves the terminal', async () => {
    const pane = await startPane()
    pane.manager.sizes.lease(pane.paneId, 'phone-a', 46, 28)
    expect(pane.manager.sizes.takeBack(pane.paneId)).toBe(true)
    expect(pane.sizes().at(-1)).toBe('120x40')
    expect(pane.manager.sizes.lease(pane.paneId, 'phone-a', 46, 28)).toBe('taken-back')
    expect(pane.manager.sizes.get(pane.paneId)).toBeNull()
    // Leaving the terminal on the phone (terminal.release) ends the refusal.
    pane.manager.sizes.release(pane.paneId, 'phone-a')
    expect(pane.manager.sizes.lease(pane.paneId, 'phone-a', 46, 28)).toBe('held')
    expect(pane.manager.sizes.takeBack('no-such-pane')).toBe(false)
  })

  test('a stopped pane holds nothing', async () => {
    const pane = await startPane()
    pane.manager.sizes.lease(pane.paneId, 'phone-a', 46, 28)
    await pane.manager.stop({ paneId: pane.paneId })
    expect(pane.manager.sizes.get(pane.paneId)).toBeNull()
    expect(pane.events.at(-1)).toEqual({ paneId: pane.paneId, lease: null })
  })
})

describe('terminal.resize and terminal.release from a phone', () => {
  function commands(hidden: string[] = []) {
    const calls: string[] = []
    let answer: 'held' | 'no-terminal' | 'taken-back' = 'held'
    const desktop = {
      sizeTerminal: (paneId: string, deviceId: string, cols: number, rows: number) => { calls.push(`size ${paneId} ${deviceId} ${cols}x${rows}`); return answer },
      releaseTerminalSize: (paneId: string, deviceId: string) => { calls.push(`release ${paneId} ${deviceId}`) }
    } as unknown as RemoteDesktop
    const run = new RemoteCommands({ desktop, now: () => 0, phoneWrite: () => new Set(), phoneHidden: () => new Set(hidden) })
    return { run, calls, answers: (next: typeof answer) => { answer = next } }
  }

  test('both are commands, and the desktop says so in its hello', () => {
    expect(REMOTE_COMMANDS).toEqual(expect.arrayContaining(['terminal.resize', 'terminal.release']))
    expect(DESKTOP_FEATURES).toContain('terminal.resize')
  })

  test('the grid is whole numbers inside the bounds; anything else is malformed', () => {
    expect(parseCommandArgs('terminal.resize', { paneId: 'p1', cols: 46, rows: 28 })).toEqual({ paneId: 'p1', cols: 46, rows: 28 })
    const { minCols, maxCols, minRows, maxRows } = REMOTE_TERMINAL_GRID
    expect(parseCommandArgs('terminal.resize', { paneId: 'p1', cols: minCols, rows: minRows })).toEqual({ paneId: 'p1', cols: minCols, rows: minRows })
    expect(parseCommandArgs('terminal.resize', { paneId: 'p1', cols: maxCols, rows: maxRows })).toEqual({ paneId: 'p1', cols: maxCols, rows: maxRows })
    for (const bad of [
      { paneId: 'p1', cols: minCols - 1, rows: 28 }, { paneId: 'p1', cols: maxCols + 1, rows: 28 },
      { paneId: 'p1', cols: 46, rows: minRows - 1 }, { paneId: 'p1', cols: 46, rows: maxRows + 1 },
      { paneId: 'p1', cols: 46.5, rows: 28 }, { paneId: 'p1', cols: '46', rows: 28 }, { paneId: 'p1', cols: 46 },
      { paneId: 'p1', cols: 46, rows: 28, extra: true }, { paneId: '', cols: 46, rows: 28 }
    ]) expect(() => parseCommandArgs('terminal.resize', bad), JSON.stringify(bad)).toThrow()
    expect(parseCommandArgs('terminal.release', { paneId: 'p1' })).toEqual({ paneId: 'p1' })
    expect(() => parseCommandArgs('terminal.release', { paneId: 'p1', cols: 1 })).toThrow()
  })

  test('a visible pane is sized for the device that asked; a read-only pane too', async () => {
    const { run, calls } = commands()
    expect(await run.run('phone-a', 'terminal.resize', { paneId: 'p1', cols: 46, rows: 28 })).toEqual({ ok: true })
    expect(calls).toEqual(['size p1 phone-a 46x28'])
  })

  test('a pane hidden from the phone is not shared, and nothing is sized', async () => {
    const { run, calls } = commands(['p1'])
    expect(await run.run('phone-a', 'terminal.resize', { paneId: 'p1', cols: 46, rows: 28 })).toEqual({ ok: false, code: 'pane-not-shared' })
    expect(calls).toEqual([])
  })

  test('no terminal is not-found; a size the person took back is forbidden; out of bounds is malformed', async () => {
    const { run, answers, calls } = commands()
    answers('no-terminal')
    expect(await run.run('phone-a', 'terminal.resize', { paneId: 'p1', cols: 46, rows: 28 })).toEqual({ ok: false, code: 'not-found' })
    answers('taken-back')
    expect(await run.run('phone-a', 'terminal.resize', { paneId: 'p1', cols: 46, rows: 28 })).toEqual({ ok: false, code: 'forbidden' })
    calls.length = 0
    expect(await run.run('phone-a', 'terminal.resize', { paneId: 'p1', cols: 5, rows: 28 })).toEqual({ ok: false, code: 'malformed' })
    expect(calls).toEqual([])
  })

  test('release is the asking device\'s own, and is ok with nothing held', async () => {
    const { run, calls } = commands()
    expect(await run.run('phone-a', 'terminal.release', { paneId: 'p1' })).toEqual({ ok: true })
    expect(calls).toEqual(['release p1 phone-a'])
  })
})
