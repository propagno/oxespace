/**
 * Golden behaviour of the Thread event pipeline, frozen before the kernel
 * refactor. Each scenario drives the real orchestrator through a fake adapter
 * and snapshots the persisted conversation (timestamps and generated ids
 * normalised). A refactor of event handling must leave every snapshot intact.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../electron/main/db'
import { ThreadHistory } from '../../electron/main/services/conversation/thread-history'
import { ThreadManager } from '../../electron/main/services/conversation/thread-manager'
import type { AgentConversationAdapter, ThreadEvent, ThreadSnapshot } from '../../shared/types/thread'

const databases: AppDatabase[] = []
afterEach(() => { for (const db of databases.splice(0)) db.close() })

function fixture() {
  const db = openInMemoryDatabase(); databases.push(db)
  db.prepare("INSERT INTO workspaces (id, name, root_path, layout, default_shell_profile_id) VALUES ('A', 'A', '/project-A', '1x1', 'builtin-claude')").run()
  const callbacks: ((event: ThreadEvent) => void)[] = []
  const adapters: AgentConversationAdapter[] = []
  const factory = vi.fn(async () => {
    const adapter: AgentConversationAdapter = {
      capabilities: { resume: true, approvals: true, attachments: false, modelSelection: false },
      start: vi.fn(async (_context, emit) => { callbacks.push(emit); emit({ type: 'session', nativeSessionId: `native-${callbacks.length}` }) }),
      send: vi.fn(async () => {}), interrupt: vi.fn(async () => {}), approve: vi.fn(async () => {}), dispose: vi.fn(async () => {}),
      respondRequest: vi.fn(async () => {})
    }
    adapters.push(adapter); return adapter
  })
  const models = { list: vi.fn(async () => ({ defaultModel: 'm', models: [] })), stop: vi.fn(async () => {}) }
  // No working tree: diff capture and checkpoints are out of scope for this golden file.
  const manager = new ThreadManager(db, factory, vi.fn(), undefined, undefined, undefined, models as never)
  vi.spyOn(manager as unknown as { workingState: () => Promise<undefined> }, 'workingState').mockResolvedValue(undefined)
  const id = manager.create({ workspaceId: 'A', projectId: 'project-A', rootPath: '/project-A', provider: 'codex' }).thread.id
  return { db, manager, callbacks, id }
}

const TIME_KEYS = new Set(['at', 'createdAt', 'updatedAt', 'startedAt', 'completedAt', 'resolvedAt', 'since', 'occurredAt', 'observedAt', 'checkedAt', 'capturedAt', 'lastActivityAt', 'connectedAt', 'closedAt', 'lastSignalAt'])
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

/** Stable view of what was persisted: events, turns and the thread fields the pipeline owns. */
function normalise(snapshot: ThreadSnapshot): unknown {
  const ids = new Map<string, string>()
  // Generated ids appear whole and embedded (e.g. `activity:<uuid>:preparing`).
  const stable = (value: string): string => value.replace(UUID, match => {
    const key = match.toLowerCase()
    if (!ids.has(key)) ids.set(key, `<id${ids.size + 1}>`)
    return ids.get(key)!
  })
  const walk = (value: unknown, key = ''): unknown => {
    if (Array.isArray(value)) return value.map(item => walk(item))
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, walk(v, k)]))
    }
    if (typeof value === 'number' && TIME_KEYS.has(key)) return '<time>'
    if (typeof value === 'string') return stable(value)
    return value
  }
  const t = snapshot.thread
  return walk({
    thread: { status: t.status, lastTurnStatus: t.lastTurnStatus, nativeSessionId: t.nativeSessionId, model: t.model, reasoningEffort: t.reasoningEffort, access: t.access, networkAccess: t.networkAccess, approvalPolicy: t.approvalPolicy, hooksEnabled: t.hooksEnabled, queuePause: t.queuePause, contextReport: t.contextReport, costReport: t.costReport },
    turns: (snapshot.turns ?? []).map(turn => ({ id: turn.id, sequence: turn.sequence, status: turn.status, nativeId: turn.nativeId, configuration: turn.configuration })),
    events: snapshot.events
  })
}

async function settle(f: ReturnType<typeof fixture>): Promise<ThreadSnapshot> {
  // Let queued microtasks (finalisation, drain, context refresh) run, then read what was persisted.
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
  await new Promise(resolve => setTimeout(resolve, 20))
  await f.manager.stop()
  return new ThreadHistory(f.db).read(f.id)
}

describe('Thread event pipeline (golden)', () => {
  it('a full successful turn', async () => {
    const f = fixture()
    await f.manager.send(f.id, 'Build the feature')
    const emit = f.callbacks[0]
    emit({ type: 'turn-accepted', nativeTurnId: 'nt-1', at: 1 })
    emit({ type: 'activity', id: 'act-1', phase: 'reasoning', at: 2 })
    emit({ type: 'delta', id: 'msg-1', text: 'Hel' })
    emit({ type: 'delta', id: 'msg-1', text: 'lo' })
    emit({ type: 'tool', id: 'tool-1', name: 'Bash', state: 'running', detail: 'ls', turnId: 'nt-1' })
    emit({ type: 'tool', id: 'tool-1', name: 'Tool result', state: 'completed', detail: '', output: 'a.ts', exitCode: 0 })
    emit({ type: 'plan', id: 'plan-1', turnId: 'nt-1', steps: [{ label: 'Read', status: 'completed' }, { label: 'Write', status: 'inProgress' }] })
    emit({ type: 'turn-diff', id: 'turn-diff:nt-1', turnId: 'nt-1', files: [{ path: 'a.ts', kind: 'update' }] })
    emit({ type: 'configuration', model: 'big', reasoningEffort: 'high', access: 'workspace-write' })
    emit({ type: 'model-picker', id: 'mp-1', models: [], selectedModel: 'big' })
    emit({ type: 'context-usage', report: { usedTokens: 10, windowTokens: 100, percentage: 10, categories: [], capturedAt: 1, source: 'codex-token-usage' } })
    emit({ type: 'turn-cost', usd: 0.02, inputTokens: 5, outputTokens: 7 })
    emit({ type: 'message', id: 'msg-2', role: 'assistant', text: 'Done' })
    emit({ type: 'completed', status: 'completed' })
    expect(normalise(await settle(f))).toMatchSnapshot()
  })

  it('approvals and requests, including ones left open when the turn ends', async () => {
    const f = fixture()
    await f.manager.send(f.id, 'Do risky things')
    const emit = f.callbacks[0]
    emit({ type: 'approval', id: 'ap-1', title: 'Approve Bash', detail: 'rm x' })
    emit({ type: 'approval-resolved', id: 'ap-1' })
    emit({ type: 'request', id: 'rq-1', request: { id: 'rq-1', nativeId: 'rq-1', nativeMethod: 'm', kind: 'approval', title: 'Approve Edit', generation: 0, createdAt: 1, state: 'pending', availableDecisions: ['accept', 'decline'] } })
    emit({ type: 'request-resolved', id: 'rq-1', state: 'accepted', resolution: 'accepted', resolvedAt: 2 })
    emit({ type: 'request', id: 'rq-2', request: { id: 'rq-2', nativeId: 'rq-2', nativeMethod: 'm', kind: 'question', title: 'Pick one', generation: 0, createdAt: 3, state: 'pending' } })
    emit({ type: 'approval', id: 'ap-2', title: 'Approve Write', detail: 'w' })
    emit({ type: 'completed', status: 'interrupted' })
    expect(normalise(await settle(f))).toMatchSnapshot()
  })

  it('a failed turn with details pauses a pending queue', async () => {
    const f = fixture()
    await f.manager.send(f.id, 'First')
    await f.manager.send(f.id, 'Queued follow-up')
    const emit = f.callbacks[0]
    emit({ type: 'tool', id: 'tool-x', name: 'Bash', state: 'running', detail: 'make' })
    emit({ type: 'completed', status: 'failed', error: 'boom', errorCode: 'server', failure: { id: 'fail-1', occurredAt: 1, code: 'server', message: 'Provider failed' } })
    emit({ type: 'failure-details', id: 'fail-1', usageUnavailable: true })
    expect(normalise(await settle(f))).toMatchSnapshot()
  })

  it('late background results and a provider continuation', async () => {
    const f = fixture()
    await f.manager.send(f.id, 'Coordinate')
    const emit = f.callbacks[0]
    emit({ type: 'subagent', id: 'task-A', action: 'Agent', state: 'running', receiverThreadIds: ['A'], agents: [{ threadId: 'A', status: 'running' }] })
    emit({ type: 'completed', status: 'completed' })
    emit({ type: 'subagent', id: 'task-A', action: 'Agent', state: 'completed', receiverThreadIds: ['A'], agents: [{ threadId: 'A', status: 'completed', message: 'Result' }] })
    emit({ type: 'continuation-started', id: 'cont-1', at: 5 })
    emit({ type: 'message', id: 'msg-c', role: 'assistant', text: 'Consolidated' })
    emit({ type: 'completed', status: 'completed' })
    expect(normalise(await settle(f))).toMatchSnapshot()
  })

  it('metadata-only and connection events do not add timeline rows', async () => {
    const f = fixture()
    await f.manager.send(f.id, 'Ping')
    const emit = f.callbacks[0]
    emit({ type: 'native-signal', at: 1 })
    emit({ type: 'queue', id: 'q-1', item: { id: 'q-1', text: 'later', createdAt: 1, state: 'queued' } })
    emit({ type: 'cli-command', id: 'cli-1', command: '/status' })
    emit({ type: 'completed', status: 'completed' })
    emit({ type: 'connection-closed', at: 9 })
    expect(normalise(await settle(f))).toMatchSnapshot()
  })
})
