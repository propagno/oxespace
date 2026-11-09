// @vitest-environment node
// Frozen acceptance test for 1.5.0 A45, BACKEND's C5 half (OXE program, phase F10, task BE-A45-flag): a phone that reads
// `snapshot` says so in its terminal subscribe (`snapshotOnly: true`), and the desktop then sends only the snapshot page,
// with no ring pages; when the screen can't be built, the ring pages as today. An older phone (no flag) is unchanged.
// Written by the planner; the executor must not edit it.
// CCR: docs/roadmap-1.5/ccr-f10-c5-backend.md §BE-A45-flag (from ccr-t98-terminal-screen.md "Phone phase" 2).
// Runs under Electron's Node ABI: npm run test:electron -- tests/acceptance/f10/a45-snapshot-flag.native.test.ts
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { RemoteTerminalData } from '../../../shared/remote/protocol'
import { TestSocket } from '../../helpers/remote-client'
import type { Harness } from '../../helpers/remote-gateway-harness'
import { away, collect, ended, phoneWithDesktop, signIn, subscribeOnly, terminalUntil, type Frame } from '../../helpers/remote-session'

/** Fault injection for the fallback: the real screen builder unless a test says otherwise. */
const build = vi.hoisted(() => ({ mode: 'real' as 'real' | 'throw' | 'null' }))
vi.mock('../../../electron/main/services/remote/terminal-snapshot', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../electron/main/services/remote/terminal-snapshot')>()
  return {
    ...actual,
    buildTerminalSnapshot: (...args: Parameters<typeof actual.buildTerminalSnapshot>) =>
      build.mode === 'throw' ? Promise.reject(new Error('serializer failed'))
        : build.mode === 'null' ? Promise.resolve(null)
          : actual.buildTerminalSnapshot(...args)
  }
})

const harnesses: Harness[] = []
afterEach(async () => { build.mode = 'real'; await Promise.all(harnesses.splice(0).map(value => value.close())) })
const body = (frame: Frame) => frame.data as RemoteTerminalData
const SECRET = `sk-ant-${'q'.repeat(40)}`
const RING = `build started\r\nkey ${SECRET}\r\n\x1b[32mbusy: compiling 3/7\x1b[0m\r\n` + Array.from({ length: 300 }, (_, index) => `line ${index} ${'.'.repeat(60)}`).join('\r\n')

async function pane() {
  return phoneWithDesktop(harnesses, desk => {
    desk.terminals.start('p1', 'session-p1', 1024 * 1024)
    desk.terminals.sizes.set('p1', { cols: 100, rows: 30 })
    desk.terminals.print('p1', RING)
  })
}

describe('BE-A45-flag · the desktop says what it supports (MOBILE F1, TECH LEAD 08/11)', () => {
  test('BE-A45: the desktop\'s hello lists terminal.snapshotOnly and pane.conversation, so a phone sends the flag only to a desktop that reads it', async () => {
    const phone = await pane()
    const socket = await TestSocket.connect(phone.target)
    const hello = await socket.ask({ type: 'hello', versions: [1] })
    expect(hello).toMatchObject({ type: 'hello' })
    expect(hello.features).toEqual(expect.arrayContaining(['terminal.snapshotOnly', 'pane.conversation']))
    expect((hello.features as unknown[]).every(feature => typeof feature === 'string')).toBe(true)
    socket.close()
  })
})

describe('BE-A45-flag · the snapshot capability flag on the terminal subscribe', () => {
  test('BE-A45: with the flag only the snapshot page is sent; without it the ring pages follow as today', async () => {
    const phone = await pane()
    const older = await signIn(phone)
    const olderStream = await subscribeOnly(older, 'terminal', { target: 'p1' })
    const asToday = await terminalUntil(older, olderStream, text => text.includes('line 299'))
    expect(body(asToday.frames[0]).snapshot).toBeDefined()
    expect(asToday.frames.length).toBeGreaterThan(1)

    const flagged = await signIn(phone)
    const stream = await subscribeOnly(flagged, 'terminal', { target: 'p1', snapshotOnly: true })
    const frames = await collect(flagged, ended)
    expect(frames).toHaveLength(1)
    expect(frames[0]).toMatchObject({ type: 'snapshot', subscription: stream })
    expect(body(frames[0]).data).toBe('')
    expect(body(frames[0]).snapshot).toMatchObject({ cols: 100, rows: 30 })
    // The one page is the whole snapshot: nothing else arrives until the pane prints.
    phone.desk.terminals.print('p1', '\r\nafter')
    const [next] = await collect(flagged, frame => frame.type === 'event')
    expect(next.type).toBe('event')
    expect(body(next).data).toContain('after')
    expect(body(next).snapshot).toBeUndefined()
  })

  test('BE-A45: the snapshot page carries the redactions of the ring it stands for', async () => {
    const phone = await pane()
    const older = await signIn(phone)
    const asToday = await terminalUntil(older, await subscribeOnly(older, 'terminal', { target: 'p1' }), text => text.includes('line 299'))
    expect(asToday.redacted).toBeGreaterThan(0)
    const flagged = await signIn(phone)
    await subscribeOnly(flagged, 'terminal', { target: 'p1', snapshotOnly: true })
    const [page] = await collect(flagged, ended)
    expect(body(page).redacted).toBe(asToday.redacted)
    expect(JSON.stringify(page)).not.toContain(SECRET)
  })

  test('BE-A45: a flagged phone whose screen cannot be built (the builder throws, or gives nothing) gets the ring pages as today, never an empty terminal', async () => {
    for (const mode of ['throw', 'null'] as const) {
      const phone = await pane()
      build.mode = mode
      const flagged = await signIn(phone)
      const stream = await subscribeOnly(flagged, 'terminal', { target: 'p1', snapshotOnly: true })
      const got = await terminalUntil(flagged, stream, text => text.includes('line 299'))
      expect(got.frames[0].type, mode).toBe('snapshot')
      expect(got.frames.every(frame => body(frame).snapshot === undefined), mode).toBe(true)
      expect(got.text, mode).toContain('busy: compiling 3/7')
      expect(got.text, mode).not.toContain(SECRET)
    }
  })

  test('BE-A45: a flagged resume by cursor sends events only; a new process gets a fresh flagged snapshot', async () => {
    const phone = await phoneWithDesktop(harnesses, desk => { desk.terminals.start('p1'); desk.terminals.print('p1', 'one\r\n') })
    let socket = await signIn(phone)
    const firstStream = await subscribeOnly(socket, 'terminal', { target: 'p1', snapshotOnly: true })
    const [first] = await collect(socket, ended)
    expect(first.subscription).toBe(firstStream)
    expect(body(first).snapshot).toBeDefined()
    phone.desk.terminals.print('p1', 'two\r\n')
    const [event] = await collect(socket, frame => frame.type === 'event')
    away(phone, socket)
    phone.desk.terminals.print('p1', 'three\r\n')
    socket = await signIn(phone)
    const stream = await subscribeOnly(socket, 'terminal', { target: 'p1', snapshotOnly: true, cursor: event.cursor })
    const resumed = await terminalUntil(socket, stream, text => text === 'three\r\n')
    expect(resumed.frames.every(frame => frame.type === 'event')).toBe(true)
    phone.desk.terminals.start('p1', 'restarted')
    phone.desk.terminals.print('p1', 'fresh')
    const fresh = await collect(socket, ended)
    expect(fresh).toHaveLength(1)
    expect(fresh[0].type).toBe('snapshot')
    expect(body(fresh[0]).snapshot).toBeDefined()
  })

  test('BE-A45: the flag on any other topic changes nothing', async () => {
    const phone = await pane()
    const socket = await signIn(phone)
    await subscribeOnly(socket, 'workspaces', { snapshotOnly: true })
    const frames = await collect(socket, ended)
    expect(frames[0].type).toBe('snapshot')
    expect((frames[0].data as { workspaces: unknown[] }).workspaces.length).toBeGreaterThan(0)
  })
})
