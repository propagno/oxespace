import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../electron/main/db'
import { ThreadManager } from '../../electron/main/services/conversation/thread-manager'
import { listedGeneration, respondPending } from '../../electron/main/services/conversation/thread-pending-response'
import type { AgentConversationAdapter, ThreadEvent, ThreadRequest, ThreadRequestResponse } from '../../shared/types/thread'
import { removeTempDir } from '../helpers/removeTempDir'

const roots: string[] = []
const databases: AppDatabase[] = []
afterEach(() => {
  for (const db of databases.splice(0)) db.close()
  for (const root of roots.splice(0)) removeTempDir(root)
})

/** A live conversation whose provider takes as long to accept an answer as the test says. */
async function setup() {
  const root = mkdtempSync(join(tmpdir(), 'oxe-pending-')); roots.push(root)
  const db = openInMemoryDatabase(); databases.push(db)
  db.prepare("INSERT INTO workspaces (id, name, root_path, layout, default_shell_profile_id) VALUES ('A', 'A', ?, '1x1', 'builtin-claude')").run(root)
  let emit: (event: ThreadEvent) => void = () => {}
  let hold: Promise<void> = Promise.resolve()
  const delivered: { id: string; response: ThreadRequestResponse }[] = []
  const factory = vi.fn(async () => ({
    capabilities: { resume: true, approvals: true, attachments: false, modelSelection: false },
    start: vi.fn(async (_context, listener) => { emit = listener; listener({ type: 'session', nativeSessionId: 'n' }) }),
    send: vi.fn(async () => {}), interrupt: vi.fn(async () => {}), approve: vi.fn(async () => {}), dispose: vi.fn(async () => {}), configure: vi.fn(async () => {}),
    respondRequest: vi.fn(async (id: string, response: ThreadRequestResponse) => {
      await hold
      delivered.push({ id, response })
      emit({ type: 'request-resolved', id, state: 'resolved', resolution: response.decision === 'decline' ? 'declined' : 'approved', resolvedAt: Date.now() })
    })
  }) as AgentConversationAdapter)
  const manager = new ThreadManager(db, factory, vi.fn())
  vi.spyOn((manager as unknown as { turns: { workingState: () => Promise<undefined> } }).turns, 'workingState').mockResolvedValue(undefined)
  const id = manager.create({ workspaceId: 'A', projectId: 'p', rootPath: root, provider: 'claude' }).thread.id
  await manager.send(id, 'Go')
  const ask = async (requestId: string, fields: Partial<ThreadRequest> = {}) => {
    emit({ type: 'request', id: requestId, request: {
      id: requestId, nativeId: requestId, nativeMethod: 'can_use_tool:Bash', kind: 'approval', title: 'Run it', command: 'rm -rf dist', generation: 0, createdAt: Date.now(), state: 'pending', availableDecisions: ['accept', 'decline'], ...fields
    } })
    await new Promise(resolve => setTimeout(resolve, 20))
    // The generation the request was listed under, as pendingRequestsAll reports it.
    const event = manager.read(id).events.find((value): value is Extract<ThreadEvent, { type: 'request' }> => value.type === 'request' && value.id === requestId)
    return event!.request.generation
  }
  const holdNext = () => { let release!: () => void; hold = new Promise(resolve => { release = resolve }); return () => release() }
  return { manager, id, ask, delivered, holdNext }
}

describe('answering a pending request from any window or device (B1.1)', () => {
  it('delivers exactly one of two concurrent answers and refuses the other and any later one', { timeout: 30_000 }, async () => {
    const { manager, id, ask, delivered, holdNext } = await setup()
    const generation = await ask('r1')
    const release = holdNext()
    const desktop = respondPending(manager, { threadId: id, requestId: 'r1', generation, response: { decision: 'accept' } })
    const phone = respondPending(manager, { threadId: id, requestId: 'r1', generation, response: { decision: 'decline' } })
    await new Promise(resolve => setTimeout(resolve, 20))
    release()
    const results = await Promise.all([desktop, phone])
    expect(results).toEqual([
      { ok: true, threadId: id, requestId: 'r1', resolution: 'approved' },
      { ok: false, refusal: 'alreadyResponding', message: { code: 'thread.request.alreadyResponding', params: {} } }
    ])
    expect(delivered).toEqual([{ id: 'r1', response: { decision: 'accept' } }])
    expect(await respondPending(manager, { threadId: id, requestId: 'r1', generation, response: { decision: 'decline' } }))
      .toEqual({ ok: false, refusal: 'notPending', message: { code: 'thread.request.notPending', params: {} } })
    expect(delivered).toHaveLength(1)
    expect(manager.auditLog(id).filter(entry => entry.action === 'approval')).toHaveLength(1)
    await manager.stop()
  })

  it('refuses an answer listed under another generation without delivering it', { timeout: 30_000 }, async () => {
    const { manager, id, ask, delivered } = await setup()
    const generation = await ask('r1')
    expect(await respondPending(manager, { threadId: id, requestId: 'r1', generation: generation + 1, response: { decision: 'accept' } }))
      .toMatchObject({ ok: false, refusal: 'staleGeneration', message: { code: 'thread.request.staleGeneration' } })
    expect(delivered).toEqual([])
    expect(await respondPending(manager, { threadId: id, requestId: 'r1', generation, response: { decision: 'decline' } })).toMatchObject({ ok: true, resolution: 'declined' })
    await manager.stop()
  })

  it('refuses an unknown request and a question left unanswered, and rejects an unknown conversation', { timeout: 30_000 }, async () => {
    const { manager, id, ask, delivered } = await setup()
    const generation = await ask('q1', { kind: 'question', nativeMethod: 'item/tool/requestUserInput', questions: [{ id: 'q', question: 'Which?' }] })
    expect(await respondPending(manager, { threadId: id, requestId: 'missing', generation, response: { decision: 'accept' } })).toMatchObject({ ok: false, refusal: 'notPending' })
    expect(await respondPending(manager, { threadId: id, requestId: 'q1', generation, response: { answers: { q: ['  '] } } })).toMatchObject({ ok: false, refusal: 'unanswered' })
    expect(await respondPending(manager, { threadId: id, requestId: 'q1', generation, response: { answers: { q: ['main'] } } })).toMatchObject({ ok: true, resolution: 'answered' })
    expect(delivered).toHaveLength(1)
    await expect(respondPending(manager, { threadId: 'no-such-thread', requestId: 'q1', generation, response: { decision: 'accept' } })).rejects.toThrow()
    await manager.stop()
  })
})

describe('listedGeneration', () => {
  it('takes a non-negative whole number and nothing else', () => {
    expect(listedGeneration(0)).toBe(0)
    expect(listedGeneration(7)).toBe(7)
    for (const value of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '1', null, undefined, {}]) expect(() => listedGeneration(value), String(value)).toThrow('Invalid request generation')
  })
})
