import type { AppDatabase } from '../../electron/main/db'
import { ThreadHistory } from '../../electron/main/services/conversation/thread-history'
import { PtyRingBuffer } from '../../electron/main/services/pty-ring-buffer'
import { createRemoteDesktop, type RemoteAgentStateHost, type RemoteDesktop, type RemoteTerminalHost, type RemoteThreadHost } from '../../electron/main/services/remote/desktop'
import type { AgentLifecycleState } from '../../shared/types/agent-state'
import type { ConversationThread, ThreadEvent, ThreadRequest, ThreadRequestResponse, ThreadSnapshot } from '../../shared/types/thread'

/**
 * The desktop a phone sees in the gateway tests: the production adapter (`createRemoteDesktop`) over the real
 * conversation journal (`ThreadHistory`) in the test database, with stand-ins only for what runs processes: the
 * conversation service's actions, the PTYs and the agent state engine. Each action is recorded so a test can count it.
 */

export const ROOT = process.platform === 'win32' ? 'C:\\Users\\dev\\proj' : '/home/dev/proj'

export class FakeThreads implements RemoteThreadHost {
  readonly history: ThreadHistory
  readonly snapshots = new Map<string, ThreadSnapshot>()
  readonly sent: Array<{ kind: 'send' | 'steer'; id: string; text: string }> = []
  readonly interrupted: string[] = []
  readonly responses: Array<{ id: string; requestId: string; response: ThreadRequestResponse; generation?: number }> = []
  private readonly listeners = new Map<string, Set<(id: string) => void>>()

  constructor(private readonly db: AppDatabase) { this.history = new ThreadHistory(db) }

  create(id: string, thread: Partial<ConversationThread> = {}, events: ThreadEvent[] = []): ThreadSnapshot {
    const snapshot: ThreadSnapshot = {
      thread: { id, workspaceId: 'ws1', projectId: 'project', rootPath: ROOT, provider: 'claude', nativeSessionId: null, title: `Thread ${id}`, pinned: false, status: 'idle', createdAt: 1, updatedAt: 1, generation: 1, queue: [], ...thread },
      events
    }
    this.db.prepare('INSERT INTO conversation_threads (id, workspace_id, thread_project_id, data_json, events_json) VALUES (?, ?, ?, ?, ?)')
      .run(id, 'ws1', 'project', JSON.stringify(snapshot.thread), '[]')
    this.history.write(snapshot)
    this.snapshots.set(id, snapshot)
    this.changed(id)
    return snapshot
  }

  /** Adds events (or replaces those with the same id and type) and saves, as the orchestrator would. */
  append(id: string, ...events: ThreadEvent[]): void {
    const snapshot = this.snapshots.get(id)!
    let from = snapshot.events.length
    for (const event of events) {
      const index = 'id' in event ? snapshot.events.findIndex(value => value.type === event.type && 'id' in value && value.id === event.id) : -1
      if (index >= 0) { snapshot.events[index] = event; from = Math.min(from, index) } else snapshot.events.push(event)
    }
    this.save(id, from)
  }

  update(id: string, change: (thread: ConversationThread) => void): void {
    change(this.snapshots.get(id)!.thread)
    this.save(id, this.snapshots.get(id)!.events.length)
  }

  private save(id: string, from: number): void {
    const snapshot = this.snapshots.get(id)!
    snapshot.thread.updatedAt += 1
    this.history.write(snapshot, { eventsFrom: from })
    this.changed(id)
  }

  changed(id: string): void {
    for (const listener of [...this.listeners.get(id) ?? [], ...this.listeners.get('*') ?? []]) listener(id)
  }

  get listenerCount(): number { return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0) }

  list(): ConversationThread[] { return [...this.snapshots.values()].map(snapshot => structuredClone(snapshot.thread)) }
  readThread(id: string): ConversationThread {
    const thread = this.history.readThread(id)
    if (!thread) throw new Error('Thread not found')
    return thread
  }
  readForRenderer(id: string): ThreadSnapshot { return this.history.readWindow(id) }
  readSinceForRenderer(id: string, cursor: { epoch: string; revision: number }) { return this.history.readSince(id, cursor) }
  historyPage(id: string, before?: number, limit?: number) { return Promise.resolve(this.history.page(id, before, limit)) }
  subscribe(id: string, listener: (id: string) => void): () => void {
    const set = this.listeners.get(id) ?? new Set()
    set.add(listener); this.listeners.set(id, set)
    return () => { set.delete(listener) }
  }
  async send(id: string, text: string): Promise<void> {
    this.readThread(id)
    this.sent.push({ kind: 'send', id, text })
    this.append(id, { type: 'message', id: `sent-${this.sent.length}`, role: 'user', text })
  }
  async steer(id: string, text: string): Promise<void> { this.sent.push({ kind: 'steer', id, text }) }
  async interrupt(id: string): Promise<void> { this.interrupted.push(id) }
  async respond(id: string, requestId: string, response: ThreadRequestResponse, generation?: number): Promise<unknown> {
    const snapshot = this.snapshots.get(id)!
    const event = snapshot.events.find((value): value is Extract<ThreadEvent, { type: 'request' }> => value.type === 'request' && value.id === requestId)
    // The orchestrator's own refusal, as it reads today (before B1.1's typed errors).
    if (!event || event.request.state !== 'pending') throw new Error('Request is no longer pending')
    this.responses.push({ id, requestId, response, generation })
    event.request = { ...event.request, state: 'resolved', resolution: 'approved' }
    if (!snapshot.events.some(value => value.type === 'request' && value.request.state === 'pending')) snapshot.thread.status = 'running'
    this.save(id, snapshot.events.indexOf(event))
    return event.request
  }
}

export class FakeTerminals implements RemoteTerminalHost {
  readonly rings = new Map<string, { session: string; ring: PtyRingBuffer }>()
  readonly written: Array<{ paneId: string; data: string }> = []
  private readonly listeners = new Set<(paneId: string) => void>()

  start(paneId: string, session = `session-${paneId}`, capacity?: number): void { this.rings.set(paneId, { session, ring: new PtyRingBuffer(capacity) }) }
  print(paneId: string, data: string): void {
    this.rings.get(paneId)!.ring.push(data)
    for (const listener of this.listeners) listener(paneId)
  }
  get listenerCount(): number { return this.listeners.size }

  readSince(paneId: string, seq: number) {
    const entry = this.rings.get(paneId)
    return entry ? { session: entry.session, seq: entry.ring.seq, ...entry.ring.since(seq) } : null
  }
  onOutput(listener: (paneId: string) => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  hasSession(paneId: string): boolean { return this.rings.has(paneId) }
  async write(input: { paneId: string; data: string }): Promise<void> { this.written.push(input) }
}

export class FakeAgentState implements RemoteAgentStateHost {
  readonly states: Array<{ paneId: string; agent: string; state: AgentLifecycleState }> = []
  list() { return this.states }
}

export interface Desk { desktop: RemoteDesktop; threads: FakeThreads; terminals: FakeTerminals; agents: FakeAgentState }

/** One workspace (`ws1`, two terminal panes) and its Thread project, at `ROOT`. */
export function seedDesktop(db: AppDatabase): Desk {
  db.prepare("INSERT INTO workspaces (id, name, root_path, layout, default_shell_profile_id, is_active) VALUES ('ws1', 'proj', ?, '1x2', 'builtin-claude', 1)").run(ROOT)
  db.prepare("INSERT INTO panes (id, workspace_id, type, row_index, column_index, display_name) VALUES ('p1', 'ws1', 'terminal', 0, 0, 'Build'), ('p2', 'ws1', 'terminal', 0, 1, NULL)").run()
  db.prepare('INSERT INTO thread_projects (id, identity, root_path, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 1)').run('project', ROOT, ROOT, 'proj')
  const threads = new FakeThreads(db), terminals = new FakeTerminals(), agents = new FakeAgentState()
  return { desktop: createRemoteDesktop({ db, threads, terminals, agentState: agents }), threads, terminals, agents }
}

export function addJob(db: AppDatabase, id: string, fields: { label?: string; command?: string; status?: string; exitCode?: number | null } = {}): void {
  db.prepare(`INSERT INTO background_jobs (id, workspace_id, label, command, cwd, status, exit_code, started_at, finished_at) VALUES (?, 'ws1', ?, ?, ?, ?, ?, ?, NULL)
    ON CONFLICT(id) DO UPDATE SET status = excluded.status, exit_code = excluded.exit_code`)
    .run(id, fields.label ?? `Job ${id}`, fields.command ?? 'npm run build', ROOT, fields.status ?? 'running', fields.exitCode ?? null, 10)
}

export function addDelegation(db: AppDatabase, id: string, payload: Record<string, unknown>, fields: { objective?: string; state?: string; updatedAt?: number } = {}): void {
  db.prepare(`INSERT INTO delegations (id, origin_execution, request_key, workspace_id, payload) VALUES (?, 'exec', ?, 'ws1', ?)
    ON CONFLICT(id) DO UPDATE SET payload = excluded.payload`).run(id, `key-${id}`, JSON.stringify(payload))
  db.prepare(`INSERT INTO delegation_task_index (task_id, workspace_id, project, state, branch, objective, created_at, updated_at) VALUES (?, 'ws1', 'proj', ?, 'oxe/task', ?, 1, ?)
    ON CONFLICT(task_id) DO UPDATE SET state = excluded.state, branch = excluded.branch, objective = excluded.objective, updated_at = excluded.updated_at`)
    .run(id, fields.state ?? 'running', fields.objective ?? 'Do the thing', fields.updatedAt ?? 1)
}

export const pendingRequest = (id: string, fields: Partial<ThreadRequest> = {}): ThreadEvent => ({
  type: 'request', id, request: { id, nativeId: id, nativeMethod: 'approval', kind: 'approval', title: `Run ${id}`, generation: 1, createdAt: 5, state: 'pending', ...fields }
})
