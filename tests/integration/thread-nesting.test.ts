import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../electron/main/db'
import { findTool, type ToolContext } from '../../electron/main/mcp-internal/tool-registry'
import { ThreadManager } from '../../electron/main/services/conversation/thread-manager'
import { ThreadHistory } from '../../electron/main/services/conversation/thread-history'
import { AgentActions } from '../../electron/main/services/agent-actions/agent-actions'
import { ApprovalBroker } from '../../electron/main/services/agent-actions/approval-broker'
import { ARCHIVE_CHILDREN_DEPTH, threadChildren } from '../../electron/main/services/conversation/thread-nesting'
import { ThreadDelegationHost } from '../../electron/main/services/delegation/thread-delegation-host'
import { ExecutionRegistry } from '../../electron/main/services/execution-registry'
import { threadArchiveWithChildren, threadConfirmation } from '../../shared/threadConfirmations'
import type { DelegationTask } from '../../shared/types/delegation'
import type { AgentConversationAdapter, ConversationThread, ThreadEvent, ThreadParentLink, ThreadSnapshot } from '../../shared/types/thread'
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

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'oxe-nesting-')); roots.push(root)
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
  const save = (snapshot: ThreadSnapshot) => (manager as unknown as { save: (value: ThreadSnapshot) => void }).save(snapshot)
  const create = (parent?: ThreadParentLink, title?: string) => {
    const snapshot = manager.create({ workspaceId: 'A', projectId: 'p', rootPath: root, provider: 'codex', ...(parent ? { parent } : {}) })
    if (title) { snapshot.thread.title = title; save(snapshot) }
    return snapshot.thread.id
  }
  const column = (id: string) => db.prepare('SELECT parent_thread_id AS parent, parent_via AS via FROM conversation_threads WHERE id = ?').get(id)
  return { root, db, manager, fakes, create, column, save }
}

describe('nested conversations: the persisted link (B1.3)', () => {
  it('is written at creation, read back as thread.parent on every read path, and dropped when the parent is gone', () => {
    const { db, manager, create, column } = setup()
    const parent = create(undefined, 'Plan')
    const child = create({ threadId: parent, via: 'thread_create' })
    expect(column(child)).toEqual({ parent, via: 'thread_create' })
    expect(manager.list().find(thread => thread.id === child)?.parent).toEqual({ threadId: parent, via: 'thread_create' })
    expect(manager.readForRenderer(child).thread.parent).toEqual({ threadId: parent, via: 'thread_create' })
    expect(manager.list().find(thread => thread.id === parent)?.parent).toBeUndefined()
    // A parent that does not exist (a deleted supervisor) is not linked: the child stands alone.
    const orphan = create({ threadId: 'missing-thread', via: 'work' })
    expect(column(orphan)).toEqual({ parent: null, via: null })
    expect(manager.read(orphan).thread.parent).toBeUndefined()
    // Deleting the parent unlinks its children instead of deleting them; a leftover via means nothing alone.
    db.prepare('DELETE FROM conversation_threads WHERE id = ?').run(parent)
    expect(column(child)).toMatchObject({ parent: null })
    expect(manager.list().find(thread => thread.id === child)?.parent).toBeUndefined()
  })

  it('links a conversation created through oxespace_thread_create to its origin', async () => {
    const { db, manager, create, column } = setup()
    const origin = create()
    const executions = new ExecutionRegistry()
    const env = executions.register({ owner: { kind: 'thread', id: origin }, workspaceId: 'A', cwd: manager.read(origin).thread.rootPath })
    const ctx = { db, threads: Promise.resolve(manager), executions, workspaceId: 'A', executionId: env.OXESPACE_EXECUTION_ID, executionToken: env.OXESPACE_EXECUTION_TOKEN } as unknown as ToolContext
    const created = JSON.parse((await findTool('oxespace_thread_create')!.handler({ key: 'nested-create-1' }, ctx)).content[0].text!) as { threadId: string }
    expect(column(created.threadId)).toEqual({ parent: origin, via: 'thread_create' })
    expect(manager.read(created.threadId).thread.parent).toEqual({ threadId: origin, via: 'thread_create' })
  })

  it('links a Work task conversation to its supervisor', { timeout: 30_000 }, async () => {
    const { db, manager, create, column, fakes } = setup()
    const supervisor = create()
    await manager.configure(supervisor, { access: 'workspace-write' }, manager.read(supervisor).thread.configurationRevision ?? 0)
    const run = manager.work.plan(supervisor, { key: 'nested-plan-1', title: 'Survey', tasks: [{ key: 'api', title: 'Survey the API', prompt: 'List the endpoints' }] })
    let threadId: string | undefined
    for (let index = 0; index < 400 && !(threadId && fakes.get(threadId)?.sent.length); index += 1) {
      await new Promise(resolve => setTimeout(resolve, 15))
      threadId = manager.work.run(run.id).tasks[0].threadId
    }
    expect(threadId).toBeTruthy()
    expect(column(threadId!)).toEqual({ parent: supervisor, via: 'work' })
    expect(threadChildren(db, supervisor).children.map(child => [child.id, child.via])).toEqual([[threadId, 'work']])
  })

  it('links a delegation\'s destination conversation to a Thread origin, and not to a terminal origin', async () => {
    const { root, manager, create, column } = setup()
    const origin = create()
    const executions = new ExecutionRegistry()
    const host = new ThreadDelegationHost(Promise.resolve(manager), executions, () => 'codex')
    const start = async (originPaneId: string) => {
      const task = { id: `task-${originPaneId}`, schemaVersion: 2, key: 'key', agentProfileId: 'codex-profile', objective: 'Implement', handoff: 'h', acceptance: 'a',
        mode: 'isolated-change', surface: 'thread', workspaceId: 'A', project: 'p', originPaneId, originExecutionId: 'origin-execution', cwd: root, path: root,
        branch: 'feature/x', baseSha: 'abc', localChanges: '', state: 'starting', createdAt: 1, updatedAt: 1 } as DelegationTask
      const result = await host.start(task, threadId => { executions.register({ owner: { kind: 'thread', id: threadId }, workspaceId: 'A', cwd: root }) })
      return result.threadId
    }
    const fromThread = await start(`thread:${origin}`)
    expect(column(fromThread)).toEqual({ parent: origin, via: 'delegation' })
    const fromTerminal = await start('pane-1')
    expect(column(fromTerminal)).toEqual({ parent: null, via: null })
  })
})

describe('nested conversations: thread:children (B1.3)', () => {
  it('lists direct children with their combined state; archived children are listed but not counted', async () => {
    const { db, manager, create, save } = setup()
    const parent = create(undefined, 'Plan')
    const ids = ['running', 'approval', 'failed', 'idle', 'idle', 'interrupted', 'running'].map((status, index) => {
      const id = create({ threadId: parent, via: index % 2 ? 'work' : 'thread_create' }, `Child ${index}`)
      const snapshot = manager.read(id); snapshot.thread.status = status as ConversationThread['status']
      if (index === 6) snapshot.thread.archived = true
      save(snapshot)
      return id
    })
    // A grandchild is its own parent's child, never the grandparent's.
    create({ threadId: ids[0], via: 'delegation' })
    const summary = threadChildren(db, parent)
    expect(summary.threadId).toBe(parent)
    expect(summary.children.map(child => child.id).sort()).toEqual([...ids].sort())
    expect(summary.aggregate).toEqual({ running: 1, approval: 1, failed: 1, done: 2 })
    expect(summary.children.find(child => child.id === ids[6])).toMatchObject({ archived: true, status: 'running', via: 'thread_create', title: 'Child 6' })
    expect(summary.children.find(child => child.id === ids[1])).toMatchObject({ archived: false, via: 'work' })
    expect(threadChildren(db, ids[3])).toEqual({ threadId: ids[3], children: [], aggregate: { running: 0, approval: 0, failed: 0, done: 0 } })
    expect(() => threadChildren(db, 'missing-thread')).toThrow('Thread not found')
  })
})

describe('nested conversations: archive (B1.3)', () => {
  const audits = (db: AppDatabase) => db.prepare("SELECT thread_id AS threadId, summary FROM thread_audit WHERE action = 'archive' ORDER BY id").all() as { threadId: string; summary: string }[]

  it('asks again, refuses /archive confirm, and archives children then parent with confirm-with-children', async () => {
    const { db, manager, create, fakes } = setup()
    const parent = create(undefined, 'Plan')
    const working = create({ threadId: parent, via: 'thread_create' })
    const resting = create({ threadId: parent, via: 'work' })
    await manager.send(working, 'Keep going')
    expect(manager.read(working).thread.status).toBe('running')

    const asked = await manager.command(parent, '/archive')
    expect(asked).toEqual({ kind: 'confirm', confirm: threadArchiveWithChildren({ active: 1, total: 2 }, 'Plan') })
    const refused = await manager.command(parent, '/archive confirm')
    expect(refused).toEqual({ kind: 'confirm', refusal: 'hasActiveChildren', confirm: threadArchiveWithChildren({ active: 1, total: 2 }, 'Plan') })
    expect(manager.read(parent).thread.archived).toBeFalsy()
    expect(manager.read(working).thread.status).toBe('running')
    expect(audits(db)).toEqual([])

    // An older client that only knows `/archive confirm` runs the command the confirmation carries.
    expect(await manager.command(parent, refused.confirm!.command)).toEqual({ kind: 'navigate' })
    expect(fakes.get(working)!.interrupts).toBe(1)
    for (const id of [parent, working, resting]) expect(manager.read(id).thread.archived).toBe(true)
    const trail = audits(db)
    expect(trail.map(entry => entry.threadId).at(-1)).toBe(parent)
    expect(trail.map(entry => entry.threadId).sort()).toEqual([parent, working, resting].sort())
    expect(trail.at(-1)!.summary).toBe('Archived with 2 conversations it started')
    expect(trail[0].summary).toBe('Archived with the conversation that started it')
    expect(threadChildren(db, parent).aggregate).toEqual({ running: 0, approval: 0, failed: 0, done: 0 })
  })

  it('leaves the ordinary flow unchanged when no child is working', async () => {
    const { db, manager, create, save } = setup()
    const parent = create(undefined, 'Plan')
    const resting = create({ threadId: parent, via: 'thread_create' })
    const archivedWorking = create({ threadId: parent, via: 'work' })
    const snapshot = manager.read(archivedWorking); snapshot.thread.status = 'running'; snapshot.thread.archived = true; save(snapshot)
    expect(await manager.command(parent, '/archive')).toEqual({ kind: 'confirm', confirm: threadConfirmation('archive') })
    expect(await manager.command(parent, '/archive confirm')).toEqual({ kind: 'navigate' })
    expect(manager.read(parent).thread.archived).toBe(true)
    expect(manager.read(resting).thread.archived).toBeFalsy()
    expect(audits(db)).toEqual([])
  })

  it('follows children of children down to the depth cap', async () => {
    const { db, manager, create } = setup()
    const chain = [create(undefined, 'Root')]
    for (let level = 1; level <= ARCHIVE_CHILDREN_DEPTH + 1; level += 1) chain.push(create({ threadId: chain[level - 1], via: 'thread_create' }))
    expect(ARCHIVE_CHILDREN_DEPTH).toBe(5)
    expect(await manager.command(chain[0], '/archive confirm-with-children')).toEqual({ kind: 'navigate' })
    expect(chain.map(id => !!manager.read(id).thread.archived)).toEqual([true, true, true, true, true, true, false])
    // Deepest first, the parent last; one entry each.
    expect(audits(db).map(entry => entry.threadId)).toEqual([chain[5], chain[4], chain[3], chain[2], chain[1], chain[0]])
    expect(audits(db).at(-1)!.summary).toBe('Archived with 5 conversations it started')
  })
})

describe('nested conversations: what archiving does to a child (review fixes)', () => {
  const pending = (id: string, generation = 1): ThreadEvent => ({ type: 'request', id: `ask-${id}`, request: { id: `ask-${id}`, nativeId: `native-${id}`, nativeMethod: 'item/tool/requestUserInput', kind: 'question', title: 'Choose', detail: '', state: 'pending', createdAt: 5, generation } })
  const persisted = (manager: ThreadManager, id: string) => manager.read(id).events.filter(event => event.type === 'request').map(event => event.type === 'request' ? [event.request.state, event.request.resolution] : [])

  it('archives each child through the manager\'s own /archive confirm, and withdraws what the child was asking', async () => {
    const { db, manager, create, fakes, save } = setup()
    const parent = create(undefined, 'Plan')
    // A child waiting on a live request, and one whose request only survives in the database (after a restart, say).
    const live = create({ threadId: parent, via: 'thread_create' })
    await manager.send(live, 'Keep going')
    fakes.get(live)!.emit(pending(live))
    const stored = create({ threadId: parent, via: 'work' })
    const snapshot = manager.read(stored); snapshot.thread.status = 'approval'; snapshot.events.push(pending(stored)); save(snapshot)
    const history = new ThreadHistory(db)
    expect(manager.read(live).thread.status).toBe('approval')
    expect(history.pendingRequestsAll().map(request => request.threadId).sort()).toEqual([live, stored].sort())

    const command = vi.spyOn(manager, 'command')
    expect(await manager.command(parent, '/archive confirm')).toMatchObject({ kind: 'confirm', refusal: 'hasActiveChildren' })
    expect(await manager.command(parent, '/archive confirm-with-children')).toEqual({ kind: 'navigate' })
    expect(command.mock.calls.filter(([id]) => id !== parent)).toEqual(expect.arrayContaining([[live, '/archive confirm'], [stored, '/archive confirm']]))
    for (const id of [live, stored]) {
      const thread = manager.read(id).thread
      expect(thread.archived).toBe(true)
      // The live child's turn was interrupted on the way, so it reads as any interrupted turn does; neither waits any more.
      expect(thread.status).toBe(id === live ? 'interrupted' : 'idle')
      expect(persisted(manager, id)).toEqual([['cancelled', 'interrupted']])
      expect(manager.read(id).events.some(event => event.type === 'request-resolved' && event.id === `ask-${id}` && event.state === 'cancelled')).toBe(true)
      expect(manager.readForRenderer(id).pendingRequests).toEqual([])
    }
    expect(history.pendingRequestsAll()).toEqual([])
    expect(threadChildren(db, parent).aggregate).toEqual({ running: 0, approval: 0, failed: 0, done: 0 })
  })

  it('withdraws a conversation\'s own pending request when it is archived by hand', async () => {
    const { db, manager, create, save } = setup()
    const lone = create(undefined, 'Waiting')
    const snapshot = manager.read(lone); snapshot.thread.status = 'approval'; snapshot.events.push(pending(lone)); save(snapshot)
    expect(new ThreadHistory(db).pendingRequestsAll()).toHaveLength(1)
    expect(await manager.command(lone, '/archive confirm')).toEqual({ kind: 'navigate' })
    expect(manager.read(lone).thread).toMatchObject({ archived: true, status: 'idle' })
    expect(persisted(manager, lone)).toEqual([['cancelled', 'interrupted']])
    expect(new ThreadHistory(db).pendingRequestsAll()).toEqual([])
  })

  it('tells an agent the real outcome of archive: refused with the reason while children work, archived otherwise', async () => {
    const { root, db, manager, create } = setup()
    const parent = create(undefined, 'Plan')
    const working = create({ threadId: parent, via: 'thread_create' })
    await manager.send(working, 'Keep going')
    const workspace = { id: 'A', rootPath: root, name: 'A', isActive: true, panes: [] }
    const broker = new ApprovalBroker({ ask: async () => 'allow-once' }, Date.now, 50)
    const ctx = {
      db, threads: Promise.resolve(manager), workspaceId: 'A', executionId: 'e1', executionToken: 't',
      workspaceServ: { get: (id: string) => id === 'A' ? workspace : null, list: () => [workspace] },
      executions: { authenticate: () => ({ id: 'e1', owner: { kind: 'pane', id: 'p1' }, workspaceId: 'A', canonicalRoot: root, cwd: root }) },
      agentActions: new AgentActions({ broker })
    } as unknown as ToolContext
    const archive = async (threadId: string) => JSON.parse((await findTool('oxespace_threads_change')!.handler({ action: 'archive', threadId }, ctx)).content[0].text!) as { ok: boolean; code?: string; message?: string; result?: unknown }
    const refused = await archive(parent)
    expect(refused).toMatchObject({ ok: false, code: 'hasActiveChildren' })
    expect(refused.message).toContain('1 conversation(s) it started are still working')
    expect(manager.read(parent).thread.archived).toBeFalsy()
    expect(manager.read(working).thread.status).toBe('running')
    // Once the person has dealt with the child, the agent's archive goes through and says so.
    expect(await manager.command(working, '/archive confirm')).toEqual({ kind: 'navigate' })
    expect(await archive(parent)).toEqual({ schemaVersion: 1, ok: true, result: { archived: true } })
    expect(manager.read(parent).thread.archived).toBe(true)
  })
})
