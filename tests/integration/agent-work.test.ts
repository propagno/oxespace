import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../electron/main/db'
import { ThreadManager } from '../../electron/main/services/conversation/thread-manager'
import { validatePlan, WorkError } from '../../electron/main/services/work/work-service'
import type { AgentConversationAdapter, ConversationThread, ThreadEvent } from '../../shared/types/thread'
import type { WorkPlanInput } from '../../shared/types/work'
import { removeTempDir } from '../helpers/removeTempDir'

const roots: string[] = []
const databases: AppDatabase[] = []
const managers: ThreadManager[] = []
afterEach(async () => {
  for (const manager of managers.splice(0)) await manager.stop()
  for (const db of databases.splice(0)) db.close()
  for (const root of roots.splice(0)) removeTempDir(root)
})

interface Fake { emit: (event: ThreadEvent) => void; sent: string[]; interrupts: number }

async function setup(access: 'read-only' | 'workspace-write' = 'workspace-write') {
  const root = mkdtempSync(join(tmpdir(), 'oxe-work-')); roots.push(root)
  // Its own repository, so checkpoints never scan a repository the temp folder happens to sit in.
  execFileSync('git', ['init', '-q'], { cwd: root })
  const db = openInMemoryDatabase(); databases.push(db)
  db.prepare("INSERT INTO workspaces (id, name, root_path, layout, default_shell_profile_id) VALUES ('A', 'A', ?, '1x1', 'builtin-claude')").run(root)
  const fakes = new Map<string, Fake>()
  const factory = vi.fn(async (thread: ConversationThread) => {
    const fake: Fake = { emit: () => {}, sent: [], interrupts: 0 }
    fakes.set(thread.id, fake)
    return {
      capabilities: { resume: true, approvals: true, attachments: false, modelSelection: false },
      start: vi.fn(async (_context, listener) => { fake.emit = listener; listener({ type: 'session', nativeSessionId: `n-${thread.id}` }) }),
      send: vi.fn(async (text: string) => { fake.sent.push(text) }),
      interrupt: vi.fn(async () => { fake.interrupts += 1; fake.emit({ type: 'completed', status: 'interrupted' }) }),
      approve: vi.fn(async () => {}), dispose: vi.fn(async () => {}), configure: vi.fn(async () => {})
    } as AgentConversationAdapter
  })
  const manager = new ThreadManager(db, factory, vi.fn()); managers.push(manager)
  vi.spyOn((manager as unknown as { turns: { workingState: () => Promise<undefined> } }).turns, 'workingState').mockResolvedValue(undefined)
  ;(manager.work as unknown as { limits: { wakeDelayMs: number } }).limits.wakeDelayMs = 0
  const supervisor = manager.create({ workspaceId: 'A', projectId: 'p', rootPath: root, provider: 'claude' }).thread
  await manager.configure(supervisor.id, { access }, supervisor.configurationRevision ?? 0)
  // Starting a worker spawns git for its checkpoint, so settling waits until every started worker received its prompt.
  const settle = async () => {
    for (let index = 0; index < 400; index += 1) {
      await new Promise(resolve => setTimeout(resolve, 15))
      const waiting = manager.work.runsFor(supervisor.id).flatMap(run => run.tasks).some(task => task.status === 'running' && (!task.threadId || !fakes.get(task.threadId)?.sent.length))
      if (!waiting && index >= 4) return
    }
  }
  const worker = (runId: string, key: string) => {
    const task = manager.work.run(runId).tasks.find(value => value.key === key)!
    const fake = fakes.get(task.threadId!)
    if (!fake) throw Error(`Worker ${key} has no adapter`)
    return fake
  }
  const finish = async (runId: string, key: string, text: string, status: 'completed' | 'failed' = 'completed', usd?: number) => {
    const fake = worker(runId, key)
    fake.emit({ type: 'message', id: `m-${key}-${fake.sent.length}`, role: 'assistant', text })
    if (usd !== undefined) fake.emit({ type: 'turn-cost', usd })
    fake.emit(status === 'completed' ? { type: 'completed', status } : { type: 'completed', status, error: 'Tool crashed' })
    await settle()
  }
  // Waits until the supervisor received `count` messages (a wake is a real send), then returns them.
  const supervisorMessages = async (count = 0) => {
    for (let index = 0; index < 400 && (fakes.get(supervisor.id)?.sent.length ?? 0) < count; index += 1) await new Promise(resolve => setTimeout(resolve, 15))
    return fakes.get(supervisor.id)?.sent ?? []
  }
  return { manager, supervisor, settle, worker, finish, supervisorMessages, fakes }
}

const plan = (fields: Partial<WorkPlanInput> & Pick<WorkPlanInput, 'tasks'>): WorkPlanInput => ({ key: 'plan-key-1', title: 'Ship the feature', ...fields })

describe('Agent Work', () => {
  it('fans out, joins, hands results to the dependent task and tells the supervisor once at the end', { timeout: 30_000 }, async () => {
    const { manager, supervisor, settle, worker, finish, supervisorMessages } = await setup()
    const run = manager.work.plan(supervisor.id, plan({ tasks: [
      { key: 'api', title: 'Survey the API', prompt: 'List the endpoints' },
      { key: 'ui', title: 'Survey the UI', prompt: 'List the screens' },
      { key: 'db', title: 'Survey the schema', prompt: 'List the tables' },
      { key: 'build', title: 'Build it', prompt: 'Implement the feature', dependsOn: ['api', 'ui', 'db'], access: 'workspace-write' }
    ] }))
    await settle()
    let current = manager.work.run(run.id)
    expect(current.tasks.map(task => [task.key, task.status])).toEqual([['api', 'running'], ['ui', 'running'], ['db', 'running'], ['build', 'pending']])
    expect(worker(run.id, 'api').sent[0]).toContain('List the endpoints')
    expect(worker(run.id, 'api').sent[0]).toContain('read-only')
    expect(manager.read(current.tasks[0].threadId!).thread.title).toBe('Survey the API')
    expect(manager.read(current.tasks[0].threadId!).thread.access).toBe('read-only')

    await finish(run.id, 'api', 'Three endpoints')
    await finish(run.id, 'ui', 'Two screens')
    expect(manager.work.run(run.id).tasks[3].status).toBe('pending')
    await finish(run.id, 'db', 'One table')
    current = manager.work.run(run.id)
    expect(current.tasks[3].status).toBe('running')
    expect(manager.read(current.tasks[3].threadId!).thread.access).toBe('workspace-write')
    const buildPrompt = worker(run.id, 'build').sent[0]
    expect(buildPrompt).toContain('Three endpoints')
    expect(buildPrompt).toContain('One table')
    expect(await supervisorMessages()).toEqual([])

    await finish(run.id, 'build', 'Implemented')
    current = manager.work.run(run.id)
    expect(current.status).toBe('succeeded')
    expect(current.tasks[3].result).toMatchObject({ summary: 'Implemented', verdict: 'completed' })
    const said = await supervisorMessages(1)
    expect(said).toHaveLength(1)
    expect(said[0]).toContain('every task succeeded')
    expect(manager.workRuns(supervisor.id).map(value => value.id)).toEqual([run.id])
    expect(manager.workRuns(current.tasks[0].threadId!).map(value => value.id)).toEqual([run.id])
    // Retrying the same key returns the same run.
    expect(manager.work.plan(supervisor.id, plan({ tasks: [{ key: 'x', title: 'x', prompt: 'x' }] })).id).toBe(run.id)
  })

  it('wakes the supervisor on a failure and cancels the tasks that depended on it', { timeout: 30_000 }, async () => {
    const { manager, supervisor, settle, finish, supervisorMessages } = await setup()
    const run = manager.work.plan(supervisor.id, plan({ tasks: [
      { key: 'probe', title: 'Probe', prompt: 'Probe' },
      { key: 'fix', title: 'Fix', prompt: 'Fix', dependsOn: ['probe'] }
    ] }))
    await settle()
    await finish(run.id, 'probe', 'Could not finish', 'failed')
    const current = manager.work.run(run.id)
    expect(current.status).toBe('failed')
    expect(current.tasks.map(task => [task.key, task.status])).toEqual([['probe', 'failed'], ['fix', 'cancelled']])
    expect(current.tasks[1].reason).toContain('Depends on "probe"')
    const said = await supervisorMessages(1)
    expect(said).toHaveLength(1)
    expect(said[0]).toContain('Task "probe" failed')
    expect(said[0]).toContain('ended as failed')
  })

  it('stops every worker when the budget is reached', { timeout: 30_000 }, async () => {
    const { manager, supervisor, settle, worker, finish, supervisorMessages } = await setup()
    const run = manager.work.plan(supervisor.id, plan({ budget: { usd: 0.1 }, tasks: [
      { key: 'one', title: 'One', prompt: 'One' }, { key: 'two', title: 'Two', prompt: 'Two' }, { key: 'three', title: 'Three', prompt: 'Three', dependsOn: ['one'] }
    ] }))
    await settle()
    const second = worker(run.id, 'two')
    await finish(run.id, 'one', 'Expensive', 'completed', 0.25)
    const current = manager.work.run(run.id)
    expect(current.status).toBe('blocked')
    expect(current.spent.usd).toBeCloseTo(0.25)
    expect(current.tasks.map(task => task.status)).toEqual(['succeeded', 'cancelled', 'cancelled'])
    expect(current.tasks[1].reason).toContain('Budget reached')
    expect(second.interrupts).toBe(1)
    expect((await supervisorMessages(1)).join('\n')).toContain('stopped at its budget')
    await expect(manager.work.message(run.id, 'one', 'More')).rejects.toThrow('blocked')
  })

  it('cancels the whole run for the person, stopping running workers', { timeout: 30_000 }, async () => {
    const { manager, supervisor, settle, worker, supervisorMessages } = await setup()
    const run = manager.work.plan(supervisor.id, plan({ tasks: [{ key: 'a', title: 'A', prompt: 'A' }, { key: 'b', title: 'B', prompt: 'B', dependsOn: ['a'] }] }))
    await settle()
    const first = worker(run.id, 'a')
    const cancelled = await manager.cancelWork(supervisor.id, run.id)
    await settle()
    expect(cancelled.status).toBe('cancelled')
    expect(cancelled.tasks.map(task => task.status)).toEqual(['cancelled', 'cancelled'])
    expect(first.interrupts).toBe(1)
    expect((await supervisorMessages(1)).join('\n')).toContain('The person cancelled this run')
  })

  it('reports a worker waiting for an approval, and a follow-up runs a finished task again', { timeout: 30_000 }, async () => {
    const { manager, supervisor, settle, worker, finish, supervisorMessages } = await setup()
    const run = manager.work.plan(supervisor.id, plan({ tasks: [{ key: 'edit', title: 'Edit', prompt: 'Edit', access: 'workspace-write' }] }))
    await settle()
    worker(run.id, 'edit').emit({ type: 'request', id: 'r1', request: { id: 'r1', nativeId: 'r1', nativeMethod: 'can_use_tool:Bash', kind: 'approval', title: 'Approve Bash', generation: 0, createdAt: Date.now(), state: 'pending', availableDecisions: ['accept', 'decline'] } })
    await settle()
    expect(manager.work.run(run.id).tasks[0].status).toBe('blocked')
    expect((await supervisorMessages(1)).join('\n')).toContain('waiting for an answer')
    worker(run.id, 'edit').emit({ type: 'request-resolved', id: 'r1', state: 'resolved', resolution: 'approved', resolvedAt: Date.now() })
    await finish(run.id, 'edit', 'Edited')
    expect(manager.work.run(run.id).status).toBe('succeeded')
    await manager.work.message(run.id, 'edit', 'Also update the docs')
    // settle() waits only for a worker that has received nothing; this one already has its first prompt, so wait for the
    // follow-up itself (the send runs after the turn's git checks, which can take longer than settle()'s floor).
    await vi.waitFor(() => expect(worker(run.id, 'edit').sent.at(-1)).toBe('Also update the docs'), { timeout: 5_000 })
    await settle()
    expect(manager.work.run(run.id)).toMatchObject({ status: 'running', tasks: [{ status: 'running' }] })
    expect(worker(run.id, 'edit').sent.at(-1)).toBe('Also update the docs')
    await finish(run.id, 'edit', 'Docs updated')
    expect(manager.work.run(run.id).tasks[0].result?.summary).toBe('Docs updated')
  })

  it('never gives workers more access than a read-only supervisor, and limits nesting', { timeout: 30_000 }, async () => {
    const { manager, supervisor, settle } = await setup('read-only')
    const run = manager.work.plan(supervisor.id, plan({ tasks: [{ key: 'w', title: 'W', prompt: 'W', access: 'workspace-write' }] }))
    await settle()
    const workerId = manager.work.run(run.id).tasks[0].threadId!
    expect(manager.work.run(run.id).tasks[0].access).toBe('read-only')
    expect(manager.read(workerId).thread.access).toBe('read-only')
    const nested = manager.work.plan(workerId, plan({ key: 'nested-key', tasks: [{ key: 'n', title: 'N', prompt: 'N' }] }))
    expect(nested.depth).toBe(2)
    await settle()
    const grandchild = manager.work.run(nested.id).tasks[0].threadId!
    expect(() => manager.work.plan(grandchild, plan({ key: 'deeper-key', tasks: [{ key: 'd', title: 'D', prompt: 'D' }] }))).toThrow('cannot plan more work')
  })
})

describe('validatePlan', () => {
  it('rejects cycles, unknown dependencies, duplicate keys and bad budgets, and orders dependencies first', () => {
    expect(() => validatePlan(plan({ tasks: [{ key: 'a', title: 'A', prompt: 'A', dependsOn: ['b'] }, { key: 'b', title: 'B', prompt: 'B', dependsOn: ['a'] }] }))).toThrow(/cycle/)
    expect(() => validatePlan(plan({ tasks: [{ key: 'a', title: 'A', prompt: 'A', dependsOn: ['z'] }] }))).toThrow(/unknown task z/)
    expect(() => validatePlan(plan({ tasks: [{ key: 'a', title: 'A', prompt: 'A' }, { key: 'a', title: 'A', prompt: 'A' }] }))).toThrow(/twice/)
    expect(() => validatePlan(plan({ budget: { usd: 0 }, tasks: [{ key: 'a', title: 'A', prompt: 'A' }] }))).toThrow(WorkError)
    expect(() => validatePlan(plan({ key: 'short', tasks: [{ key: 'a', title: 'A', prompt: 'A' }] }))).toThrow(/key/)
    expect(validatePlan(plan({ tasks: [{ key: 'b', title: 'B', prompt: 'B', dependsOn: ['a'] }, { key: 'a', title: 'A', prompt: 'A' }] })).tasks.map(task => task.key)).toEqual(['a', 'b'])
  })
})
