// @vitest-environment node
// Frozen acceptance test for 1.5.2 Celular F2 (OXE program oxespace-152-mobile, Jira OXE-18), the desktop side.
// Written by the planner from the OXE-18 diagnosis (scratchpad diag-oxe18.md, probes confirmed on main); the executor
// must not edit it.
// A2 (T18-a): after a phone sizes a terminal (terminal.resize), the desktop sends that phone a new snapshot at the held
//   size, so the phone redraws its grid instead of painting narrow frames into the old desktop-sized one.
// A3 (T18-b): a pane restarted while a phone holds it starts at the desktop's size, and the desktop size comes back
//   after the phone lets go (the phone's size is never remembered as the desktop's).
// A4 (T18-f): one phone holds a pane's size at a time; a second phone's request is not held, does not resize the PTY
//   and is not answered `forbidden` (which the phone shows as "taken back"); it may hold once the first lets go.
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { RemoteTerminalData } from '../../../shared/remote/protocol'
import type { Harness } from '../../helpers/remote-gateway-harness'
import { collect, phoneWithDesktop, signIn, subscribeOnly, type Frame } from '../../helpers/remote-session'
import { openInMemoryDatabase } from '../../../electron/main/db/index'
import { WorkspaceService } from '../../../electron/main/services/workspace.service'
import { TerminalManager } from '../../../electron/main/services/terminal.service'

const harnesses: Harness[] = []
afterEach(async () => { await Promise.all(harnesses.splice(0).map(value => value.close())) })
const body = (frame: Frame) => frame.data as RemoteTerminalData

async function pane() {
  const db = openInMemoryDatabase()
  const workspace = new WorkspaceService(db).create({ rootPath: 'C:/repo', layout: '1x1', autoStart: false })
  const paneId = workspace.panes[0].id
  const fake = { pid: 0, write: vi.fn(), resize: vi.fn(), kill: vi.fn(), onData: vi.fn(() => ({ dispose: vi.fn() })), onExit: vi.fn(() => ({ dispose: vi.fn() })) }
  const spawn = vi.fn((..._args: unknown[]) => fake as never)
  const manager = new TerminalManager(db, { pty: { spawn }, platform: 'win32', emitSizeLease: () => undefined })
  await manager.start({ workspaceId: workspace.id, paneId, agentCommand: 'my-agent' })
  manager.resize({ paneId, cols: 120, rows: 40 })
  fake.resize.mockClear()
  return { manager, paneId, fake, spawn, done: () => { manager.stopAll(); db.close() } }
}

describe('A2 · the phone gets a screen at its own size after terminal.resize (T18-a)', () => {
  test('a snapshot with the held cols and rows, carrying the redraw, follows the resize', async () => {
    const phone = await phoneWithDesktop(harnesses, desk => {
      desk.terminals.start('p1', 'session-p1', 1024 * 1024)
      desk.terminals.sizes.set('p1', { cols: 120, rows: 30 })
      Object.assign(desk.terminals.sizes, { lease: (paneId: string, _holder: string, cols: number, rows: number) => { desk.terminals.sizes.set(paneId, { cols, rows }); return 'held' } })
      desk.terminals.print('p1', 'x'.repeat(100) + '\r\n$ ')
    })
    const socket = await signIn(phone)
    await subscribeOnly(socket, 'terminal', { target: 'p1', snapshotOnly: true })
    const first = await collect(socket, frame => frame.type === 'snapshot')
    expect(body(first.at(-1)!).snapshot).toMatchObject({ cols: 120, rows: 30 })
    const ack = await socket.ask({ type: 'command', id: 'c1', command: 'terminal.resize', args: { paneId: 'p1', cols: 40, rows: 20 } })
    expect(ack).toMatchObject({ type: 'ack', id: 'c1' })
    phone.desk.terminals.print('p1', '\x1b[2J\x1b[H' + 'y'.repeat(40))
    const seen = await collect(socket, frame => frame.type === 'snapshot' && body(frame).snapshot?.cols === 40, 3000)
    const snapshot = seen.at(-1)!
    expect(body(snapshot).snapshot).toMatchObject({ cols: 40, rows: 20 })
    expect(JSON.stringify(seen)).toContain('y'.repeat(40))
  }, 30_000)
})

describe('A3 · a pane restarted while a phone holds it (T18-b)', () => {
  test('the new process starts at the desktop size, not the phone size', async () => {
    const p = await pane()
    try {
      expect(p.manager.sizes.lease(p.paneId, 'phone-a', 46, 28)).toBe('held')
      p.spawn.mockClear()
      await p.manager.restart({ paneId: p.paneId })
      const options = p.spawn.mock.calls[0]?.[2] as { cols?: number; rows?: number } | undefined
      expect({ cols: options?.cols, rows: options?.rows }).toEqual({ cols: 120, rows: 40 })
    } finally { p.done() }
  })

  test('after a restart and a renew, letting go gives the pane the desktop size back', async () => {
    const p = await pane()
    try {
      p.manager.sizes.lease(p.paneId, 'phone-a', 46, 28)
      await p.manager.restart({ paneId: p.paneId })
      p.fake.resize.mockClear()
      p.manager.sizes.lease(p.paneId, 'phone-a', 46, 28)
      p.manager.sizes.release(p.paneId, 'phone-a')
      expect(p.fake.resize.mock.calls.at(-1)).toEqual([120, 40])
    } finally { p.done() }
  })
})

describe('A4 · one phone holds a pane size at a time (T18-f)', () => {
  test("a second phone is not held and does not resize the pty while the first holds", async () => {
    const p = await pane()
    try {
      expect(p.manager.sizes.lease(p.paneId, 'phone-a', 46, 28)).toBe('held')
      p.fake.resize.mockClear()
      const second = p.manager.sizes.lease(p.paneId, 'phone-b', 40, 20)
      expect(second).not.toBe('held')
      expect(second).not.toBe('taken-back')
      expect(p.fake.resize).not.toHaveBeenCalled()
      expect(p.manager.sizes.lease(p.paneId, 'phone-a', 46, 28)).toBe('held')
      expect(p.fake.resize).not.toHaveBeenCalled()
    } finally { p.done() }
  })

  test('once the first phone lets go, the second may hold', async () => {
    const p = await pane()
    try {
      p.manager.sizes.lease(p.paneId, 'phone-a', 46, 28)
      p.manager.sizes.lease(p.paneId, 'phone-b', 40, 20)
      expect(p.manager.sizes.release(p.paneId, 'phone-a')).toBe(true)
      expect(p.manager.sizes.lease(p.paneId, 'phone-b', 40, 20)).toBe('held')
      expect(p.fake.resize.mock.calls.at(-1)).toEqual([40, 20])
    } finally { p.done() }
  })

  test('the gateway answers the second phone with a code other than forbidden', async () => {
    const phone = await phoneWithDesktop(harnesses, desk => {
      desk.terminals.start('p1', 'session-p1', 1024 * 1024)
      desk.terminals.sizes.set('p1', { cols: 120, rows: 30 })
      Object.assign(desk.terminals.sizes, { lease: () => 'busy' })
    })
    const socket = await signIn(phone)
    const ack = await socket.ask({ type: 'command', id: 'c2', command: 'terminal.resize', args: { paneId: 'p1', cols: 40, rows: 20 } }) as { type: string; code?: string }
    expect(ack.type).toBe('error')
    expect(ack.code).not.toBe('forbidden')
  }, 30_000)
})
