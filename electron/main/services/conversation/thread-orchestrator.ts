import { randomUUID } from 'node:crypto'
import type { AppDatabase } from '../../db'
import type { AgentConversationAdapter, ConversationThread, ThreadAgentInput, ThreadCommandCatalog, ThreadEvent, ThreadSnapshot, ThreadRequest, ThreadRequestResponse, ThreadQueuedInput, ThreadContextReport, ThreadRewindResult, ThreadAuditEntry, ThreadFileHunk, ThreadPermissionRule, ThreadUsageSummary, ThreadDebugPage } from '../../../../shared/types/thread'
import type { ThreadNativeCli } from './thread-cli'
import type { ThreadModelCatalog, ThreadConfiguration, ThreadCommandResult } from '../../../../shared/types/thread'
import { backgroundSummary } from '../../../../shared/threadBackground'
import type { ThreadModelService } from './thread-models'
import { hasDesktopCommand } from '../../../../shared/threadDesktopCommands'
import { blocksThreadInput, PARTIAL_NATIVE_HISTORY_NOTICE } from '../../../../shared/threadHistoryNotice'
import { formatNativeUserText, taskNotification } from '../../../../shared/native-session-text'
import { assertThreadMessage, THREAD_PROMPT_MAX_CHARS } from '../../../../shared/threadLimits'
import { idleSuspendMinutes, setIdleSuspendMinutes, suspendIdle, type IdleHost } from './thread-idle'
import { execFile } from 'node:child_process'
import { ThreadAgentError, threadFailure } from './thread-failure'
import { ThreadHistory, type ThreadHistoryWriteOptions } from './thread-history'
import { ThreadSnapshotCache } from './thread-snapshot-cache'
import { applyPendingRewind, redoRewind, retryTurn, rewind, type RewindHost } from './thread-rewind-flow'
import { deleteQueued, drainQueue, reorderQueued, resumeQueue, sendQueuedNow, updateQueued, type QueueHost } from './thread-queue'
import { addTurnCost } from './thread-cost'
import { repairLegacyCost } from '../../../../shared/threadCostRepair'
import { DEFAULT_THREAD_TITLE, deriveThreadTitle, isDefaultThreadTitle } from './thread-title'
import { resolveMentionContext } from './thread-context-resolver'
import { briefBlock, projectBrief } from './project-brief'
import { reduceThreadEvent, type KernelEffect } from './kernel/event-reducer'
import { mergeTurnConfiguration, turnConfiguration } from './kernel/turn-configuration'
import { runThreadCommand, type CommandHost } from './kernel/command-router'
import { insertThreadRow, withParent } from './thread-nesting'
import { assertSessionAllowed, attachPolicy, ThreadRequestRefusalError, ThreadRequestRegistry } from './thread-request-registry'
import type { ThreadAttachmentStore } from './thread-attachments'
import { threadCapabilityManifest } from './thread-capabilities'
import { settleVolatileThreadSnapshot } from './thread-recovery.service'
import { ThreadSessionSupervisor } from './thread-session-supervisor'
import { pruneThreadData } from './thread-retention'
import { ThreadExportService } from './thread-export.service'
import { ThreadPortableService } from './thread-portable'
import { ThreadCheckpointService } from './thread-checkpoints'
import { ThreadTurnTracker } from './thread-turns'
import { ThreadPermissionStore } from './thread-permissions'
import { requestSubject, ThreadPolicy } from './thread-policy'
import { ThreadUsageLedger, turnSteps } from './thread-usage'
import { WorkService } from '../work/work-service'
import type { WorkRun } from '../../../../shared/types/work'
import { recordRuntime } from '../runtime-diagnostics'
import { hasUnconfirmedTurnTools, recoverPublicTurn } from './thread-result-recovery'
import type { NativeStateResult } from './codex-state-reader'
import { canonicalPath, resolveSessionLocation } from '../git-common-dir'
import { explainMissingFolder, ThreadFolderMissingError } from './thread-worktree'

// Canonical comparison: a Windows short name and its long form are the same folder.
const sameCheckout = (a: string, b: string): boolean => canonicalPath(a) === canonicalPath(b)

/** The checkout a conversation works in: a worktree of its repository the provider moved into, else its root. */
const workingRootOf = (thread: ConversationThread): string =>
  thread.observedLocation?.sameRepository && thread.observedLocation.checkoutRoot ? thread.observedLocation.checkoutRoot : thread.rootPath

/** Conversations a restart may have left mid-operation: live status, an open connection, or a task still marked running. */
const THREADS_NEEDING_RECOVERY = `SELECT id FROM conversation_threads t WHERE
  json_extract(data_json, '$.status') IN ('running', 'approval')
  OR json_extract(data_json, '$.cliActive') = 1
  OR coalesce(json_extract(data_json, '$.connection.state'), 'closed') != 'closed'
  OR json_extract(data_json, '$.connection.suspendedAt') IS NOT NULL
  OR EXISTS (SELECT 1 FROM conversation_events e WHERE e.thread_id = t.id
    AND json_extract(e.data_json, '$.type') = 'subagent' AND json_extract(e.data_json, '$.state') = 'running')`

/** How often idle conversations are checked for suspension. */
const IDLE_SWEEP_MS = 60_000

/** Repair older histories whose provider ended a turn without a matching tool result. */
function settleCompletedHistoryTools(events: ThreadEvent[]): number {
  let turnStart = 0, earliest = events.length
  events.forEach((event, index) => {
    if (event.type === 'message' && event.role === 'user') turnStart = index
    if (event.type !== 'completed') return
    for (let toolIndex = turnStart; toolIndex < index; toolIndex++) {
      const tool = events[toolIndex]
      if (tool.type !== 'tool' || tool.state !== 'running') continue
      tool.state = 'unknown'
      tool.files = tool.files?.map(file => ({ ...file, state: file.state === 'running' ? 'unknown' : file.state }))
      earliest = Math.min(earliest, toolIndex)
    }
    turnStart = index + 1
  })
  return earliest
}

export class ThreadOrchestrator {
  private readonly changeListeners = new Map<string, Set<() => void>>()
  subscribe(id: string, listener: () => void): () => void {
    const listeners = this.changeListeners.get(id) ?? new Set<() => void>()
    listeners.add(listener); this.changeListeners.set(id, listeners)
    return () => { listeners.delete(listener); if (!listeners.size) this.changeListeners.delete(id) }
  }
  protected changed(id: string): void {
    this.notifyChanged(id)
    for (const listener of this.changeListeners.get(id) ?? []) listener()
  }
  private readonly history: ThreadHistory
  /** Full snapshots are retained only for active main-process work. Renderer reads stay paginated. */
  private readonly snapshots = new ThreadSnapshotCache(id => this.busy.has(id) || this.starting.has(id) || this.finalizing.has(id) || this.configuring.has(id) || this.observations.has(id) || this.nativePageLoads.has(id) || this.deltaBuffers.has(id))
  private readonly deltaBuffers = new Map<string, Map<string, { text: string; generation?: number }>>()
  private readonly deltaTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly adapters = new Map<string, AgentConversationAdapter>()
  private readonly observations = new Map<string, Promise<import('../../../../shared/types/thread').ThreadProviderObservation>>()
  private readonly requests = new ThreadRequestRegistry()
  private readonly sessions = new ThreadSessionSupervisor()
  private readonly exports: ThreadExportService
  private readonly portable = new ThreadPortableService()
  private readonly checkpoints: ThreadCheckpointService
  private readonly permissions: ThreadPermissionStore
  private readonly policy: ThreadPolicy
  private readonly usage: ThreadUsageLedger
  /** Agent Work: plans a supervising conversation runs through worker conversations. */
  readonly work: WorkService
  /** Checkpoints and working-tree baselines of running turns. */
  private readonly turns: ThreadTurnTracker
  private readonly busy = new Set<string>()
  private readonly nativePageLoads = new Map<string, Promise<void>>()
  private readonly finalizing = new Set<string>()
  private readonly finalizationTasks = new Set<Promise<void>>()
  private stopping = false
  private readonly configuring = new Set<string>()
  /** Last provider event, message or connection per live adapter; drives idle suspension. */
  private readonly lastActivity = new Map<string, number>()
  /** Live sessions holding "allow for the session" grants, which a restarted process would forget. */
  private readonly sessionGrants = new Set<string>()
  private readonly suspending = new Map<string, Promise<void>>()
  /** A send that is starting a turn and has not reserved the conversation as busy yet. */
  private readonly starting = new Set<string>()
  /** Conversations whose running turn the user stopped to send a queued message: that stop does not pause the queue. */
  private readonly sendNowAfterStop = new Set<string>()
  /** Provider connections being opened, so two callers share one process instead of orphaning one. */
  private readonly connecting = new Map<string, Promise<AgentConversationAdapter>>()
  private readonly idleSweep: ReturnType<typeof setInterval>
  /** Daily retention pass for an app left open for days. */
  private readonly retentionSweep: ReturnType<typeof setInterval>

  constructor(protected readonly db: AppDatabase,
    private readonly factory: (thread: ConversationThread) => Promise<AgentConversationAdapter>,
    private readonly notifyChanged: (threadId: string) => void,
    private readonly preflight?: (thread: ConversationThread) => Promise<void>,
    private readonly commandService?: {
      list(thread: ConversationThread, forceRefresh?: boolean): Promise<ThreadCommandCatalog>
      prepare(thread: ConversationThread, text: string): Promise<ThreadAgentInput>
      stop?(): Promise<void>
    }, private readonly nativeCli?: Pick<ThreadNativeCli, 'read'> & Partial<Pick<ThreadNativeCli, 'closeHistoryReader'>>,
    private readonly modelService?: Pick<ThreadModelService, 'list' | 'stop'>,
    private readonly attachmentStore?: ThreadAttachmentStore,
    private readonly stateReader?: { observe(thread: ConversationThread, nativeTurnId?: string): Promise<import('../../../../shared/types/thread').ThreadProviderObservation>; recover?(thread: ConversationThread, nativeTurnId?: string): Promise<NativeStateResult>; stop(): Promise<void> },
    private readonly memoryEvent?: (snapshot: ThreadSnapshot, event: ThreadEvent) => void) {
    this.history = new ThreadHistory(db)
    this.exports = new ThreadExportService((threadId, artifactId) => this.history.artifact(threadId, artifactId))
    this.checkpoints = new ThreadCheckpointService(db)
    this.turns = new ThreadTurnTracker(this.checkpoints, id => this.read(id), (id, event) => this.event(id, event))
    this.permissions = new ThreadPermissionStore(db)
    this.policy = new ThreadPolicy(this.permissions, id => this.readThread(id).rootPath, (id, requestId, generation, response) => this.requests.resolve(id, requestId, generation, response))
    this.usage = new ThreadUsageLedger(db)
    try { this.permissions.prune() } catch { /* Audit retention is best effort. */ }
    try { pruneThreadData(db) } catch { /* Retention is best effort; nothing is lost by skipping it once. */ }
    // A persisted running state is not proof that its process survived a restart.
    // Only conversations whose saved state says something was still live are read in full; the rest stay on disk.
    this.checkpoints.failAllOpen('OXESpace restarted before this checkpoint could be finalized.')
    for (const row of db.prepare(THREADS_NEEDING_RECOVERY).all() as { id: string }[]) {
      const snapshot = this.history.read(row.id)
      let recovered = false
      let eventsFrom = snapshot.events.length
      if (snapshot.thread.status === 'running' || snapshot.thread.status === 'approval' || snapshot.thread.cliActive || snapshot.events.some(event => event.type === 'subagent' && event.state === 'running')) {
        settleVolatileThreadSnapshot(snapshot, 'restart')
        this.history.settleOpenOperations(snapshot.thread.id, 'unknown', 'OXESpace restarted before the provider result was confirmed.')
        recovered = true; eventsFrom = 0
      }
      if (snapshot.thread.connection && (snapshot.thread.connection.state !== 'closed' || snapshot.thread.connection.suspendedAt)) { snapshot.thread.connection = this.sessions.close(row.id); recovered = true }
      if (recovered) this.save(snapshot, { eventsFrom })
      this.snapshots.delete(row.id)
    }
    this.work = new WorkService(db, {
      read: threadId => this.read(threadId), create: context => this.create(context),
      configure: (threadId, input, revision) => this.configure(threadId, input, revision),
      command: (threadId, text) => this.command(threadId, text), send: (threadId, text) => this.send(threadId, text),
      interrupt: threadId => this.interrupt(threadId), subscribe: (threadId, listener) => this.subscribe(threadId, listener)
    })
    // After subclasses finish constructing: workers that ran before a restart are settled, ready work starts.
    queueMicrotask(() => { try { this.work.resume() } catch { /* Agent Work recovery is best effort. */ } })
    this.idleSweep = setInterval(() => { void this.suspendIdle().catch(() => {}) }, IDLE_SWEEP_MS)
    this.idleSweep.unref?.()
    this.retentionSweep = setInterval(() => { try { pruneThreadData(this.db) } catch { /* best effort */ } }, 24 * 60 * 60 * 1000)
    this.retentionSweep.unref?.()
  }

  /** Minutes without activity before an idle conversation's agent process is closed; 0 keeps it open. */
  idleSuspendMinutes(): number { return idleSuspendMinutes(this.db) }

  setIdleSuspendMinutes(minutes: number): number { return setIdleSuspendMinutes(this.db, minutes) }

  /** Closes the agent process of conversations idle longer than the setting (see thread-idle). */
  suspendIdle(now = Date.now()): Promise<string[]> {
    return suspendIdle(this.idleHost(), now)
  }

  protected idleHost(): IdleHost {
    return {
      db: this.db,
      isStopping: () => this.stopping,
      adapters: () => [...this.adapters],
      hasAdapter: id => this.adapters.has(id),
      lastActivity: id => this.lastActivity.get(id),
      touch: (id, at) => { this.lastActivity.set(id, at) },
      detach: id => { this.adapters.delete(id); this.lastActivity.delete(id) },
      trackClosing: (id, closing) => { this.suspending.set(id, closing) },
      untrackClosing: (id, closing) => { if (this.suspending.get(id) === closing) this.suspending.delete(id) },
      isHeld: id => this.busy.has(id) || this.finalizing.has(id) || this.configuring.has(id) || this.observations.has(id) || this.sessionGrants.has(id),
      openRequests: (id, generation) => this.requests.list(id, generation).length,
      closeSession: (id, at) => this.sessions.close(id, at),
      read: id => this.read(id), save: (snapshot, options) => this.save(snapshot, options)
    }
  }

  list(): ConversationThread[] {
    return (this.db.prepare(`SELECT data_json, parent_thread_id, parent_via,
      (SELECT json_extract(turn.data_json, '$.status') FROM conversation_turns turn
       WHERE turn.thread_id = conversation_threads.id
       ORDER BY CAST(json_extract(turn.data_json, '$.sequence') AS INTEGER) DESC LIMIT 1) AS last_turn_status
      FROM conversation_threads`).all() as { data_json: string; parent_thread_id: string | null; parent_via: string | null; last_turn_status: ConversationThread['lastTurnStatus'] | null }[])
      .map(row => {
        const thread = withParent(JSON.parse(row.data_json) as ConversationThread, row)
        if (!thread.lastTurnStatus && row.last_turn_status) thread.lastTurnStatus = row.last_turn_status
        return thread
      })
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt)
  }

  create(context: Pick<ConversationThread, 'workspaceId' | 'projectId' | 'rootPath' | 'provider' | 'agentProfileId' | 'parent' | 'ownedWorktree'>): ThreadSnapshot {
    const now = Date.now()
    const snapshot: ThreadSnapshot = { thread: { ...context, id: randomUUID(), nativeSessionId: null,
      title: DEFAULT_THREAD_TITLE, pinned: false, status: 'idle', createdAt: now, updatedAt: now, generation: 1, queue: [], capabilities: threadCapabilityManifest(context.provider), connection: { state: 'closed', attempt: 0, changedAt: now } }, events: [] }
    this.db.transaction(() => {
      // Legacy/delegated callers enter here with a validated directory but no
      // renderer project-registration step. Keep their conversation durable.
      this.db.prepare(`INSERT OR IGNORE INTO thread_projects (id, identity, root_path, display_name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)`).run(context.projectId, context.rootPath, context.rootPath,
        context.rootPath.split(/[\\/]/).filter(Boolean).at(-1) ?? context.rootPath, now, now)
      this.db.prepare('INSERT OR IGNORE INTO thread_project_contexts (project_id, root_path) VALUES (?, ?)').run(context.projectId, context.rootPath)
      insertThreadRow(this.db, snapshot.thread)
    })()
    this.snapshots.set(snapshot.thread.id, snapshot)
    this.trimSnapshots()
    this.changed(snapshot.thread.id)
    return snapshot
  }

  read(id: string): ThreadSnapshot {
    this.flushDeltas(id)
    const cached = this.snapshots.get(id)
    if (cached) {
      if (this.db.prepare('SELECT 1 FROM conversation_threads WHERE id = ?').get(id)) {
        this.snapshots.touch(id)
        return cached
      }
      this.snapshots.delete(id)
      throw Error('Thread not found')
    }
    const snapshot = this.history.read(id)
    const firstRepairedEvent = settleCompletedHistoryTools(snapshot.events)
    if (firstRepairedEvent < snapshot.events.length) this.history.persistFrom(snapshot, firstRepairedEvent)
    this.snapshots.set(id, snapshot)
    this.snapshots.touch(id)
    this.trimSnapshots()
    return snapshot
  }

  private trimSnapshots(): void { this.snapshots.trim() }

  /** The thread without its events, for callers that only need its metadata or that it exists. */
  readThread(id: string): ConversationThread {
    this.flushDeltas(id)
    if (this.snapshots.has(id)) return this.read(id).thread
    return this.history.readThread(id) ?? this.read(id).thread
  }

  /** In-memory state of a conversation that no longer exists. */
  private forget(id: string): void {
    this.snapshots.delete(id)
    this.lastActivity.delete(id)
    this.sessionGrants.delete(id)
    this.turns.forget(id)
    clearTimeout(this.deltaTimers.get(id)); this.deltaTimers.delete(id); this.deltaBuffers.delete(id)
    this.requests.invalidate(id)
  }

  readForRenderer(id: string): ThreadSnapshot {
    this.flushDeltas(id)
    const window = this.history.readWindow(id)
    settleCompletedHistoryTools(window.events)
    if (!window.thread.lastTurnStatus) window.thread.lastTurnStatus = window.turns?.at(-1)?.status
    if (window.thread.nativeSessionId && (/^Recovered (?:codex|claude) session$/i.test(window.thread.title) || window.thread.title.startsWith('<environment_context>') || window.thread.title.startsWith('<task-notification>'))) {
      const full = this.read(id)
      const firstPrompt = full.events.find(event => event.type === 'message' && event.role === 'user' && !taskNotification(event.text) && formatNativeUserText(event.text))
      // Earlier builds named a recovered conversation after a background-task notice; that title is replaced too.
      if (firstPrompt?.type === 'message' || window.thread.title.startsWith('<environment_context>') || window.thread.title.startsWith('<task-notification>')) {
        const title = firstPrompt?.type === 'message'
          ? formatNativeUserText(firstPrompt.text).replace(/\s+/g, ' ').slice(0, 80)
          : `Recovered ${window.thread.provider} session`
        full.thread.title = title
        window.thread.title = title
        this.history.updateThreadMetadata(full.thread)
        this.changed(id)
      }
    }
    return window
  }

  /** Incremental counterpart of readForRenderer; a reset tells the caller to reread the window. */
  readSinceForRenderer(id: string, cursor: import('../../../../shared/types/thread').ThreadSyncCursor): import('../../../../shared/types/thread').ThreadDelta {
    this.flushDeltas(id)
    const delta = this.history.readSince(id, cursor)
    if (delta.ok && !delta.thread.lastTurnStatus) delta.thread.lastTurnStatus = delta.turns.at(-1)?.status
    return delta
  }

  artifact(id: string, artifactId: string): import('../../../../shared/types/thread').ThreadArtifact {
    this.readThread(id)
    return this.history.artifact(id, artifactId)
  }

  async historyPage(id: string, before?: number, limit?: number): Promise<import('../../../../shared/types/thread').ThreadHistoryPage> {
    this.flushDeltas(id)
    if (before !== undefined && before <= 0 && !this.history.hasImportedBefore(id, before)) {
      let pending = this.nativePageLoads.get(id)
      if (!pending) {
        pending = this.loadNativePage(id)
        this.nativePageLoads.set(id, pending)
      }
      try { await pending } finally { if (this.nativePageLoads.get(id) === pending) this.nativePageLoads.delete(id) }
    }
    return this.history.page(id, before, limit)
  }

  private async loadNativePage(id: string): Promise<void> {
    // Cross a bounded number of metadata-only pages per click. Each committed
    // cursor survives a restart; a long tool result never forces a full scan.
    for (let attempt = 0; attempt < 4 && !this.stopping; attempt++) {
      const thread = this.read(id).thread
      const nativeSessionId = thread.nativeSessionId, generation = thread.generation
      const cursor = thread.nativeHistoryCursor
      if (!cursor || !nativeSessionId || !this.nativeCli) return
      const history = await this.nativeCli.read(thread, nativeSessionId, cursor)
      const current = this.read(id)
      if (current.thread.nativeSessionId !== nativeSessionId || current.thread.nativeHistoryCursor !== cursor || current.thread.generation !== generation) return
      if (history.cursor && history.cursor.before >= cursor.before) throw Error('Native history did not advance. Retry after checking the provider history file.')
      this.db.transaction(() => {
        this.history.prependNative(id, history.events)
        current.thread.nativeHistoryCursor = history.cursor
        if (!history.cursor) current.thread.cliNotice = undefined
        this.history.updateThreadMetadata(current.thread)
      })()
      if (history.events.length || !history.cursor) return
    }
  }

  exportPortable(id: string): string {
    return this.portable.serialize(this.history.readImported(id), this.history.artifacts(id))
  }

  async observe(id: string): Promise<import('../../../../shared/types/thread').ThreadProviderObservation> {
    if (this.stopping) throw Error('Thread service is shutting down')
    const pending = this.observations.get(id)
    if (pending) return pending
    const snapshot = this.read(id), adapter = this.adapters.get(id)
    const generation = snapshot.thread.generation, nativeSessionId = snapshot.thread.nativeSessionId, rootPath = snapshot.thread.rootPath
    const nativeTurnId = snapshot.turns?.at(-1)?.nativeId, localTurnId = snapshot.turns?.at(-1)?.id
    const operation = (async () => {
      const connected = Boolean(adapter?.observe && snapshot.thread.connection?.state !== 'closed')
      const liveRecovery = Boolean(connected && adapter?.commitRecoveredTurn && this.busy.has(id) && snapshot.thread.status === 'running' && !this.requests.list(id, generation ?? 1).length)
      const canRecover = liveRecovery || !this.busy.has(id) && (snapshot.turns?.at(-1)?.status !== 'completed' || hasUnconfirmedTurnTools(snapshot))
      let result: NativeStateResult = connected
        ? await adapter!.observe!(nativeTurnId)
        : canRecover && this.stateReader?.recover ? await this.stateReader.recover({ ...snapshot.thread }, nativeTurnId)
        : this.stateReader ? await this.stateReader.observe({ ...snapshot.thread }, nativeTurnId)
        : { state: 'unknown', observedAt: Date.now(), source: 'unavailable', detail: 'No connected provider supports a state query for this conversation. The execution outcome remains unconfirmed.', messageCode: { code: 'thread.observe.unsupported', params: {} } }
      if (connected && canRecover && this.stateReader?.recover && ['completed', 'failed'].includes(result.state)) {
        const recovered = await this.stateReader.recover({ ...snapshot.thread }, nativeTurnId)
        const confirmed = await adapter!.observe!(nativeTurnId)
        // An intervening execution or conflicting provider result must not be
        // overwritten by a passive journal snapshot.
        if (confirmed.state === recovered.state && confirmed.nativeTurnId === nativeTurnId) result = recovered
        else result = { ...confirmed, state: 'unknown', detail: 'Provider state changed during recovery. The local conversation was preserved; check again.', messageCode: { code: 'thread.observe.changed', params: {} } }
      }
      if (this.stopping) throw Error('Thread service is shutting down')
      const current = this.read(id)
      if (current.thread.generation !== generation || current.thread.nativeSessionId !== nativeSessionId || current.thread.rootPath !== rootPath || current.turns?.at(-1)?.nativeId !== nativeTurnId || current.turns?.at(-1)?.id !== localTurnId) throw Error('The conversation changed during this check. Check its current state again.')
      const { recoveredMessages: _messages, recoveredItems: _items, ...observation } = result
      const recoverLive = liveRecovery && this.busy.has(id) && current.thread.status === 'running' && !this.requests.list(id, generation ?? 1).length
      const recovered = canRecover && (!this.busy.has(id) || recoverLive) && (!connected || this.adapters.get(id) === adapter && current.thread.connection?.state !== 'closed') ? recoverPublicTurn(current, result, recoverLive) : undefined
      if (recovered) {
        observation.detail = 'The public response and available tool evidence were recovered without resending input. Tool results without individual evidence remain unknown; queued messages were not sent.'
        recovered.thread.providerObservation = observation
        const persist = () => this.db.transaction(() => {
          const turn = recovered.turns!.at(-1)!
          if (turn.operationId) this.history.reconcileOperation(id, turn.operationId, nativeTurnId!, turn.status as 'completed' | 'failed', recoverLive)
          this.history.persistFrom(recovered, 0)
        })()
        if (recoverLive) {
          if (!adapter!.commitRecoveredTurn!(nativeTurnId!, result.state as 'completed' | 'failed', persist)) {
            observation.state = 'unknown'
            observation.detail = 'The live provider changed before recovery could be committed. No input was resent.'
            current.thread.providerObservation = observation
            this.save(current, { eventsFrom: current.events.length })
            return observation
          }
          this.busy.delete(id)
        } else persist()
        this.snapshots.set(id, recovered)
        if (recoverLive) {
          const turn = recovered.turns!.at(-1)!
          const captureDiff = this.turns.hasBaseline(id)
          if (captureDiff || this.turns.hasCheckpoints(turn.id)) {
            this.finalizing.add(id)
            const task = this.finalizeTurnThenDrain(id, turn.status as 'completed' | 'failed', turn.id, captureDiff, false)
            this.finalizationTasks.add(task)
            void task.finally(() => this.finalizationTasks.delete(task)).catch(() => {})
          }
          if (turn.status === 'completed' && turn.attachmentIds?.length) void this.releaseAttachments(id, turn.attachmentIds)
        }
        this.changed(id)
      } else {
        current.thread.providerObservation = observation
        this.save(current, { eventsFrom: current.events.length })
      }
      return observation
    })()
    this.observations.set(id, operation)
    try { return await operation } finally { if (this.observations.get(id) === operation) this.observations.delete(id) }
  }

  importPortable(targetId: string, input: string): ThreadSnapshot {
    const target = this.read(targetId)
    if (this.busy.has(targetId) || this.configuring.has(targetId)) throw Error('Finish the active operation before importing a conversation')
    const imported = this.portable.parse(input)
    if (imported.conversation.provider !== target.thread.provider) throw Error('Import the conversation into a project using the same provider')
    const snapshot = this.create({ workspaceId: target.thread.workspaceId, projectId: target.thread.projectId, rootPath: target.thread.rootPath, provider: target.thread.provider })
    snapshot.thread.title = imported.conversation.title || 'Imported conversation'
    Object.assign(snapshot.thread, imported.conversation.configuration, { status: 'idle', nativeSessionId: null, generation: 1, queue: [], cliActive: false })
    snapshot.events = imported.conversation.events
    snapshot.turns = imported.conversation.turns.map(turn => ({ ...turn, status: turn.status === 'running' ? 'interrupted' : turn.status, ...(turn.status === 'running' ? { completedAt: Date.now() } : {}) }))
    this.save(snapshot)
    this.history.importArtifacts(snapshot.thread.id, imported.artifacts)
    return snapshot
  }

  async attach(id: string, input: { name: string; mimeType: import('../../../../shared/types/thread').ThreadAttachment['mimeType']; data: ArrayBuffer | Uint8Array }): Promise<import('../../../../shared/types/thread').ThreadAttachment> {
    this.readThread(id)
    if (!this.attachmentStore) throw Error('Attachments are unavailable')
    return this.attachmentStore.add(id, input)
  }

  async removeAttachment(id: string, attachmentId: string): Promise<void> {
    this.readThread(id)
    if (!this.attachmentStore) throw Error('Attachments are unavailable')
    await this.attachmentStore.remove(id, attachmentId)
  }

  async projectDiff(id: string): Promise<import('../../../../shared/types/git').GitDiff> {
    const thread = this.readThread(id)
    // The project's changes live in the worktree the provider moved into, when it reported one.
    const rootPath = thread.observedLocation?.sameRepository && thread.observedLocation.checkoutRoot ? thread.observedLocation.checkoutRoot : thread.rootPath
    const run = (args: string[]) => new Promise<string>((resolve, reject) => {
      const child = execFile('git', args, { cwd: rootPath, windowsHide: true, maxBuffer: 2 * 1024 * 1024, timeout: 15000 }, (error, stdout) => error ? reject(error) : resolve(stdout))
      child.stdin?.end()
    })
    let hasHead = true
    try { await run(['rev-parse', '--verify', 'HEAD']) } catch { hasHead = false }
    const args = ['--no-pager', 'diff', '--no-ext-diff', '--no-textconv', '--unified=3']
    let raw: string
    try { raw = await run([...args, hasHead ? 'HEAD' : (await run(['hash-object', '-t', 'tree', '--stdin'])).trim(), '--']) }
    catch { throw Error('Could not read tracked project changes. Check the repository and retry.') }
    this.readThread(id)
    const { parseDiffOutput } = await import('../git.service')
    return { files: parseDiffOutput(raw), base: hasHead ? 'HEAD' : 'Unborn branch', includeUncommitted: true, compiledAt: Date.now() }
  }

  async send(id: string, text: string, attachmentIds: string[] = []): Promise<void> {
    if (this.stopping) throw new Error('Application is shutting down')
    assertThreadMessage(text)
    if (this.configuring.has(id)) throw new Error('Configuration is already being updated')
    if (this.readThread(id).cliActive) throw Error('The native CLI already owns this conversation')
    // Decide queue or new turn before the first await: two sends arriving together must not both start a turn.
    const queue = this.busy.has(id) || this.finalizing.has(id) || this.starting.has(id)
    if (!queue) this.starting.add(id)
    let done = false
    try {
      // A rewind waiting for confirmation is applied now, before the new turn: the later turns leave and the
      // provider's history is rewound. A queued message rides on the running turn and waits.
      if (!queue && this.readThread(id).rewind) await this.applyPendingRewind(id)
      await this.sendReserved(id, text, attachmentIds, queue)
      done = true
    } finally {
      if (!queue) {
        this.starting.delete(id)
        // Input queued behind a slash command that ran without a turn still has to run. After a failure
        // the queue waits, as it always has, instead of failing every queued message in turn.
        if (done && !this.busy.has(id)) queueMicrotask(() => void this.drainQueue(id).catch(() => {}))
      }
    }
  }

  private async sendReserved(id: string, text: string, attachmentIds: string[], queue: boolean): Promise<void> {
    const attachments = attachmentIds.length ? await this.resolveAttachments(id, attachmentIds) : []
    recordRuntime('turn-submit', { thread: id, kind: 'thread' })
    if (queue) {
      const snapshot = this.read(id), adapter = this.adapters.get(id)
      const operation = this.history.beginOperation({ threadId: id, generation: snapshot.thread.generation ?? 1, kind: 'queue' })
      const item: ThreadQueuedInput = { id: randomUUID(), operationId: operation.id, text, attachmentIds,
        ...(attachments.length ? { attachments: attachments.map(({ path: _path, ...attachment }) => attachment) } : {}),
        configuration: turnConfiguration(snapshot.thread),
        createdAt: Date.now(), state: 'queued' }
      try {
        if (this.busy.has(id) && adapter?.enqueue) {
          item.nativeId = await adapter.enqueue(item, attachments)
          if (item.nativeId) this.history.transitionOperation(id, operation.id, 'acknowledged')
        }
      } catch (error) {
        this.history.transitionOperation(id, operation.id, 'failed', error instanceof Error ? error.message : 'Could not queue input')
        throw error
      }
      snapshot.thread.queue ??= []
      snapshot.thread.queue.push(item)
      this.save(snapshot, { eventsFrom: snapshot.events.length })
      return
    }
    const slash = text.trim().match(/^\/([\w:-]+)(?:\s+([\s\S]*))?$/)
    if (slash && hasDesktopCommand(this.read(id).thread.provider, slash[1]) && !['compact', 'review'].includes(slash[1])) {
      await this.command(id, text)
      return
    }
    const deferred = this.read(id).thread.pendingConfiguration
    if (deferred) await this.configure(id, deferred, this.read(id).thread.configurationRevision ?? 0)
    let snapshot = this.read(id)
    this.assertNativeSessionAvailable(id, snapshot.thread.provider, snapshot.thread.nativeSessionId)
    this.busy.add(id) // reserve before any asynchronous launch
    let input: ThreadAgentInput = { text }
    let mentioned: Awaited<ReturnType<typeof resolveMentionContext>> = { block: '', files: [] }
    let brief = ''
    try {
      input = await this.commandService?.prepare(snapshot.thread, text) ?? input
      if (input.nativeCli) {
        throw Error('This command does not have an integrated OxeChat handler yet.')
      }
      if (snapshot.thread.cliNotice && blocksThreadInput(snapshot.thread)) throw Error(snapshot.thread.cliNotice)
      assertThreadMessage(input.text, THREAD_PROMPT_MAX_CHARS)
      await this.preflight?.(snapshot.thread)
      // `@file` mentions become attached content; the stored message keeps the text as typed.
      if (!text.trim().startsWith('/')) {
        mentioned = await resolveMentionContext(snapshot.thread.rootPath, text).catch(() => mentioned)
        if (mentioned.block) input = { ...input, text: input.text + mentioned.block }
        // The first message of a conversation carries a short orientation to the project.
        if (!snapshot.turns?.length && !snapshot.thread.nativeSessionId) {
          brief = await projectBrief(snapshot.thread.rootPath, snapshot.thread.provider).catch(() => '')
          if (brief) input = { ...input, text: input.text + briefBlock(brief) }
        }
      }
      snapshot = this.read(id)
      if (this.stopping) throw new Error('Application is shutting down')
    } catch (error) { this.busy.delete(id); throw error }
    snapshot.thread.status = 'running'
    delete snapshot.thread.providerObservation
    delete snapshot.thread.queuePause
    if (isDefaultThreadTitle(snapshot.thread.title) && !text.trim().startsWith('/')) snapshot.thread.title = deriveThreadTitle(text)
    const turnId = randomUUID()
    const operation = this.history.beginOperation({ threadId: id, turnId, generation: snapshot.thread.generation ?? 1, kind: 'turn' })
    const eventsFrom = snapshot.events.length
    snapshot.events.push({ type: 'message', id: turnId, role: 'user', text, ...(attachments.length ? { attachments: attachments.map(({ path: _path, ...attachment }) => attachment) } : {}), ...(mentioned.files.length ? { context: mentioned.files } : {}), ...(brief ? { brief } : {}) })
    snapshot.turns ??= []
    snapshot.turns.push({ id: turnId, operationId: operation.id, sequence: snapshot.turns.length + 1, startedAt: Date.now(), status: 'running', configuration: turnConfiguration(snapshot.thread), ...(attachmentIds.length ? { attachmentIds: [...attachmentIds] } : {}) })
    snapshot.events.push({ type: 'activity', id: `activity:${turnId}:preparing`, phase: 'preparing', at: Date.now() })
    this.save(snapshot, { eventsFrom, operationId: operation.id })
    try {
      // Publish the accepted prompt before repository snapshots or agent startup can block the UI.
      // Both reads must finish before the agent can modify files, but they are independent.
      // In the checkout the conversation works in: a worktree it moved into, else its own root.
      await this.turns.begin(id, turnId, workingRootOf(snapshot.thread), text.trim().slice(0, 80))
      this.event(id, { type: 'activity', id: `activity:${turnId}:connecting`, phase: 'connecting', at: Date.now() })
      const adapter = await this.connectAdapter(id, snapshot.thread, false)
      this.history.transitionOperation(id, operation.id, 'sent')
      if (attachments.length) await adapter.send(input.text, input.skill, attachments)
      else await adapter.send(input.text, input.skill)
      this.history.transitionOperation(id, operation.id, 'acknowledged')
    } catch (error) {
      const failure = error instanceof ThreadAgentError ? error.failure : threadFailure({ message: error instanceof Error ? error.message : '' })
      failure.usageUnavailable = true
      if (this.busy.has(id)) this.event(id, { type: 'completed', status: 'failed', error: failure.message, errorCode: failure.code, failure })
      const adapter = this.adapters.get(id)
      this.adapters.delete(id)
      await adapter?.dispose().catch(() => {})
      this.history.transitionOperation(id, operation.id, 'failed', failure.message)
      // A folder that no longer exists is not a settings problem; name it.
      if (error instanceof ThreadFolderMissingError) throw new Error(error.message, { cause: error })
      throw new Error(failure.code === 'session-busy' ? failure.message : 'Could not run thread agent; check Agent Settings', { cause: error })
    }
  }

  hasRunning(provider: ConversationThread['provider']): boolean {
    return [...this.busy].some(id => { try { return this.read(id).thread.provider === provider } catch { return false } })
  }
  async refreshAccounts(provider: ConversationThread['provider']): Promise<void> {
    for (const [id, adapter] of this.adapters) {
      if (this.busy.has(id)) continue
      try { if (this.read(id).thread.provider !== provider) continue } catch { /* deleted */ }
      this.adapters.delete(id); await adapter.dispose().catch(() => {})
      try { const snapshot = this.read(id); snapshot.thread.connection = this.sessions.close(id); this.save(snapshot, { eventsFrom: snapshot.events.length }) } catch { /* deleted */ }
    }
  }

  async interrupt(id: string): Promise<void> {
    recordRuntime('turn-interrupt', { thread: id })
    this.readThread(id)
    const adapter = this.adapters.get(id)
    if (!adapter) throw new Error('Thread has no live execution')
    await adapter.interrupt()
  }

  /** Per-file standing of a turn's changes, for review (pending / reverted / modified). */
  async turnFiles(id: string, turnId: string): Promise<import('./thread-checkpoints').CheckpointFileStatus[]> {
    this.readThread(id)
    const checkpoint = this.checkpoints.forTurn(id, turnId)
    return checkpoint ? this.checkpoints.fileStates(id, checkpoint.id) : []
  }

  /** Undoes one file of a finished turn. Refused while a turn or configuration owns the conversation. */
  async undoTurnFile(id: string, turnId: string, path: string): Promise<void> {
    this.readThread(id)
    if (this.busy.has(id) || this.configuring.has(id) || this.finalizing.has(id)) throw Error('Finish the active operation before undoing changes')
    const checkpoint = this.checkpoints.forTurn(id, turnId)
    if (!checkpoint) throw Error('No checkpoint exists for this turn')
    await this.checkpoints.restoreFile(id, checkpoint.id, path)
    this.audit(id, { action: 'undo-file', actor: 'user', summary: `Undid ${path}` })
    this.changed(id)
  }

  /** The change blocks one turn made to a file, for keep/undo review. */
  async turnFileHunks(id: string, turnId: string, path: string): Promise<ThreadFileHunk[]> {
    this.readThread(id)
    const checkpoint = this.checkpoints.forTurn(id, turnId)
    return checkpoint ? this.checkpoints.fileHunks(id, checkpoint.id, path) : []
  }

  /** Undoes one change block of a finished turn. Refused while a turn or configuration owns the conversation. */
  async undoTurnHunk(id: string, turnId: string, path: string, hunkId: string): Promise<void> {
    this.readThread(id)
    if (this.busy.has(id) || this.configuring.has(id) || this.finalizing.has(id)) throw Error('Finish the active operation before undoing changes')
    const checkpoint = this.checkpoints.forTurn(id, turnId)
    if (!checkpoint) throw Error('No checkpoint exists for this turn')
    await this.checkpoints.restoreHunk(id, checkpoint.id, path, hunkId)
    this.audit(id, { action: 'undo-file', actor: 'user', summary: `Undid one change in ${path}` })
    this.changed(id)
  }

  /** Stops one running background task of the conversation's provider session. */
  async stopTask(id: string, taskId: string): Promise<void> {
    const adapter = this.adapters.get(id)
    const task = this.read(id).events.find((event): event is Extract<ThreadEvent, { type: 'subagent' }> => event.type === 'subagent' && event.state === 'running' && event.receiverThreadIds.includes(taskId))
    if (!task) throw Error('That background task is no longer running')
    if (adapter && !adapter.stopTask) throw Error('This provider cannot stop background tasks from OxeChat')
    if (!adapter?.stopTask) {
      // No provider session is left to ask: the task cannot be running, so it stops being listed as running.
      this.applyEvent(id, { ...task, state: 'unknown', completedAt: Date.now(), agents: task.agents.map(agent => ({ ...agent, status: 'unknown' as const })) })
      return
    }
    await adapter.stopTask(taskId)
  }

  async approve(id: string, requestId: string, decision: 'accept' | 'decline'): Promise<void> { await this.respond(id, requestId, { decision }) }

  async respond(id: string, requestId: string, response: ThreadRequestResponse, listedGeneration?: number): Promise<ThreadRequest | undefined> {
    const snapshot = this.read(id), generation = snapshot.thread.generation ?? 1
    if (listedGeneration !== undefined && listedGeneration !== generation) throw new ThreadRequestRefusalError('staleGeneration', 'Request belongs to an older conversation generation')
    const adapter = this.adapters.get(id)
    if (!adapter) throw new ThreadRequestRefusalError('notPending', 'Request has no live execution')
    const request = this.requests.list(id, generation).find(value => value.id === requestId); assertSessionAllowed(request, response)
    if (adapter.respondRequest) await this.requests.resolve(id, requestId, generation, response)
    else await adapter.approve(requestId, response.decision === 'accept' || response.decision === 'acceptForSession' ? 'accept' : 'decline')
    this.lastActivity.set(id, Date.now())
    if (response.decision === 'acceptForSession') this.sessionGrants.add(id)
    if (request && (request.kind === 'approval' || request.kind === 'permissions')) {
      const verb = response.decision === 'acceptForSession' ? 'Allowed for the session' : response.decision === 'accept' || response.permissions ? 'Allowed' : 'Declined'
      this.audit(id, { action: 'approval', actor: 'user', summary: `${verb} ${requestSubject(request)}` })
    }
    return request
  }

  async steer(id: string, text: string, attachmentIds: string[] = []): Promise<void> {
    assertThreadMessage(text)
    const snapshot = this.read(id), adapter = this.adapters.get(id)
    if (!this.busy.has(id) || !adapter?.steer) throw Error('This provider cannot steer the current turn')
    const attachments = await this.resolveAttachments(id, attachmentIds)
    await adapter.steer(text, attachments)
    const turn = snapshot.turns?.at(-1)
    if (turn && attachmentIds.length) turn.attachmentIds = [...new Set([...(turn.attachmentIds ?? []), ...attachmentIds])]
    const eventsFrom = snapshot.events.length
    snapshot.events.push({ type: 'message', id: randomUUID(), role: 'user', text, ...(attachments.length ? { attachments: attachments.map(({ path: _path, ...attachment }) => attachment) } : {}) })
    this.save(snapshot, { eventsFrom, ...(turn?.operationId ? { operationId: turn.operationId } : {}) })
  }

  updateQueued(id: string, itemId: string, text: string): Promise<void> {
    return updateQueued(this.queueHost(), id, itemId, text)
  }

  deleteQueued(id: string, itemId: string, preserveAttachments = false): Promise<void> {
    return deleteQueued(this.queueHost(), id, itemId, preserveAttachments)
  }

  /** Sends a finished turn's prompt again, optionally after undoing its file changes (see thread-rewind-flow). */
  retryTurn(id: string, turnId: string, options: { restoreFiles?: boolean } = {}): Promise<{ restoredFiles: number }> {
    return retryTurn(this.rewindHost(), id, turnId, options)
  }

  /** Rewinds to just before a turn; the provider follows when the next message is sent (see thread-rewind-flow). */
  rewind(id: string, turnId: string, options: { restoreFiles?: boolean } = {}): Promise<ThreadRewindResult> {
    return rewind(this.rewindHost(), id, turnId, options)
  }

  /** Undoes a rewind that was not sent yet. */
  redoRewind(id: string): Promise<ThreadSnapshot> {
    return redoRewind(this.rewindHost(), id)
  }

  private applyPendingRewind(id: string): Promise<void> {
    return applyPendingRewind(this.rewindHost(), id)
  }

  private rewindHost(): RewindHost {
    return {
      db: this.db, checkpoints: this.checkpoints,
      isStopping: () => this.stopping,
      isActive: id => this.busy.has(id) || this.starting.has(id) || this.finalizing.has(id) || this.configuring.has(id),
      isFinalizing: id => this.finalizing.has(id),
      settleFinalization: async () => { await Promise.allSettled([...this.finalizationTasks]) },
      withConfiguring: async (id, run) => {
        this.configuring.add(id)
        try { return await run() } finally { this.configuring.delete(id) }
      },
      read: id => this.read(id),
      readForRenderer: id => this.readForRenderer(id),
      save: (snapshot, options) => this.save(snapshot, options),
      replace: snapshot => { this.history.write(snapshot, { eventsFrom: 0, turnsFrom: 0 }); this.snapshots.set(snapshot.thread.id, snapshot) },
      cancelOperation: (id, operationId, reason) => this.history.transitionOperation(id, operationId, 'cancelled', reason),
      changed: id => this.changed(id),
      audit: (id, entry) => this.audit(id, entry),
      send: (id, text, attachmentIds) => this.send(id, text, attachmentIds),
      connectAdapter: (id, thread) => this.connectAdapter(id, thread),
      disposeAdapter: async id => { const adapter = this.adapters.get(id); this.adapters.delete(id); await adapter?.dispose() }
    }
  }

  /** Clears a pause and lets the queue continue from its first waiting item. */
  resumeQueue(id: string): Promise<void> {
    return resumeQueue(this.queueHost(), id)
  }

  /** Moves one waiting item to the front and sends it, stopping a running turn first. */
  sendQueuedNow(id: string, itemId: string): Promise<void> {
    return sendQueuedNow(this.queueHost(), id, itemId)
  }

  reorderQueued(id: string, itemIds: string[]): Promise<void> {
    return reorderQueued(this.queueHost(), id, itemIds)
  }

  pin(id: string, pinned: boolean): void {
    const snapshot = this.read(id)
    snapshot.thread.pinned = pinned
    this.save(snapshot, { eventsFrom: snapshot.events.length })
  }

  commands(id: string, forceRefresh = false): Promise<ThreadCommandCatalog> {
    return this.commandService?.list(this.readThread(id), forceRefresh) ?? Promise.resolve({ commands: [] })
  }

  models(id: string, refresh = false): Promise<ThreadModelCatalog> {
    if (!this.modelService) return Promise.reject(Error('Model discovery is unavailable. Restart the updated application.'))
    return this.modelService.list(this.readThread(id), refresh)
  }

  async configure(id: string, input: ThreadConfiguration, revision: number): Promise<ThreadSnapshot> {
    if (this.stopping || this.configuring.has(id)) throw Error('Configuration is already being updated')
    this.configuring.add(id)
    try {
      let snapshot = this.read(id)
      if (blocksThreadInput(snapshot.thread)) throw Error('Recover this conversation before changing its configuration')
      if ((snapshot.thread.configurationRevision ?? 0) !== revision) throw Error('Configuration changed. Refresh this conversation and try again.')
      const previous = snapshot.thread.pendingConfiguration ?? snapshot.thread
      const before = turnConfiguration(previous)
      const configuration: ThreadConfiguration = mergeTurnConfiguration(previous, input)
      if (configuration.access === 'read-only') configuration.hooksEnabled = false
      // Auto-accepting edits is a Claude permission mode that only means something when edits are allowed.
      if (configuration.mode === 'acceptEdits' && snapshot.thread.provider !== 'claude') throw Error('Auto-accepting edits is available for Claude conversations')
      if (configuration.mode === 'acceptEdits' && configuration.access !== 'workspace-write') configuration.mode = 'default'
      if (input.model || input.reasoningEffort !== undefined) {
        const catalog = await this.models(id)
        configuration.model ??= catalog.defaultModel
        const model = catalog.models.find(model => model.id === configuration.model)
        if (!model) {
          // The provider still picks the model, so only the effort can be checked.
          if (configuration.model || catalog.defaultKnown !== false) throw Error('Select an available model')
          if (input.reasoningEffort && !catalog.models.some(value => value.efforts.includes(input.reasoningEffort!))) throw Error('This reasoning effort is not supported by any available model')
        } else {
          if (input.reasoningEffort && !model.efforts.includes(input.reasoningEffort)) throw Error('This reasoning effort is not supported by the selected model')
          if (!configuration.reasoningEffort || !model.efforts.includes(configuration.reasoningEffort)) configuration.reasoningEffort = model.defaultEffort
        }
      }
      snapshot = this.read(id)
      if (this.stopping) throw Error('Application is shutting down')
      if (this.busy.has(id)) snapshot.thread.pendingConfiguration = configuration
      else {
        const adapter = this.adapters.get(id)
        if (adapter && !adapter.configure) throw Error('The provider cannot apply this configuration')
        await adapter?.configure?.(configuration)
        snapshot = this.read(id)
        Object.assign(snapshot.thread, configuration)
        delete snapshot.thread.pendingConfiguration
      }
      snapshot.thread.configurationRevision = revision + 1
      this.save(snapshot, { eventsFrom: snapshot.events.length })
      const changed = (['access', 'mode', 'approvalPolicy', 'networkAccess', 'hooksEnabled'] as const).filter(key => before[key] !== configuration[key])
      if (changed.length) this.audit(id, { action: 'configuration', actor: 'user', summary: `Changed ${changed.map(key => `${key} to ${String(configuration[key] ?? 'default')}`).join(', ')}${this.busy.has(id) ? ' (from the next turn)' : ''}` })
      return snapshot
    } finally { this.configuring.delete(id) }
  }

  async recover(id: string): Promise<void> {
    if (this.busy.has(id) || this.configuring.has(id)) throw Error('Finish the active operation before recovery')
    this.configuring.add(id)
    try {
      const snapshot = this.read(id)
      if (snapshot.thread.nativeSessionId && this.nativeCli) {
        const history = await this.nativeCli.read(snapshot.thread, snapshot.thread.nativeSessionId)
        snapshot.events = history.events
        snapshot.thread.nativeHistoryCursor = history.cursor
        this.history.clearNativePages(id)
        if (history.title) snapshot.thread.title = history.title
        snapshot.thread.cliNotice = history.truncated ? PARTIAL_NATIVE_HISTORY_NOTICE : undefined
      }
      snapshot.thread.cliActive = false
      snapshot.thread.status = 'idle'
      this.save(snapshot)
    } finally { this.configuring.delete(id) }
  }

  async command(id: string, text: string): Promise<ThreadCommandResult> {
    return runThreadCommand(this.commandHost(), id, text)
  }

  private commandHost(): CommandHost {
    return {
      db: this.db, history: this.history, exports: this.exports, checkpoints: this.checkpoints, nativeCli: this.nativeCli,
      read: id => this.read(id),
      save: (snapshot, options) => this.save(snapshot, options),
      create: context => this.create(context),
      configure: (id, input, revision) => this.configure(id, input, revision),
      interrupt: id => this.interrupt(id),
      rewind: (id, turnId) => this.rewind(id, turnId),
      send: (id, text) => this.send(id, text),
      connectAdapter: (id, thread) => this.connectAdapter(id, thread),
      assertNativeSessionAvailable: (id, provider, nativeSessionId) => this.assertNativeSessionAvailable(id, provider, nativeSessionId),
      adapterCapabilities: id => this.adapters.get(id)?.capabilities,
      isBusy: id => this.busy.has(id), audit: (id, entry) => this.audit(id, entry), command: (id, text) => this.command(id, text), cancelRequests: id => this.requests.invalidate(id),
      isConfiguring: id => this.configuring.has(id),
      withConfiguring: async (id, run) => {
        this.configuring.add(id)
        try { return await run() } finally { this.configuring.delete(id) }
      },
      disposeAdapter: async id => { const adapter = this.adapters.get(id); this.adapters.delete(id); await adapter?.dispose() },
      deleteThread: async id => {
        this.db.prepare('DELETE FROM conversation_threads WHERE id = ?').run(id)
        this.forget(id)
        await this.attachmentStore?.removeThread(id)
        this.changed(id)
      }
    }
  }

  async stop(): Promise<void> {
    this.snapshots.close()
    for (const id of this.deltaBuffers.keys()) this.flushDeltas(id)
    this.stopping = true
    clearInterval(this.idleSweep)
    clearInterval(this.retentionSweep)
    this.work.stop()
    const observations = Promise.allSettled([...this.observations.values()])
    await this.stateReader?.stop()
    await this.nativeCli?.closeHistoryReader?.()
    await Promise.allSettled([...this.nativePageLoads.values()])
    await Promise.resolve() // let already scheduled turn finalizers register before closing the database
    await Promise.allSettled([...this.finalizationTasks])
    await this.commandService?.stop?.()
    await this.modelService?.stop()
    for (const id of this.busy) {
      try {
        const snapshot = this.read(id)
        if (snapshot.thread.status === 'running' || snapshot.thread.status === 'approval') {
          settleVolatileThreadSnapshot(snapshot, 'shutdown')
          this.history.settleOpenOperations(snapshot.thread.id, 'unknown', 'OXESpace closed before the provider result was confirmed.')
          this.save(snapshot)
        }
      } catch { /* Workspace removed during auth preflight. */ }
    }
    this.busy.clear()
    this.finalizing.clear()
    this.turns.clear()
    for (const id of this.adapters.keys()) {
      try { const snapshot = this.read(id); snapshot.thread.connection = this.sessions.close(id); this.save(snapshot, { eventsFrom: snapshot.events.length }) } catch { /* deleted */ }
    }
    await Promise.allSettled([...this.adapters.values()].map(adapter => adapter.dispose()))
    await observations
    this.adapters.clear()
    for (const row of this.db.prepare('SELECT id FROM conversation_threads').all() as { id: string }[]) this.requests.invalidate(row.id)
  }

  private event(id: string, event: ThreadEvent, generation?: number): void {
    if (this.stopping) return
    this.lastActivity.set(id, Date.now())
    if (event.type === 'delta') {
      if (!this.deltaBuffers.has(id) && !this.db.prepare('SELECT 1 FROM conversation_threads WHERE id = ?').get(id)) { this.applyEvent(id, event); return }
      const buffer = this.deltaBuffers.get(id) ?? new Map<string, { text: string; generation?: number }>()
      const previous = buffer.get(event.id)
      buffer.set(event.id, { text: ((previous?.text ?? '') + event.text).slice(0, 256 * 1024), generation: generation ?? previous?.generation })
      this.deltaBuffers.set(id, buffer)
      if (!this.deltaTimers.has(id)) this.deltaTimers.set(id, setTimeout(() => this.flushDeltas(id), 80))
      return
    }
    this.flushDeltas(id)
    this.applyEvent(id, event, generation)
  }

  private storeContext(id: string, report: ThreadContextReport): void {
    try {
      const snapshot = this.read(id)
      snapshot.thread.contextReport = report
      this.save(snapshot, { eventsFrom: snapshot.events.length })
    } catch { /* Thread may have been deleted while the provider was reporting. */ }
  }

  /**
   * Records where the provider says it works. A worktree of the thread's repository is registered as a
   * context of the same project, so the review panels may read it; working in `rootPath` clears the record.
   * Saved only when it changes, since Codex reports a directory with every command.
   */
  private storeLocation(id: string, cwd: string): void {
    try {
      const snapshot = this.read(id)
      const location = resolveSessionLocation(cwd, snapshot.thread.rootPath)
      if (!location) return
      const atRoot = location.sameRepository && location.checkoutRoot !== null && sameCheckout(location.checkoutRoot, snapshot.thread.rootPath)
      const next = atRoot ? undefined : location
      const previous = snapshot.thread.observedLocation
      if (previous?.checkoutRoot === next?.checkoutRoot && previous?.sameRepository === next?.sameRepository && (previous?.cwd === next?.cwd || next?.sameRepository)) return
      if (next?.sameRepository && next.checkoutRoot) {
        this.db.prepare('INSERT OR IGNORE INTO thread_project_contexts (project_id, root_path) VALUES (?, ?)').run(snapshot.thread.projectId, next.checkoutRoot)
      }
      if (next) snapshot.thread.observedLocation = next
      else delete snapshot.thread.observedLocation
      this.save(snapshot, { eventsFrom: snapshot.events.length })
      // A move during a running turn: that checkout gets its own checkpoint and baseline, so what the turn
      // changes there can be reviewed and undone like changes in the root.
      const turn = snapshot.turns?.at(-1)
      if (this.busy.has(id) && turn?.status === 'running' && next?.sameRepository && next.checkoutRoot) {
        void this.turns.begin(id, turn.id, next.checkoutRoot, 'In a worktree').catch(() => undefined)
      }
    } catch { /* Thread may have been deleted while the provider was reporting. */ }
  }

  private storeCost(id: string, turn: Extract<ThreadEvent, { type: 'turn-cost' }>): void {
    try {
      const snapshot = this.read(id)
      const { type: _type, ...cost } = turn
      const now = Date.now()
      snapshot.thread.costReport = addTurnCost(repairLegacyCost(snapshot.thread.costReport), cost, now, snapshot.thread.provider === 'codex' ? 'codex-token-usage' : 'claude-result-step')
      this.save(snapshot, { eventsFrom: snapshot.events.length })
      const model = snapshot.thread.model ?? snapshot.thread.contextReport?.model
      try { this.usage.record({ ...cost, ...turnSteps(snapshot), threadId: id, projectRoot: snapshot.thread.rootPath, provider: snapshot.thread.provider, ...(model ? { model } : {}), at: now }) } catch { /* The ledger is best effort; the conversation keeps its own total. */ }
    } catch { /* Thread may have been deleted while the provider was reporting. */ }
  }

  /** Reads the provider's context report; only while idle, and a failure keeps the previous report. */
  async contextUsage(id: string): Promise<ThreadContextReport | null> {
    const adapter = this.adapters.get(id)
    const previous = this.readThread(id).contextReport ?? null
    if (!adapter?.contextUsage || this.busy.has(id) || this.finalizing.has(id)) return previous
    const report = await adapter.contextUsage().catch(() => null)
    if (!report) return previous
    this.storeContext(id, report)
    return report
  }

  private flushDeltas(id: string): void {
    const buffer = this.deltaBuffers.get(id)
    if (!buffer) return
    this.deltaBuffers.delete(id)
    clearTimeout(this.deltaTimers.get(id)); this.deltaTimers.delete(id)
    for (const [messageId, delta] of buffer) this.applyEvent(id, { type: 'delta', id: messageId, text: delta.text }, delta.generation)
  }

  private applyEvent(id: string, event: ThreadEvent, generation?: number): void {
    if (this.stopping) return
    if (event.type === 'context-usage') { this.storeContext(id, event.report); return }
    if (event.type === 'turn-cost') { this.storeCost(id, event); return }
    if (event.type === 'location') { this.storeLocation(id, event.cwd); return }
    let snapshot: ThreadSnapshot
    try { snapshot = this.read(id) } catch {
      this.busy.delete(id)
      const adapter = this.adapters.get(id)
      this.adapters.delete(id)
      void adapter?.dispose().catch(() => {})
      return
    }
    if (generation !== undefined && generation !== (snapshot.thread.generation ?? 1)) return
    const diagnostic = { thread: id, turn: snapshot.turns?.at(-1)?.id, generation }
    switch (event.type) {
      case 'tool': case 'subagent':
        recordRuntime(event.type, { ...diagnostic, task: event.id, state: event.state }); break
      case 'approval': case 'request':
        recordRuntime(event.type, { ...diagnostic, task: event.id, state: 'pending' }); break
      case 'approval-resolved': case 'request-resolved':
        recordRuntime(event.type, { ...diagnostic, task: event.id }); break
      case 'completed':
        recordRuntime('completed', { ...diagnostic, state: event.status }); break
      case 'turn-accepted': case 'continuation-started': case 'connection-closed':
        recordRuntime(event.type, diagnostic); break
    }
    if (event.type === 'connection-closed') {
      snapshot.thread.connection = this.sessions.close(id, event.at)
      this.save(snapshot, { eventsFrom: snapshot.events.length })
      return
    }
    if (event.type === 'native-signal') {
      snapshot.thread.connection = this.sessions.nativeSignal(id, event.at)
      this.save(snapshot, { eventsFrom: snapshot.events.length })
      return
    }
    // Side effects the reducer depends on run first, in the original order.
    if (event.type === 'request') {
      const adapter = this.adapters.get(id)
      event.request.generation = snapshot.thread.generation ?? 1
      const policy = this.evaluatePolicy(snapshot.thread.rootPath, event.request, snapshot.thread.access)
      if (policy) attachPolicy(event.request, policy)
      if (adapter?.respondRequest) this.requests.register(id, event.request, response => adapter.respondRequest!(event.id, response), expired => {
        try { this.event(id, { type: 'request-resolved', id: expired.id, state: 'expired', resolution: 'unknown', resolvedAt: expired.resolvedAt }, expired.generation) }
        catch { /* The conversation may have been deleted while the timer was pending. */ }
      })
    } else if (event.type === 'request-resolved' && event.state !== 'pending') {
      this.requests.settle(id, event.id, event.state)
    }
    const endingTurn = event.type === 'completed' ? snapshot.turns?.at(-1) : undefined
    const needsVerifiedDiff = event.type === 'completed' && this.turns.hasBaseline(id)
    const needsCheckpoint = Boolean(endingTurn && this.turns.hasCheckpoints(endingTurn.id))
    const invalidated = event.type === 'completed' ? this.requests.invalidate(id, event.status === 'completed' ? 'expired' : 'cancelled') : []

    const result = reduceThreadEvent(snapshot, event, {
      now: () => Date.now(),
      pendingRequestCount: () => this.requests.list(id, snapshot.thread.generation ?? 1).length,
      invalidated,
      needsVerifiedDiff,
      needsCheckpoint
    })
    // Lists read the thread, not its events: keep there whether background work still runs.
    let save = result.save
    if (event.type === 'subagent') {
      const background = backgroundSummary(snapshot.events)
      if (JSON.stringify(background) !== JSON.stringify(snapshot.thread.background)) {
        if (background) snapshot.thread.background = background
        else delete snapshot.thread.background
        save ??= { eventsFrom: snapshot.events.length }
      }
    }
    this.runEffects(id, snapshot, event, result.before)
    if (save) this.save(snapshot, save)
    this.runEffects(id, snapshot, event, result.after)
    if (event.type === 'request' && event.request.policy && event.request.policy.decision !== 'ask' && this.adapters.get(id)?.respondRequest) {
      // After the adapter has finished announcing the request (Claude emits `approval` right after it).
      const request = event.request
      queueMicrotask(() => { void this.applyPolicy(id, request) })
    }
  }

  private evaluatePolicy(rootPath: string, request: ThreadRequest, access?: ThreadConfiguration['access']) {
    return this.policy.evaluate(rootPath, request, access)
  }

  private applyPolicy(id: string, request: ThreadRequest): Promise<void> { return this.policy.apply(id, request) }

  /** Records a decision; auditing never interrupts the action it describes. */
  private audit(id: string, entry: Omit<ThreadAuditEntry, 'id' | 'at' | 'threadId' | 'projectRoot'>): void { this.policy.audit(id, entry) }

  /** Rules that answer this conversation's approvals: its project's and the global ones. */
  permissionRules(id: string): ThreadPermissionRule[] { return this.policy.rules(id) }

  addPermissionRule(id: string, input: Parameters<ThreadPolicy['addRule']>[1]): ThreadPermissionRule { return this.policy.addRule(id, input) }

  removePermissionRule(id: string, ruleId: string): void { this.policy.removeRule(id, ruleId) }

  workRuns(id: string): WorkRun[] {
    this.readThread(id)
    return this.work.runsFor(id)
  }

  async cancelWork(id: string, runId: string): Promise<WorkRun> {
    const run = this.work.run(runId)
    // The person may cancel from the supervisor or from any of its workers.
    if (run.supervisorThreadId !== id && !run.tasks.some(task => task.threadId === id)) throw Error('This run is not related to the conversation')
    return this.work.cancel(runId, 'user')
  }

  usageSummary(id: string, options: { scope?: 'thread' | 'project' | 'all'; days?: number } = {}): ThreadUsageSummary {
    const thread = this.readThread(id)
    const scope = options.scope ?? 'project'
    return this.usage.summary({ scope, threadId: id, projectRoot: thread.rootPath, days: options.days })
  }

  /** Saved events of a conversation, newest matches read first and returned oldest first, for the debug inspector. */
  debugEvents(id: string, options: { filter?: string; before?: number; limit?: number } = {}): ThreadDebugPage {
    this.readThread(id)
    return this.history.debugEvents(id, options)
  }

  autoApproveReads(): boolean { return this.policy.autoApproveReads() }

  setAutoApproveReads(enabled: boolean): boolean { return this.policy.setAutoApproveReads(enabled) }

  auditLog(id: string, options: { scope?: 'thread' | 'project'; before?: number; limit?: number } = {}): ThreadAuditEntry[] {
    return this.policy.auditLog(id, options)
  }

  /** Executes reducer effects; the only place event handling touches ownership, history and timers. */
  private runEffects(id: string, snapshot: ThreadSnapshot, event: ThreadEvent, effects: KernelEffect[]): void {
    for (const effect of effects) {
      switch (effect.kind) {
        case 'busy-add': this.busy.add(id); break
        case 'busy-delete': this.busy.delete(id); break
        case 'finalizing-add': this.finalizing.add(id); break
        case 'operation': this.history.transitionOperation(id, effect.operationId, effect.state, effect.error); break
        case 'release-attachments': void this.releaseAttachments(id, effect.attachmentIds); break
        case 'refresh-capabilities': {
          const adapter = this.adapters.get(id)
          if (adapter) snapshot.thread.capabilities = threadCapabilityManifest(snapshot.thread.provider, adapter.capabilities, snapshot.thread.connection?.state === 'connected', adapter.evidence, snapshot.thread)
          break
        }
        case 'finalize': queueMicrotask(() => {
          const task = this.finalizeTurnThenDrain(id, effect.status, effect.turnId, effect.captureDiff)
          this.finalizationTasks.add(task)
          void task.finally(() => this.finalizationTasks.delete(task)).catch(() => {})
        }); break
        case 'drain': queueMicrotask(() => void this.drainQueue(id)); break
        case 'refresh-context': queueMicrotask(() => void this.contextUsage(id)); break
        case 'memory-event': this.memoryEvent?.(snapshot, event); break
      }
    }
  }

  private save(snapshot: ThreadSnapshot, options?: ThreadHistoryWriteOptions): void {
    snapshot.thread.updatedAt = Date.now()
    if (!options) this.history.rewriteHistory(snapshot)
    else if (options.eventsFrom === snapshot.events.length && !options.operationId) this.history.updateThreadMetadata(snapshot.thread)
    else this.history.persistFrom(snapshot, options.eventsFrom ?? 0, options.operationId)
    this.snapshots.delete(snapshot.thread.id); this.snapshots.set(snapshot.thread.id, snapshot)
    this.trimSnapshots()
    this.changed(snapshot.thread.id)
  }

  private resolveAttachments(id: string, attachmentIds: string[]): Promise<import('../../../../shared/types/thread').ThreadAttachment[]> {
    if (!attachmentIds.length) return Promise.resolve([])
    if (!this.attachmentStore) return Promise.reject(Error('Attachments are unavailable'))
    return this.attachmentStore.resolve(id, attachmentIds)
  }

  private async releaseAttachments(id: string, attachmentIds: string[]): Promise<void> {
    if (!this.attachmentStore || !attachmentIds.length) return
    await Promise.allSettled(attachmentIds.map(attachmentId => this.attachmentStore!.remove(id, attachmentId)))
  }

  private async finalizeTurnThenDrain(id: string, status: 'completed' | 'interrupted' | 'failed', turnId: string | undefined, captureDiff: boolean, drain = true): Promise<void> {
    try { await this.turns.finalize(id, status, turnId, captureDiff) } finally {
      this.finalizing.delete(id)
      if (drain) await this.drainQueue(id)
    }
  }

  /** One provider process per conversation: callers that arrive while it is opening share that connection. */
  private connectAdapter(id: string, thread: ConversationThread, runPreflight = true): Promise<AgentConversationAdapter> {
    const pending = this.connecting.get(id)
    if (pending) return pending
    const opening = this.openAdapter(id, thread, runPreflight)
    this.connecting.set(id, opening)
    const release = (): void => { if (this.connecting.get(id) === opening) this.connecting.delete(id) }
    opening.then(release, release)
    return opening
  }

  private async openAdapter(id: string, thread: ConversationThread, runPreflight: boolean): Promise<AgentConversationAdapter> {
    // An idle suspension still closing this conversation's process finishes first.
    await this.suspending.get(id)
    const existing = this.adapters.get(id)
    if (existing && !existing.closed) { this.lastActivity.set(id, Date.now()); return existing }
    if (existing?.closed) this.adapters.delete(id)
    this.assertNativeSessionAvailable(id, thread.provider, thread.nativeSessionId)
    if (runPreflight) await this.preflight?.(thread)
    if (!this.sessions.get(id) && thread.connection) this.sessions.restore(id, thread.connection)
    if (!this.sessions.canAttempt(id)) throw Error(`Provider connection is cooling down until ${new Date(this.sessions.get(id)!.nextRetryAt!).toLocaleTimeString()}.`)
    const connecting = this.read(id)
    connecting.thread.connection = this.sessions.begin(id)
    this.save(connecting, { eventsFrom: connecting.events.length })
    let adapter: AgentConversationAdapter | undefined
    try {
      adapter = await this.factory(thread)
      if (this.stopping) { await adapter.dispose(); throw Error('Application is shutting down') }
      this.adapters.set(id, adapter)
      this.lastActivity.set(id, Date.now())
      this.sessionGrants.delete(id)
      const latest = this.read(id)
      latest.thread.capabilities = threadCapabilityManifest(latest.thread.provider, adapter.capabilities, false, adapter.evidence, latest.thread)
      this.save(latest, { eventsFrom: latest.events.length })
      const owned = adapter, generation = latest.thread.generation ?? 1
      await adapter.start({ rootPath: latest.thread.rootPath, nativeSessionId: latest.thread.nativeSessionId, model: latest.thread.model, reasoningEffort: latest.thread.reasoningEffort, access: latest.thread.access, networkAccess: latest.thread.networkAccess ?? false, approvalPolicy: latest.thread.approvalPolicy ?? 'on-request', mode: latest.thread.mode, hooksEnabled: latest.thread.hooksEnabled ?? false }, event => { if (this.adapters.get(id) === owned) this.event(id, event, generation) })
      const connected = this.read(id)
      connected.thread.capabilities = threadCapabilityManifest(connected.thread.provider, adapter.capabilities, true, adapter.evidence, connected.thread)
      connected.thread.connection = this.sessions.connected(id)
      this.save(connected, { eventsFrom: connected.events.length })
      return adapter
    } catch (cause) {
      if (adapter && this.adapters.get(id) === adapter) this.adapters.delete(id)
      await adapter?.dispose().catch(() => {})
      // A removed worktree makes the provider fail to start with a spawn error; say what actually happened.
      const error = explainMissingFolder(cause, thread.rootPath)
      try {
        const degraded = this.read(id)
        degraded.thread.connection = this.sessions.failed(id, error instanceof Error ? error.message : 'Provider connection failed')
        this.save(degraded, { eventsFrom: degraded.events.length })
      } catch { /* Thread may have been deleted while the provider was starting. */ }
      throw error
    }
  }

  private drainQueue(id: string): Promise<void> {
    return drainQueue(this.queueHost(), id)
  }

  private queueHost(): QueueHost {
    return {
      isStopping: () => this.stopping,
      isBusy: id => this.busy.has(id),
      blocksDrain: id => this.busy.has(id) || this.finalizing.has(id) || this.configuring.has(id),
      setBusy: (id, busy) => { if (busy) this.busy.add(id); else this.busy.delete(id) },
      markSendNowAfterStop: (id, marked) => { if (marked) this.sendNowAfterStop.add(id); else this.sendNowAfterStop.delete(id) },
      takeSendNowAfterStop: id => this.sendNowAfterStop.delete(id),
      read: id => this.read(id),
      save: (snapshot, options) => this.save(snapshot, options),
      transitionOperation: (id, operationId, state, reason) => { this.history.transitionOperation(id, operationId, state, reason) },
      adapter: id => this.adapters.get(id),
      resolveAttachments: (id, attachmentIds) => this.resolveAttachments(id, attachmentIds),
      releaseAttachments: (id, attachmentIds) => this.releaseAttachments(id, attachmentIds),
      applyPendingRewind: id => this.applyPendingRewind(id),
      beginTurn: (id, turnId, thread, label, baseline) => this.turns.begin(id, turnId, workingRootOf(thread), label, baseline),
      send: (id, text, attachmentIds) => this.send(id, text, attachmentIds),
      interrupt: id => this.interrupt(id)
    }
  }

  private assertNativeSessionAvailable(id: string, provider: ConversationThread['provider'], nativeSessionId: string | null): void {
    if (!nativeSessionId) return
    for (const otherId of this.adapters.keys()) {
      if (otherId === id) continue
      try {
        const other = this.read(otherId).thread
        const activeNativeId = other.nativeSessionId
        if (other.provider === provider && activeNativeId === nativeSessionId) {
          throw Error('This native session is already open in another OxeChat conversation')
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes('already open')) throw error
        // Deleted local owners are ignored and cleaned up by their lifecycle.
      }
    }
  }
}
