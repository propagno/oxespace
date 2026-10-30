// @vitest-environment node
import { afterEach, describe, expect, test } from 'vitest'
import { REMOTE_LIMITS, REMOTE_TEXT_LIMITS, type RemoteThreadItem } from '../../shared/remote/protocol'
import { received } from '../helpers/remote-client'
import { addDelegation, addJob, pendingRequest, ROOT } from '../helpers/remote-desktop'
import type { Harness } from '../helpers/remote-gateway-harness'
import { away, collect, ended, lastCursor, phoneWithDesktop, quiet, signIn, sleep, subscribe, type Frame } from '../helpers/remote-session'

const harnesses: Harness[] = []
afterEach(async () => { await Promise.all(harnesses.splice(0).map(value => value.close())) })

const data = <T>(frame: Frame) => frame.data as T

describe('remote topics: snapshot, events, resume by cursor', () => {
  test('workspaces: snapshot, an event when a pane is shared, resume after 30 s away, expired cursor', async () => {
    const phone = await phoneWithDesktop(harnesses, desk => desk.agents.states.push({ paneId: 'p2', agent: 'claude', state: 'working' }))
    let socket = await signIn(phone)
    const first = await subscribe(socket, 'workspaces')
    expect(first.frames).toHaveLength(1)
    expect(first.frames[0]).toMatchObject({ type: 'snapshot', seq: 1, schemaVersion: 1, cursor: expect.stringMatching(/^w\./) })
    expect(data<{ workspaces: unknown[] }>(first.frames[0]).workspaces).toEqual([{
      id: 'ws1', name: 'proj', active: true, panes: [
        { id: 'p1', title: 'Build', kind: 'terminal', phoneWrite: false },
        { id: 'p2', title: 'claude', kind: 'agent', agent: 'claude', agentState: 'working', phoneWrite: false }
      ]
    }])
    phone.h.gateway.setPhoneWrite({ paneId: 'p1', allowed: true })
    const [event] = await collect(socket, ended)
    expect(event).toMatchObject({ type: 'event', seq: 2 })
    expect(data<{ workspaces: Array<{ panes: Array<{ phoneWrite: boolean }> }> }>(event).workspaces[0].panes[0].phoneWrite).toBe(true)
    const cursor = event.cursor as string
    await quiet(socket)

    away(phone, socket)
    phone.h.db.prepare("UPDATE workspaces SET name = 'renamed' WHERE id = 'ws1'").run()
    socket = await signIn(phone)
    const resumed = await subscribe(socket, 'workspaces', { cursor })
    expect(resumed.frames).toHaveLength(1)
    expect(resumed.frames[0]).toMatchObject({ type: 'event', seq: 1 })
    expect(data<{ workspaces: Array<{ name: string }> }>(resumed.frames[0]).workspaces[0].name).toBe('renamed')
    // Resuming at the current state sends nothing; an unknown cursor gets a snapshot.
    const second = await signIn(phone)
    await second.ask({ type: 'subscribe', id: 'same', topic: 'workspaces', cursor: resumed.frames[0].cursor })
    await quiet(second)
    expect((await subscribe(second, 'workspaces', { cursor: 'w.not-a-state-we-know' })).frames[0].type).toBe('snapshot')
  })

  test('threads: snapshot, upserts of what changed, removals, resume with no loss and no repeat', async () => {
    const phone = await phoneWithDesktop(harnesses, desk => {
      desk.threads.create('t1', { updatedAt: 10 })
      desk.threads.create('t2', { updatedAt: 20 })
      desk.threads.create('t3', { updatedAt: 30, archived: true })
    })
    const { threads } = phone.desk
    let socket = await signIn(phone)
    const first = await subscribe(socket, 'threads')
    expect(data<{ threads: Array<{ id: string }> }>(first.frames[0]).threads.map(thread => thread.id)).toEqual(['t2', 't1'])
    threads.update('t1', thread => { thread.title = 'Renamed'; thread.status = 'running' })
    const [event] = await collect(socket, ended)
    expect(data(event)).toEqual({ upsert: [expect.objectContaining({ id: 't1', title: 'Renamed', status: 'running' })] })

    away(phone, socket)
    threads.create('t4', { updatedAt: 999 })
    threads.update('t2', thread => { thread.archived = true })
    socket = await signIn(phone)
    const resumed = await subscribe(socket, 'threads', { cursor: event.cursor })
    expect(resumed.frames).toHaveLength(1)
    expect(data(resumed.frames[0])).toEqual({ upsert: [expect.objectContaining({ id: 't4' })], removed: ['t2'] })
    expect((await subscribe(socket, 'threads', { cursor: 't.expired' })).frames[0]).toMatchObject({ type: 'snapshot' })
  })

  test('thread: newest page, then only the new items, then resume from epoch:revision; another epoch gets a snapshot', async () => {
    const phone = await phoneWithDesktop(harnesses, desk => desk.threads.create('t1', {}, [
      { type: 'message', id: 'm1', role: 'user', text: 'hello' },
      { type: 'activity', id: 'a', phase: 'reasoning', at: 1 },
      { type: 'message', id: 'm2', role: 'assistant', text: 'hi' }
    ]))
    const { threads } = phone.desk
    let socket = await signIn(phone)
    expect(await socket.ask({ type: 'subscribe', id: 'x', topic: 'thread', target: 'missing' })).toMatchObject({ type: 'error', code: 'not-found' })
    const first = await subscribe(socket, 'thread', { target: 't1' })
    expect(first.frames[0]).toMatchObject({ type: 'snapshot', schemaVersion: 2, cursor: expect.stringMatching(/^[0-9a-f-]+:\d+$/) })
    const snapshot = data<{ items: Array<{ seq: number; item: RemoteThreadItem }>; hasMore: boolean; thread: { id: string } }>(first.frames[0])
    expect(snapshot.items).toEqual([
      { seq: 0, item: { type: 'message', id: 'm1', role: 'user', text: 'hello' } },
      { seq: 2, item: { type: 'message', id: 'm2', role: 'assistant', text: 'hi' } }
    ])
    expect(snapshot.hasMore).toBe(false)

    threads.append('t1', { type: 'message', id: 'm2', role: 'assistant', text: 'hi there' })
    const [grown] = await collect(socket, ended)
    expect(data<{ items: unknown[] }>(grown).items).toEqual([{ seq: 2, item: { type: 'message', id: 'm2', role: 'assistant', text: 'hi there' } }])

    away(phone, socket)
    threads.append('t1', { type: 'tool', id: 'tool1', name: 'Bash', state: 'completed', detail: 'ls' }, { type: 'completed', status: 'completed' })
    socket = await signIn(phone)
    const resumed = await subscribe(socket, 'thread', { target: 't1', cursor: grown.cursor })
    expect(resumed.frames).toHaveLength(1)
    expect(data<{ items: Array<{ seq: number }> }>(resumed.frames[0]).items.map(entry => entry.seq)).toEqual([3, 4])
    const stale = await subscribe(socket, 'thread', { target: 't1', cursor: '00000000-0000-0000-0000-000000000000:1' })
    expect(stale.frames[0].type).toBe('snapshot')
  })

  test('pendingRequests: the whole list each time, resumed by cursor', async () => {
    const phone = await phoneWithDesktop(harnesses, desk => desk.threads.create('t1', { status: 'approval' }, [pendingRequest('r1')]))
    let socket = await signIn(phone)
    const first = await subscribe(socket, 'pendingRequests')
    expect(data<{ requests: Array<{ requestId: string; answerable: boolean }> }>(first.frames[0]).requests).toEqual([expect.objectContaining({ requestId: 'r1', answerable: true, decisions: ['accept', 'decline'] })])
    phone.desk.threads.append('t1', pendingRequest('r2'))
    const [event] = await collect(socket, ended)
    expect(data<{ requests: Array<{ requestId: string }> }>(event).requests.map(request => request.requestId)).toEqual(['r1', 'r2'])
    away(phone, socket)
    await phone.desk.threads.respond('t1', 'r1', { decision: 'accept' })
    socket = await signIn(phone)
    const resumed = await subscribe(socket, 'pendingRequests', { cursor: event.cursor })
    expect(resumed.frames[0].type).toBe('event')
    expect(data<{ requests: Array<{ requestId: string }> }>(resumed.frames[0]).requests.map(request => request.requestId)).toEqual(['r2'])
  })

  test('terminal: what the ring keeps, then what came after; resume by cursor; a new process gets a snapshot', async () => {
    const phone = await phoneWithDesktop(harnesses, desk => { desk.terminals.start('p1'); desk.terminals.print('p1', 'one\r\n') })
    const { terminals } = phone.desk
    let socket = await signIn(phone)
    expect(await socket.ask({ type: 'subscribe', id: 'x', topic: 'terminal', target: 'p2' })).toMatchObject({ code: 'not-found' })
    const first = await subscribe(socket, 'terminal', { target: 'p1' })
    expect(data(first.frames[0])).toEqual({ data: 'one\r\n', truncated: false })
    terminals.print('p1', 'two\r\n')
    const [event] = await collect(socket, ended)
    expect(data(event)).toEqual({ data: 'two\r\n', truncated: false })

    away(phone, socket)
    terminals.print('p1', 'three\r\n')
    terminals.print('p1', 'four\r\n')
    socket = await signIn(phone)
    const resumed = await subscribe(socket, 'terminal', { target: 'p1', cursor: event.cursor })
    expect(resumed.frames.map(frame => frame.type)).toEqual(['event'])
    expect(data(resumed.frames[0])).toEqual({ data: 'three\r\nfour\r\n', truncated: false })

    terminals.start('p1', 'restarted')
    terminals.print('p1', 'fresh')
    const [replaced] = await collect(socket, ended)
    expect(replaced).toMatchObject({ type: 'snapshot', data: { data: 'fresh', truncated: false } })
    expect((await subscribe(socket, 'terminal', { target: 'p1', cursor: 'bogus:1' })).frames[0].type).toBe('snapshot')
  })

  test('jobs and delegations: the whole list each time, resumed by cursor', async () => {
    const phone = await phoneWithDesktop(harnesses, (desk, h) => { addJob(h.db, 'j1'); addDelegation(h.db, 'd1', {}) })
    let socket = await signIn(phone)
    const jobs = await subscribe(socket, 'jobs')
    expect(data(jobs.frames[0])).toEqual({ jobs: [{ id: 'j1', workspaceId: 'ws1', label: 'Job j1', status: 'running', exitCode: null, startedAt: 10, finishedAt: null }] })
    const delegations = await subscribe(socket, 'delegations')
    expect(data(delegations.frames[0])).toEqual({ delegations: [{ id: 'd1', workspaceId: 'ws1', objective: 'Do the thing', state: 'running', branch: 'oxe/task', updatedAt: 1 }] })
    addJob(phone.h.db, 'j1', { status: 'exited', exitCode: 0 })
    const [jobEvent] = await collect(socket, ended)
    expect(jobEvent).toMatchObject({ type: 'event', subscription: jobs.subscription, data: { jobs: [{ status: 'exited', exitCode: 0 }] } })
    away(phone, socket)
    addDelegation(phone.h.db, 'd1', {}, { state: 'completed', updatedAt: 2 })
    socket = await signIn(phone)
    const resumedJobs = await socket.ask({ type: 'subscribe', id: 'rj', topic: 'jobs', cursor: jobEvent.cursor })
    expect(resumedJobs.type).toBe('ack')
    const resumed = await subscribe(socket, 'delegations', { cursor: lastCursor(delegations.frames) })
    expect(resumed.frames[0]).toMatchObject({ type: 'event', data: { delegations: [{ state: 'completed' }] } })
    await quiet(socket)
  })
})

describe('remote topics: frames stay under the cap', () => {
  test('a snapshot over 64 KiB comes in pages; the phone applies it on the last; long text is cut to the limits', async () => {
    const long = 'é'.repeat(REMOTE_TEXT_LIMITS.itemText + 500)
    const events = Array.from({ length: 60 }, (_, index) => ({ type: 'message' as const, id: `m${index}`, role: 'assistant' as const, text: `${index} ${long}` }))
    const phone = await phoneWithDesktop(harnesses, desk => {
      desk.threads.create('t1', {}, events)
      desk.terminals.start('p1', 's', 1024 * 1024)
      desk.terminals.print('p1', `\u001b[31m${'x'.repeat(150_000)}\u001b[0m`)
    })
    const socket = await signIn(phone)
    const { frames } = await subscribe(socket, 'thread', { target: 't1' })
    expect(frames.length).toBeGreaterThan(1)
    frames.forEach((frame, index) => expect(frame.page).toEqual({ index, last: index === frames.length - 1 }))
    expect(frames.filter(frame => frame.cursor)).toEqual([frames.at(-1)])
    const items = frames.flatMap(frame => data<{ items: Array<{ seq: number; item: Extract<RemoteThreadItem, { type: 'message' }> }> }>(frame).items)
    expect(items).toHaveLength(REMOTE_TEXT_LIMITS.threadPage)
    expect(items[0].seq).toBe(10)
    expect(frames.every(frame => data<{ hasMore: boolean }>(frame).hasMore)).toBe(true)
    for (const { item } of items) { expect(item.text.length).toBeLessThanOrEqual(REMOTE_TEXT_LIMITS.itemText); expect(item.truncated).toBe(true) }

    const terminal = await subscribe(socket, 'terminal', { target: 'p1' })
    expect(terminal.frames.length).toBeGreaterThan(4)
    const pieces = terminal.frames.map(frame => data<{ data: string }>(frame).data)
    for (const piece of pieces) expect(piece.length).toBeLessThanOrEqual(REMOTE_TEXT_LIMITS.terminalChunk)
    expect(pieces.join('')).toBe(`\u001b[31m${'x'.repeat(150_000)}\u001b[0m`)
    for (const frame of [...frames, ...terminal.frames]) expect(Buffer.byteLength(JSON.stringify(frame))).toBeLessThanOrEqual(REMOTE_LIMITS.maxFrameBytes)
  })
})

describe('remote topics: what never reaches the phone', () => {
  test('absolute paths, session ids, cost, secrets, secret questions, job command lines and delegation handoffs are filtered', async () => {
    const SESSION = 'native-session-5f1c2b9a', COMMAND_LINE = 'deploy --password=hunter2-cli', HANDOFF = 'HANDOFF-CONTEXT-77'
    const GH = `ghp_${'a'.repeat(36)}`, SK = `sk-ant-${'b'.repeat(30)}`, SECRET_Q = 'What is the vault passphrase?'
    const elsewhere = process.platform === 'win32' ? 'D:\\secret\\other\\file.txt' : '/var/secret/other/file.txt'
    const phone = await phoneWithDesktop(harnesses, (desk, h) => {
      desk.threads.create('t1', { status: 'approval', nativeSessionId: SESSION, title: `Fix ${ROOT}${process.platform === 'win32' ? '\\' : '/'}src`,
        costReport: { totalUsd: 4.2137, turns: 1, updatedAt: 1, source: 'claude-result' } }, [
        { type: 'session', nativeSessionId: SESSION },
        { type: 'turn-cost', usd: 4.2137 },
        { type: 'message', id: 'u', role: 'user', text: `look at ${elsewhere}`, attachments: [{ id: 'att', name: 'private-screenshot.png', mimeType: 'image/png', bytes: 1 }], context: [{ path: `${ROOT}/ctx.md`, bytes: 1 }] },
        { type: 'tool', id: 'tool', name: 'Bash', state: 'completed', detail: `curl -H "Authorization: Bearer ${GH}" x`, output: `token=${SK}\nat ${elsewhere}` },
        pendingRequest('r1', { command: `export GITHUB_TOKEN=${GH} && git push`, cwd: `${ROOT}${process.platform === 'win32' ? '\\' : '/'}pkg`, paths: [`${ROOT}/a.ts`, elsewhere],
          policy: { decision: 'ask', reasons: [], warnings: [`reads ${SK}`] } }),
        pendingRequest('r2', { kind: 'question', title: 'Questions', questions: [{ id: 'q1', question: 'Which branch?' }, { id: 'q2', question: SECRET_Q, secret: true }] }),
        pendingRequest('r3', { cwd: elsewhere, policy: { decision: 'ask', reasons: [], guarded: true } })
      ])
      desk.terminals.start('p1')
      desk.terminals.print('p1', `$ echo ${SK}\r\n${SK}\r\nPS ${elsewhere}> `)
      addJob(h.db, 'j1', { command: COMMAND_LINE })
      addDelegation(h.db, 'd1', { handoff: HANDOFF, context: HANDOFF, evidence: [{ path: elsewhere, text: HANDOFF }], path: elsewhere, baseSha: 'abc123def', cwd: ROOT },
        { objective: `${'Refactor the parser at '.repeat(40)}${elsewhere}` })
    })
    const start = received.length
    const socket = await signIn(phone)
    const topics: Record<string, Frame[]> = {}
    for (const [topic, extra] of [['workspaces', {}], ['threads', {}], ['thread', { target: 't1' }], ['pendingRequests', {}], ['terminal', { target: 'p1' }], ['jobs', {}], ['delegations', {}]] as const) {
      topics[topic] = (await subscribe(socket, topic, extra)).frames
    }
    const everything = received.slice(start).join('\n')
    for (const needle of [SESSION, '4.2137', 'private-screenshot', 'ctx.md', GH, SK, 'hunter2', COMMAND_LINE, SECRET_Q, HANDOFF, 'abc123def', elsewhere, ROOT]) {
      // As sent, a Windows path's backslashes are escaped in the JSON.
      for (const form of [needle, JSON.stringify(needle).slice(1, -1)]) expect(everything, needle).not.toContain(form)
    }
    const thread = data<{ items: Array<{ item: RemoteThreadItem }> }>(topics.thread[0]).items.map(entry => entry.item)
    expect(thread.find(item => item.id === 'u')).toMatchObject({ attachments: 1, text: 'look at …' })
    expect(thread.find(item => item.id === 'tool')).toMatchObject({ redacted: 2 })
    const requests = data<{ requests: Array<Record<string, unknown>> }>(topics.pendingRequests[0]).requests
    expect(requests[0]).toMatchObject({ requestId: 'r1', cwd: 'pkg', paths: ['a.ts'], redacted: 2, answerable: true })
    expect(requests[1]).toMatchObject({ requestId: 'r2', questions: [{ id: 'q1', question: 'Which branch?' }], answerable: false })
    expect(requests[2]).toMatchObject({ requestId: 'r3', answerable: false })
    expect(requests[2].cwd).toBeUndefined()
    expect(data<{ data: string; redacted: number }>(topics.terminal[0])).toMatchObject({ redacted: 2 })
    expect(data<{ jobs: unknown[] }>(topics.jobs[0]).jobs[0]).not.toHaveProperty('command')
    const delegation = data<{ delegations: Array<{ objective: string }> }>(topics.delegations[0]).delegations[0]
    expect(Object.keys(delegation).sort()).toEqual(['branch', 'id', 'objective', 'state', 'updatedAt', 'workspaceId'])
    expect(delegation.objective.length).toBe(REMOTE_TEXT_LIMITS.objective)
    expect(data<{ threads: Array<{ title: string }> }>(topics.threads[0]).threads[0].title).toMatch(/^Fix \.[\\/]src$/)
  })
})

describe('remote topics: lifecycle', () => {
  test('unsubscribing, disconnecting and revoking release every listener and timer', async () => {
    const phone = await phoneWithDesktop(harnesses, desk => { desk.threads.create('t1'); desk.terminals.start('p1') })
    const { threads, terminals } = phone.desk
    const socket = await signIn(phone)
    const thread = await subscribe(socket, 'thread', { target: 't1' })
    await subscribe(socket, 'threads')
    await subscribe(socket, 'terminal', { target: 'p1' })
    await subscribe(socket, 'jobs')
    expect(threads.listenerCount).toBe(2)
    expect(terminals.listenerCount).toBe(1)
    expect(await socket.ask({ type: 'unsubscribe', id: 'u', subscription: thread.subscription })).toMatchObject({ type: 'ack' })
    expect(threads.listenerCount).toBe(1)
    socket.close()
    await socket.closed
    await sleep(100)
    expect(threads.listenerCount + terminals.listenerCount).toBe(0)

    const again = await signIn(phone)
    await subscribe(again, 'threads')
    await subscribe(again, 'terminal', { target: 'p1' })
    expect(threads.listenerCount + terminals.listenerCount).toBe(2)
    phone.h.gateway.revoke({ deviceId: phone.deviceId })
    expect(threads.listenerCount + terminals.listenerCount).toBe(0)
    expect(await again.next()).toMatchObject({ type: 'error', code: 'revoked' })
    // Nothing keeps being read for a closed stream.
    threads.update('t1', value => { value.title = 'later' })
    await sleep(100)
    expect(again.frames.filter(frame => (frame as Frame).type === 'event')).toEqual([])
  })
})
