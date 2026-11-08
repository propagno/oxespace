// @vitest-environment node
// Frozen acceptance test for 1.5.0 CR-34 (HML-F10-1, TECH LEAD 08/11; OXE program, phase F10, task BE-CR34): a per-pane
// "Show on phone", on by default. Off removes the pane from the phone entirely: not in the pane list, no terminal stream,
// no conversation; an open stream ends with reason pane-hidden. Desktop-only (never a phone command or MCP), persisted
// per pane, audited, and turning it off also turns typing from the phone off. Toggling back restores the pane.
// Written by the planner; the executor must not edit it.
// CCR: docs/roadmap-1.5/ccr-f10-c5-backend.md §BE-CR34. Wording: DESIGN's CR-34 note (08/11).
// Runs under Electron's Node ABI: npm run test:electron -- tests/acceptance/f10/cr34-pane-hidden.native.test.ts
import { afterEach, describe, expect, test } from 'vitest'
import { RemoteStore } from '../../../electron/main/services/remote/store'
import { MCP_COVERAGE } from '../../../shared/mcp-coverage'
import { REMOTE_COMMANDS, type RemotePane } from '../../../shared/remote/protocol'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { TestSocket } from '../../helpers/remote-client'
import type { Harness } from '../../helpers/remote-gateway-harness'
import { collect, ended, phoneWithDesktop, signIn, subscribeOnly, terminalUntil, type Frame } from '../../helpers/remote-session'

const harnesses: Harness[] = []
afterEach(async () => { await Promise.all(harnesses.splice(0).map(value => value.close())) })
let counter = 0
const run = (socket: TestSocket, command: string, args: unknown): Promise<Frame> => socket.ask({ type: 'command', id: `c${++counter}`, command, args })
const paneIds = (frame: Frame) => (frame.data as { workspaces: Array<{ panes: RemotePane[] }> }).workspaces.flatMap(workspace => workspace.panes.map(pane => pane.id))

async function setup() {
  const phone = await phoneWithDesktop(harnesses, desk => { desk.terminals.start('p1'); desk.terminals.print('p1', 'secret build output\r\n') })
  const socket = await signIn(phone)
  return { phone, socket }
}

describe('BE-CR34 · Show on phone', () => {
  test('CR-34: on by default; hidden, the pane leaves the workspaces topic for every subscriber; shown again, it comes back', async () => {
    const { phone, socket } = await setup()
    await subscribeOnly(socket, 'workspaces')
    const [first] = await collect(socket, ended)
    expect(paneIds(first)).toEqual(expect.arrayContaining(['p1', 'p2']))
    expect(phone.h.gateway.setPhoneHidden({ paneId: 'p1', hidden: true }).phoneHiddenPanes).toEqual(['p1'])
    const [hidden] = await collect(socket, frame => frame.type === 'event')
    expect(paneIds(hidden)).not.toContain('p1')
    expect(paneIds(hidden)).toContain('p2')
    phone.h.gateway.setPhoneHidden({ paneId: 'p1', hidden: false })
    const [shown] = await collect(socket, frame => frame.type === 'event')
    expect(paneIds(shown)).toContain('p1')
  })

  test('CR-34: a hidden pane\'s terminal subscribe is refused exactly like an unknown pane\'s; shown again it streams', async () => {
    const { phone, socket } = await setup()
    phone.h.gateway.setPhoneHidden({ paneId: 'p1', hidden: true })
    const unknown = await socket.ask({ type: 'subscribe', id: 's-unknown', topic: 'terminal', target: 'p-none' })
    const refused = await socket.ask({ type: 'subscribe', id: 's-hidden', topic: 'terminal', target: 'p1' })
    expect(refused).toMatchObject({ type: 'error', code: unknown.code })
    expect(JSON.stringify(refused)).not.toContain('secret build output')
    phone.h.gateway.setPhoneHidden({ paneId: 'p1', hidden: false })
    const stream = await subscribeOnly(socket, 'terminal', { target: 'p1' })
    expect((await terminalUntil(socket, stream, text => text.includes('secret build output'))).text).toContain('secret build output')
  })

  test('CR-34: an open terminal stream ends when the pane is hidden, with reason pane-hidden, and nothing more arrives', async () => {
    const { phone, socket } = await setup()
    const stream = await subscribeOnly(socket, 'terminal', { target: 'p1' })
    await terminalUntil(socket, stream, text => text.includes('secret build output'))
    phone.h.gateway.setPhoneHidden({ paneId: 'p1', hidden: true })
    const frames = await collect(socket, frame => frame.type === 'error')
    const end = frames.at(-1)!
    expect(end).toMatchObject({ type: 'error', code: 'not-found', subscription: stream, reason: 'pane-hidden' })
    // Before it, one last event clears the screen, so a phone that predates the end frame shows nothing of the pane.
    const clear = frames.at(-2)
    expect(clear).toMatchObject({ type: 'event', subscription: stream })
    expect((clear!.data as { data: string }).data).toBe('\u001b[2J\u001b[3J\u001b[H')
    phone.desk.terminals.print('p1', 'after hiding\r\n')
    await new Promise(resolve => setTimeout(resolve, 400))
    expect(socket.frames.filter(frame => frame.subscription === stream)).toEqual([])
  })

  test('CR-34: a hidden pane has no conversation: the command and the topic answer no-conversation', async () => {
    const { phone, socket } = await setup()
    phone.h.gateway.setPhoneHidden({ paneId: 'p1', hidden: true })
    expect(await run(socket, 'pane.conversation', { paneId: 'p1' })).toMatchObject({ type: 'error', code: 'no-conversation' })
    expect(await socket.ask({ type: 'subscribe', id: 's-conv', topic: 'paneConversation', target: 'p1' })).toMatchObject({ type: 'error', code: 'no-conversation' })
  })

  test('CR-34: hiding also turns typing from the phone off; typing cannot be turned on for a hidden pane', async () => {
    const { phone, socket } = await setup()
    phone.h.gateway.setPhoneWrite({ paneId: 'p1', allowed: true })
    expect(await run(socket, 'terminal.write', { paneId: 'p1', data: 'ls\r' })).toMatchObject({ type: 'ack' })
    const status = phone.h.gateway.setPhoneHidden({ paneId: 'p1', hidden: true })
    expect(status.phoneWritePanes).not.toContain('p1')
    expect(phone.h.gateway.setPhoneWrite({ paneId: 'p1', allowed: true }).phoneWritePanes).not.toContain('p1')
    expect(await run(socket, 'terminal.write', { paneId: 'p1', data: 'ls\r' })).toMatchObject({ type: 'error' })
  })

  test('CR-34: persisted per pane across a gateway restart, and audited on and off', async () => {
    const { phone } = await setup()
    phone.h.gateway.setPhoneHidden({ paneId: 'p1', hidden: true })
    expect(phone.h.create().status().phoneHiddenPanes).toEqual(['p1'])
    phone.h.gateway.setPhoneHidden({ paneId: 'p1', hidden: false })
    expect(phone.h.create().status().phoneHiddenPanes).toEqual([])
    expect(new RemoteStore(phone.h.db).auditEntries(50).filter(entry => entry.action === 'phone-hidden').map(entry => entry.outcome)).toEqual(['off', 'on'])
    // Nothing changes, nothing is audited.
    phone.h.gateway.setPhoneHidden({ paneId: 'p1', hidden: false })
    expect(new RemoteStore(phone.h.db).auditEntries(50).filter(entry => entry.action === 'phone-hidden')).toHaveLength(2)
  })

  test('CR-34: desktop-only: an IPC channel of the window, forbidden in MCP, never a phone command; bad input throws', async () => {
    const { phone, socket } = await setup()
    expect(IPC_CHANNELS.remote.setPhoneHidden).toBe('remote:set-phone-hidden')
    const claims = Object.values(MCP_COVERAGE).filter(capability => capability.ipc?.includes('remote.setPhoneHidden'))
    expect(claims).toHaveLength(1)
    expect(claims[0]).toHaveProperty('forbidden')
    expect((REMOTE_COMMANDS as readonly string[]).some(command => /hidden|visib|show/i.test(command))).toBe(false)
    expect(await run(socket, 'remote.setPhoneHidden', { paneId: 'p1', hidden: true })).toMatchObject({ code: 'unknown-command' })
    for (const bad of [null, {}, { paneId: 'p1' }, { paneId: 'p1', hidden: 'yes' }, { paneId: '', hidden: true }]) expect(() => phone.h.gateway.setPhoneHidden(bad)).toThrow()
    expect(phone.h.gateway.status().phoneHiddenPanes).toEqual([])
  })
})
