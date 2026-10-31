// @vitest-environment node
import { afterEach, describe, expect, test } from 'vitest'
import { RemoteStore } from '../../electron/main/services/remote/store'
import { REMOTE_FORBIDDEN, REMOTE_LIMITS, REMOTE_TEXT_LIMITS } from '../../shared/remote/protocol'
import type { TestSocket } from '../helpers/remote-client'
import { pendingRequest } from '../helpers/remote-desktop'
import type { Harness } from '../helpers/remote-gateway-harness'
import { away, phoneWithDesktop, signIn, subscribe, type Frame, type Phone } from '../helpers/remote-session'

const harnesses: Harness[] = []
afterEach(async () => { await Promise.all(harnesses.splice(0).map(value => value.close())) })

let counter = 0
const run = (socket: TestSocket, command: string, args: unknown): Promise<Frame> => socket.ask({ type: 'command', id: `c${++counter}`, command, args })
const audits = (phone: Phone) => new RemoteStore(phone.h.db).auditEntries(1000).filter(entry => entry.action === 'command').reverse()

describe('remote commands: thread', () => {
  test('send and steer apply a clientId once, even when resent after reconnecting', async () => {
    const phone = await phoneWithDesktop(harnesses, desk => { desk.threads.create('t1'); desk.threads.create('t2', { status: 'running' }) })
    const { threads } = phone.desk
    let socket = await signIn(phone)
    expect(await run(socket, 'thread.send', { threadId: 't1', text: 'hello', clientId: 'client-0001' })).toMatchObject({ type: 'ack' })
    expect(await run(socket, 'thread.send', { threadId: 't1', text: 'hello', clientId: 'client-0001' })).toMatchObject({ type: 'ack' })
    away(phone, socket)
    socket = await signIn(phone)
    expect(await run(socket, 'thread.send', { threadId: 't1', text: 'hello', clientId: 'client-0001' })).toMatchObject({ type: 'ack' })
    expect(threads.sent).toEqual([{ kind: 'send', id: 't1', text: 'hello' }])
    // Another message is another clientId; after the dedupe window the same id is new again.
    expect(await run(socket, 'thread.send', { threadId: 't1', text: 'again', clientId: 'client-0002' })).toMatchObject({ type: 'ack' })
    phone.h.clock += REMOTE_LIMITS.clientIdDedupeMs
    expect(await run(socket, 'thread.send', { threadId: 't1', text: 'hello', clientId: 'client-0001' })).toMatchObject({ type: 'ack' })
    expect(threads.sent).toHaveLength(3)
    expect(await run(socket, 'thread.send', { threadId: 'nope', text: 'x', clientId: 'client-0003' })).toMatchObject({ code: 'not-found' })
    for (const args of [{ threadId: 't1', text: '', clientId: 'client-0004' }, { threadId: 't1', text: 'x'.repeat(REMOTE_LIMITS.maxTextLength + 1), clientId: 'client-0005' },
      { threadId: 't1', text: 'x', clientId: 'short' }, { threadId: 't1', text: 'x' }, { threadId: 't1', text: 'x', clientId: 'client-0006', attachments: ['a'] }]) {
      expect(await run(socket, 'thread.send', args)).toMatchObject({ code: 'malformed' })
    }
    // Steering needs a running turn on a provider that can take it.
    expect(await run(socket, 'thread.steer', { threadId: 't1', text: 'turn left', clientId: 'steer-0001' })).toMatchObject({ code: 'forbidden' })
    threads.update('t2', thread => { thread.capabilities = { provider: 'codex', platform: 'win32', authentication: 'subscription', features: { steering: { availability: 'supported', enabled: true, authorized: true, implemented: true, verified: 'native' } } } })
    expect(await run(socket, 'thread.steer', { threadId: 't2', text: 'turn left', clientId: 'steer-0002' })).toMatchObject({ type: 'ack' })
    expect(await run(socket, 'thread.steer', { threadId: 't2', text: 'turn left', clientId: 'steer-0002' })).toMatchObject({ type: 'ack' })
    expect(threads.sent.filter(entry => entry.kind === 'steer')).toHaveLength(1)
  })

  test('interrupt stops a running turn and says not-pending when nothing runs', async () => {
    const phone = await phoneWithDesktop(harnesses, desk => { desk.threads.create('t1', { status: 'running' }); desk.threads.create('t2') })
    const socket = await signIn(phone)
    expect(await run(socket, 'thread.interrupt', { threadId: 't1' })).toMatchObject({ type: 'ack' })
    expect(await run(socket, 'thread.interrupt', { threadId: 't2' })).toMatchObject({ code: 'not-pending' })
    expect(await run(socket, 'thread.interrupt', { threadId: 'gone' })).toMatchObject({ code: 'not-found' })
    expect(phone.desk.threads.interrupted).toEqual(['t1'])
  })

  // Assessor BE-M-10: what the phone saw cut cannot be accepted from the phone, only declined.
  test('respondRequest: a request the phone saw cut is deny-only', async () => {
    const phone = await phoneWithDesktop(harnesses, desk => desk.threads.create('t1', { status: 'approval' }, [
      pendingRequest('long', { command: `echo ${'a'.repeat(REMOTE_TEXT_LIMITS.detail)}` }),
      pendingRequest('short', { command: 'echo ok' })
    ]))
    const socket = await signIn(phone)
    const answer = (requestId: string, decision: string) => run(socket, 'thread.respondRequest', { threadId: 't1', requestId, generation: 1, response: { decision } })
    expect(await answer('long', 'accept')).toMatchObject({ code: 'forbidden' })
    expect(await answer('long', 'decline')).toMatchObject({ type: 'ack', result: { resolution: 'declined' } })
    expect(await answer('short', 'accept')).toMatchObject({ type: 'ack', result: { resolution: 'approved' } })
  })

  test('respondRequest: a question the phone saw cut is the desktop\'s alone, and a cut warning makes an approval deny-only', async () => {
    const over = REMOTE_TEXT_LIMITS.detail + 1
    const phone = await phoneWithDesktop(harnesses, desk => desk.threads.create('t1', { status: 'approval' }, [
      pendingRequest('long-q', { kind: 'question', questions: [{ id: 'q1', question: 'x'.repeat(over) }] }),
      pendingRequest('wide-q', { kind: 'question', questions: [{ id: 'q1', question: 'Which?', options: [{ label: 'o'.repeat(over) }] }] }),
      pendingRequest('many-q', { kind: 'question', questions: Array.from({ length: 21 }, (_, index) => ({ id: `q${index}`, question: `Q${index}?` })) }),
      pendingRequest('warned', { policy: { decision: 'ask', reasons: [], warnings: ['w'.repeat(over)] } })
    ]))
    const { threads } = phone.desk
    const socket = await signIn(phone)
    const answer = (requestId: string, response: unknown) => run(socket, 'thread.respondRequest', { threadId: 't1', requestId, generation: 1, response })
    const listed = (await subscribe(socket, 'pendingRequests')).frames[0].data as { requests: Array<{ requestId: string; answerable: boolean; decisions: string[]; truncated?: true }> }
    expect(listed.requests.map(request => [request.requestId, request.truncated, request.answerable, request.decisions])).toEqual([
      ['long-q', true, false, []], ['wide-q', true, false, []], ['many-q', true, false, []], ['warned', true, true, ['decline']]
    ])
    for (const requestId of ['long-q', 'wide-q', 'many-q']) {
      expect(await answer(requestId, { answers: { q1: ['a'] } })).toMatchObject({ code: 'forbidden' })
      expect(await answer(requestId, { decision: 'decline' })).toMatchObject({ code: 'forbidden' })
    }
    expect(await answer('warned', { decision: 'accept' })).toMatchObject({ code: 'forbidden' })
    expect(await answer('warned', { decision: 'decline' })).toMatchObject({ type: 'ack', result: { resolution: 'declined' } })
    expect(threads.responses.map(entry => entry.requestId)).toEqual(['warned'])
  })

  test('respondRequest: answered once by id and generation; not answerable is forbidden; repeats and old generations are refused', async () => {
    const phone = await phoneWithDesktop(harnesses, desk => desk.threads.create('t1', { status: 'approval' }, [
      pendingRequest('r1'),
      pendingRequest('guarded', { policy: { decision: 'ask', reasons: [], guarded: true } }),
      pendingRequest('perm', { kind: 'permissions' }),
      pendingRequest('ask', { kind: 'question', questions: [{ id: 'q1', question: 'Which?' }] }),
      pendingRequest('secret', { kind: 'question', questions: [{ id: 'q1', question: 'Token?', secret: true }] }),
      pendingRequest('session-only', { availableDecisions: ['acceptForSession', 'decline'] })
    ]))
    const { threads } = phone.desk
    const socket = await signIn(phone)
    const answer = (requestId: string, response: unknown, generation = 1) => run(socket, 'thread.respondRequest', { threadId: 't1', requestId, generation, response })
    expect(await answer('r1', { decision: 'accept' })).toMatchObject({ type: 'ack', result: { resolution: 'approved' } })
    expect(await answer('r1', { decision: 'accept' })).toMatchObject({ code: 'not-pending' })
    for (const requestId of ['guarded', 'perm', 'secret']) expect(await answer(requestId, { decision: 'decline' })).toMatchObject({ code: 'forbidden' })
    expect(await answer('ask', { answers: { q1: ['main'] } }, 0)).toMatchObject({ code: 'stale-generation' })
    expect(await answer('ask', { answers: { other: ['x'] } })).toMatchObject({ code: 'forbidden' })
    expect(await answer('ask', { answers: { q1: ['main'] } })).toMatchObject({ type: 'ack', result: { resolution: 'answered' } })
    expect(await answer('session-only', { decision: 'acceptForSession' })).toMatchObject({ code: 'malformed' })
    expect(await answer('session-only', { decision: 'accept' })).toMatchObject({ code: 'forbidden' })
    expect(await answer('session-only', { decision: 'decline', reason: 'not now' })).toMatchObject({ type: 'ack', result: { resolution: 'declined' } })
    expect(await answer('nope', { decision: 'accept' })).toMatchObject({ code: 'not-pending' })
    expect(threads.responses.map(entry => [entry.requestId, entry.response, entry.generation])).toEqual([
      ['r1', { decision: 'accept' }, 1], ['ask', { answers: { q1: ['main'] } }, 1], ['session-only', { decision: 'decline', reason: 'not now' }, 1]
    ])
    // A conversation that moved to a newer generation refuses an answer for the old one, before the provider sees it.
    threads.append('t1', pendingRequest('late'))
    threads.update('t1', thread => { thread.generation = 2 })
    expect(await answer('late', { decision: 'accept' })).toMatchObject({ code: 'stale-generation' })
    expect(threads.responses).toHaveLength(3)
  })

  test('history pages back by beforeSeq until there is nothing older', async () => {
    const phone = await phoneWithDesktop(harnesses, desk => desk.threads.create('t1', {}, Array.from({ length: 120 }, (_, index) => ({ type: 'message' as const, id: `m${index}`, role: 'user' as const, text: `#${index}` }))))
    const socket = await signIn(phone)
    const snapshot = (await subscribe(socket, 'thread', { target: 't1' })).frames[0].data as { items: Array<{ seq: number }>; hasMore: boolean }
    expect(snapshot.items.map(entry => entry.seq)).toEqual(Array.from({ length: 50 }, (_, index) => 70 + index))
    expect(snapshot.hasMore).toBe(true)
    const older = await run(socket, 'thread.history', { threadId: 't1', beforeSeq: 70 })
    const page = older.result as { items: Array<{ seq: number }>; hasMore: boolean; thread: { id: string } }
    expect(page.thread.id).toBe('t1')
    expect(page.items.map(entry => entry.seq)).toEqual(Array.from({ length: REMOTE_TEXT_LIMITS.threadPage }, (_, index) => 20 + index))
    expect(page.hasMore).toBe(true)
    const oldest = (await run(socket, 'thread.history', { threadId: 't1', beforeSeq: 20 })).result as typeof page
    expect(oldest.items.map(entry => entry.seq)).toEqual(Array.from({ length: 20 }, (_, index) => index))
    expect(oldest.hasMore).toBe(false)
    expect(await run(socket, 'thread.history', { threadId: 't1', beforeSeq: 1.5 })).toMatchObject({ code: 'malformed' })
    expect(await run(socket, 'thread.history', { threadId: 'gone', beforeSeq: 1 })).toMatchObject({ code: 'not-found' })
  })
})

describe('remote commands: terminal', () => {
  test('terminal.write only on a pane the person shared, at most 4 KiB', async () => {
    const phone = await phoneWithDesktop(harnesses, desk => { desk.terminals.start('p1'); desk.terminals.start('p2') })
    const socket = await signIn(phone)
    expect(await run(socket, 'terminal.write', { paneId: 'p1', data: 'ls\r' })).toMatchObject({ code: 'pane-not-shared' })
    phone.h.gateway.setPhoneWrite({ paneId: 'p1', allowed: true })
    expect(await run(socket, 'terminal.write', { paneId: 'p1', data: 'ls\r' })).toMatchObject({ type: 'ack' })
    expect(await run(socket, 'terminal.write', { paneId: 'p2', data: 'ls\r' })).toMatchObject({ code: 'pane-not-shared' })
    expect(await run(socket, 'terminal.write', { paneId: 'p1', data: 'é'.repeat(REMOTE_LIMITS.terminalWriteBytes / 2 + 1) })).toMatchObject({ code: 'malformed' })
    expect(await run(socket, 'terminal.write', { paneId: 'p1', data: 'x'.repeat(REMOTE_LIMITS.terminalWriteBytes) })).toMatchObject({ type: 'ack' })
    phone.h.gateway.setPhoneWrite({ paneId: 'p9', allowed: true })
    expect(await run(socket, 'terminal.write', { paneId: 'p9', data: 'ls' })).toMatchObject({ code: 'not-found' })
    expect(phone.desk.terminals.written.map(entry => [entry.paneId, entry.data.length])).toEqual([['p1', 3], ['p1', REMOTE_LIMITS.terminalWriteBytes]])
  })
})

describe('remote commands: limits, audit and what the phone may never do', () => {
  test('every command counts toward the per-device rate and leaves an audit row with the device id', async () => {
    const phone = await phoneWithDesktop(harnesses, desk => desk.threads.create('t1'))
    const socket = await signIn(phone)
    expect(await run(socket, 'thread.send', { threadId: 't1', text: 'secret plan ghp_abc', clientId: 'client-0001' })).toMatchObject({ type: 'ack' })
    expect(await run(socket, 'thread.interrupt', { threadId: 't1' })).toMatchObject({ code: 'not-pending' })
    expect(await run(socket, 'host.exec', {})).toMatchObject({ code: 'unknown-command' })
    expect(await run(socket, 'thread.send', { threadId: 't1', text: 'x', clientId: 'client-0002', extra: { action: 'secrets.read' } })).toMatchObject({ code: 'forbidden' })
    const rows = audits(phone)
    expect(rows.map(row => [row.outcome, row.detail, row.deviceId])).toEqual([
      ['ok', 'thread.send t1', phone.deviceId], ['not-pending', 'thread.interrupt t1', phone.deviceId],
      ['unknown-command', 'unknown', phone.deviceId], ['forbidden', 'thread.send t1', phone.deviceId]
    ])
    expect(JSON.stringify(rows)).not.toContain('secret plan')
    for (let index = 4; index < REMOTE_LIMITS.commandsPerMinute; index += 1) await run(socket, 'thread.history', { threadId: 't1', beforeSeq: 0 })
    const limited = await run(socket, 'thread.send', { threadId: 't1', text: 'more', clientId: 'client-0003' })
    expect(limited).toMatchObject({ code: 'rate-limited', retryAfterMs: expect.any(Number) })
    expect(await run(socket, 'nope', {})).toMatchObject({ code: 'rate-limited' })
    expect(phone.desk.threads.sent).toHaveLength(1)
    // One audit row per command, and only the first refusal of the minute for a device past its limit.
    expect(audits(phone)).toHaveLength(REMOTE_LIMITS.commandsPerMinute + 1)
    phone.h.clock += 60_001
    expect(await run(socket, 'thread.send', { threadId: 't1', text: 'more', clientId: 'client-0003' })).toMatchObject({ type: 'ack' })
  })

  test('forbidden capabilities and unknown commands are refused', async () => {
    const phone = await phoneWithDesktop(harnesses, desk => desk.threads.create('t1', { status: 'approval' }, [pendingRequest('r1')]))
    const socket = await signIn(phone)
    for (const forbidden of REMOTE_FORBIDDEN.slice(0, 5)) {
      expect(await run(socket, forbidden, { threadId: 't1' })).toMatchObject({ code: 'unknown-command' })
      expect(await run(socket, 'thread.respondRequest', { threadId: 't1', requestId: 'r1', generation: 1, response: { decision: 'accept', reason: forbidden } })).toMatchObject({ code: 'forbidden' })
    }
    for (const command of ['remote.setPhoneWrite', 'thread.approve', 'thread.access', '', 'THREAD.SEND']) expect(await run(socket, command, {})).toMatchObject({ code: 'unknown-command' })
    expect(phone.desk.threads.responses).toEqual([])
  })
})

describe('remote: phone write', () => {
  test('off by default, set and cleared from the window, gone after a restart or switching off, never from the phone', async () => {
    const phone = await phoneWithDesktop(harnesses, desk => desk.terminals.start('p1'))
    const { h } = phone
    expect(h.gateway.status().phoneWritePanes).toEqual([])
    expect(h.gateway.setPhoneWrite({ paneId: 'p1', allowed: true }).phoneWritePanes).toEqual(['p1'])
    expect(h.changes.at(-1)?.status?.phoneWritePanes).toEqual(['p1'])
    expect(h.gateway.setPhoneWrite({ paneId: 'p1', allowed: false }).phoneWritePanes).toEqual([])
    for (const input of [{ paneId: 'p1' }, { paneId: 'p1', allowed: 'yes' }, { paneId: '../p1', allowed: true }, { paneId: 'p1', allowed: true, extra: 1 }, null]) {
      expect(() => h.gateway.setPhoneWrite(input)).toThrow()
    }
    expect(new RemoteStore(h.db).auditEntries(50).filter(entry => entry.action === 'phone-write').map(entry => entry.outcome)).toEqual(['off', 'on'])

    // The phone has no way to set it: no command, no argument.
    const socket = await signIn(phone)
    expect(await run(socket, 'remote.setPhoneWrite', { paneId: 'p1', allowed: true })).toMatchObject({ code: 'unknown-command' })
    expect(await run(socket, 'terminal.write', { paneId: 'p1', data: 'x', phoneWrite: true })).toMatchObject({ code: 'malformed' })
    expect(h.gateway.status().phoneWritePanes).toEqual([])

    h.gateway.setPhoneWrite({ paneId: 'p1', allowed: true })
    await h.gateway.setEnabled({ enabled: false })
    expect(h.gateway.status().phoneWritePanes).toEqual([])

    h.gateway.setPhoneWrite({ paneId: 'p1', allowed: true })
    await h.gateway.stop()
    h.gateway = h.create({ desktop: phone.desk.desktop })
    expect(h.gateway.status().phoneWritePanes).toEqual([])
  })
})
