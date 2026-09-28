import { randomUUID } from 'node:crypto'
import type { AppDatabase } from '../../db'
import type { AgentConversationAdapter, ConversationThread, ThreadAgentInput, ThreadCommandCatalog, ThreadEvent, ThreadSnapshot, ThreadRequestResponse, ThreadQueuedInput } from '../../../../shared/types/thread'
import type { NativeCliSession, ThreadNativeCli } from './thread-cli'
import type { ThreadModelCatalog, ThreadConfiguration, ThreadCommandResult } from '../../../../shared/types/thread'
import type { ThreadModelService } from './thread-models'
import { hasDesktopCommand } from '../../../../shared/threadDesktopCommands'
import { formatNativeUserText } from '../../../../shared/native-session-text'
import { execFile } from 'node:child_process'
import { ThreadAgentError, threadFailure } from './thread-failure'
import { ThreadHistory, type ThreadHistoryWriteOptions } from './thread-history'
import { ThreadRequestRegistry } from './thread-request-registry'
import type { ThreadAttachmentStore } from './thread-attachments'
import { threadCapabilityManifest } from './thread-capabilities'
import { splitThreadPatch } from '../../../../shared/threadPatch'
import { settleVolatileThreadSnapshot } from './thread-recovery.service'
import { ThreadSessionSupervisor } from './thread-session-supervisor'
import { ThreadExportService } from './thread-export.service'
import { ThreadPortableService } from './thread-portable'
import { ThreadCheckpointService } from './thread-checkpoints'

export class ThreadOrchestrator {
  private readonly changeListeners = new Map<string, Set<() => void>>()
  subscribe(id: string, listener: () => void): () => void {
    const listeners = this.changeListeners.get(id) ?? new Set<() => void>()
    listeners.add(listener); this.changeListeners.set(id, listeners)
    return () => { listeners.delete(listener); if (!listeners.size) this.changeListeners.delete(id) }
  }
  private changed(id: string): void {
    this.notifyChanged(id)
    for (const listener of this.changeListeners.get(id) ?? []) listener()
  }
  private readonly history: ThreadHistory
  /** Full snapshots are retained only for active main-process work. Renderer reads stay paginated. */
  private readonly snapshots = new Map<string, ThreadSnapshot>()
  private readonly deltaBuffers = new Map<string, Map<string, { text: string; generation?: number }>>()
  private readonly deltaTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly adapters = new Map<string, AgentConversationAdapter>()
  private readonly requests = new ThreadRequestRegistry()
  private readonly sessions = new ThreadSessionSupervisor()
  private readonly exports: ThreadExportService
  private readonly portable = new ThreadPortableService()
  private readonly checkpoints: ThreadCheckpointService
  private readonly turnCheckpoints = new Map<string, string>()
  private readonly busy = new Set<string>()
  private readonly finalizing = new Set<string>()
  private readonly finalizationTasks = new Set<Promise<void>>()
  private readonly workingTreeBaselines = new Map<string, { patch: string; untracked: Set<string> }>()
  private stopping = false
  private readonly configuring = new Set<string>()
  private readonly cliSessions = new Map<string, NativeCliSession>()
  private readonly cliStarting = new Map<string, Promise<import('../../../../shared/types/thread').ThreadCliState>>()

  constructor(private readonly db: AppDatabase,
    private readonly factory: (thread: ConversationThread) => Promise<AgentConversationAdapter>,
    private readonly notifyChanged: (threadId: string) => void,
    private readonly preflight?: (thread: ConversationThread) => Promise<void>,
    private readonly commandService?: {
      list(thread: ConversationThread, forceRefresh?: boolean): Promise<ThreadCommandCatalog>
      prepare(thread: ConversationThread, text: string): Promise<ThreadAgentInput>
      stop?(): Promise<void>
    }, private readonly nativeCli?: Pick<ThreadNativeCli, 'open' | 'read'>,
    private readonly modelService?: Pick<ThreadModelService, 'list' | 'stop'>,
    private readonly attachmentStore?: ThreadAttachmentStore) {
    this.history = new ThreadHistory(db)
    this.exports = new ThreadExportService((threadId, artifactId) => this.history.artifact(threadId, artifactId))
    this.checkpoints = new ThreadCheckpointService(db)
    // A persisted running state is not proof that its process survived a restart.
    for (const row of db.prepare('SELECT id FROM conversation_threads').all() as { id: string }[]) {
      const snapshot = this.history.read(row.id)
      let recovered = false
      let eventsFrom = snapshot.events.length
      if (snapshot.thread.status === 'running' || snapshot.thread.status === 'approval' || snapshot.thread.cliActive) {
        settleVolatileThreadSnapshot(snapshot, 'restart')
        this.history.settleOpenOperations(snapshot.thread.id, 'unknown', 'OXESpace restarted before the provider result was confirmed.')
        recovered = true; eventsFrom = 0
      }
      this.checkpoints.failOpen(row.id, 'OXESpace restarted before this checkpoint could be finalized.')
      if (snapshot.thread.connection && snapshot.thread.connection.state !== 'closed') { snapshot.thread.connection = this.sessions.close(row.id); recovered = true }
      if (recovered) this.save(snapshot, { eventsFrom })
      this.snapshots.delete(row.id)
    }
  }

  list(workspaceId: string): ConversationThread[] {
    return (this.db.prepare('SELECT data_json FROM conversation_threads WHERE workspace_id = ?').all(workspaceId) as { data_json: string }[])
      .map(row => JSON.parse(row.data_json) as ConversationThread)
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt)
  }

  create(context: Pick<ConversationThread, 'workspaceId' | 'projectId' | 'rootPath' | 'provider' | 'agentProfileId'>): ThreadSnapshot {
    const now = Date.now()
    const snapshot: ThreadSnapshot = { thread: { ...context, id: randomUUID(), nativeSessionId: null,
      title: 'New thread', pinned: false, status: 'idle', createdAt: now, updatedAt: now, generation: 1, queue: [], capabilities: threadCapabilityManifest(context.provider), connection: { state: 'closed', attempt: 0, changedAt: now } }, events: [] }
    this.db.prepare('INSERT INTO conversation_threads (id, workspace_id, data_json, events_json) VALUES (?, ?, ?, ?)')
      .run(snapshot.thread.id, context.workspaceId, JSON.stringify(snapshot.thread), '[]')
    this.snapshots.set(snapshot.thread.id, snapshot)
    this.changed(snapshot.thread.id)
    return snapshot
  }

  read(id: string): ThreadSnapshot {
    this.flushDeltas(id)
    const cached = this.snapshots.get(id)
    if (cached) {
      if (this.db.prepare('SELECT 1 FROM conversation_threads WHERE id = ?').get(id)) return cached
      this.snapshots.delete(id)
      throw Error('Thread not found')
    }
    const snapshot = this.history.read(id)
    this.snapshots.set(id, snapshot)
    return snapshot
  }

  readForRenderer(id: string): ThreadSnapshot {
    this.flushDeltas(id)
    const window = this.history.readWindow(id)
    if (window.thread.nativeSessionId && (/^Recovered (?:codex|claude) session$/i.test(window.thread.title) || window.thread.title.startsWith('<environment_context>'))) {
      const full = this.read(id)
      const firstPrompt = full.events.find(event => event.type === 'message' && event.role === 'user' && formatNativeUserText(event.text))
      if (firstPrompt?.type === 'message' || window.thread.title.startsWith('<environment_context>')) {
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

  artifact(id: string, artifactId: string): import('../../../../shared/types/thread').ThreadArtifact {
    this.read(id)
    return this.history.artifact(id, artifactId)
  }

  historyPage(id: string, before?: number, limit?: number): import('../../../../shared/types/thread').ThreadHistoryPage {
    this.flushDeltas(id)
    return this.history.page(id, before, limit)
  }

  exportPortable(id: string): string {
    return this.portable.serialize(this.read(id), this.history.artifacts(id))
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
    this.read(id)
    if (!this.attachmentStore) throw Error('Attachments are unavailable')
    return this.attachmentStore.add(id, input)
  }

  async removeAttachment(id: string, attachmentId: string): Promise<void> {
    this.read(id)
    if (!this.attachmentStore) throw Error('Attachments are unavailable')
    await this.attachmentStore.remove(id, attachmentId)
  }

  async projectDiff(id: string): Promise<import('../../../../shared/types/git').GitDiff> {
    const { rootPath } = this.read(id).thread
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
    this.read(id)
    const { parseDiffOutput } = await import('../git.service')
    return { files: parseDiffOutput(raw), base: hasHead ? 'HEAD' : 'Unborn branch', includeUncommitted: true, compiledAt: Date.now() }
  }

  async send(id: string, text: string, attachmentIds: string[] = []): Promise<void> {
    if (this.stopping) throw new Error('Application is shutting down')
    if (!text.trim() || Buffer.byteLength(text) > 64 * 1024) throw new Error('Message must contain 1 to 65536 bytes')
    if (this.configuring.has(id)) throw new Error('Configuration is already being updated')
    if (this.read(id).thread.cliActive) throw Error('The native CLI already owns this conversation')
    const attachments = attachmentIds.length ? await this.resolveAttachments(id, attachmentIds) : []
    if (this.busy.has(id) || this.finalizing.has(id)) {
      const snapshot = this.read(id), adapter = this.adapters.get(id)
      const operation = this.history.beginOperation({ threadId: id, generation: snapshot.thread.generation ?? 1, kind: 'queue' })
      const item: ThreadQueuedInput = { id: randomUUID(), operationId: operation.id, text, attachmentIds,
        ...(attachments.length ? { attachments: attachments.map(({ path: _path, ...attachment }) => attachment) } : {}),
        configuration: { model: snapshot.thread.model, reasoningEffort: snapshot.thread.reasoningEffort, access: snapshot.thread.access ?? 'read-only', networkAccess: snapshot.thread.networkAccess ?? false, approvalPolicy: snapshot.thread.approvalPolicy ?? 'on-request', mode: snapshot.thread.mode ?? 'default', hooksEnabled: snapshot.thread.hooksEnabled ?? false },
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
    try {
      input = await this.commandService?.prepare(snapshot.thread, text) ?? input
      if (input.nativeCli) {
        throw Error('This command does not have an integrated Thread handler yet.')
      }
      if (snapshot.thread.cliNotice) throw Error(snapshot.thread.cliNotice)
      if (!input.text.trim() || Buffer.byteLength(input.text) > 64 * 1024) throw new Error('Skill prompt must contain 1 to 65536 bytes')
      await this.preflight?.(snapshot.thread)
      snapshot = this.read(id)
      if (this.stopping) throw new Error('Application is shutting down')
    } catch (error) { this.busy.delete(id); throw error }
    snapshot.thread.status = 'running'
    if (snapshot.thread.title === 'New thread' && !text.trim().startsWith('/')) snapshot.thread.title = text.trim().slice(0, 80)
    const turnId = randomUUID()
    const operation = this.history.beginOperation({ threadId: id, turnId, generation: snapshot.thread.generation ?? 1, kind: 'turn' })
    const eventsFrom = snapshot.events.length
    snapshot.events.push({ type: 'message', id: turnId, role: 'user', text, ...(attachments.length ? { attachments: attachments.map(({ path: _path, ...attachment }) => attachment) } : {}) })
    snapshot.turns ??= []
    snapshot.turns.push({ id: turnId, operationId: operation.id, sequence: snapshot.turns.length + 1, startedAt: Date.now(), status: 'running', configuration: { model: snapshot.thread.model, reasoningEffort: snapshot.thread.reasoningEffort, access: snapshot.thread.access ?? 'read-only', networkAccess: snapshot.thread.networkAccess ?? false, approvalPolicy: snapshot.thread.approvalPolicy ?? 'on-request', mode: snapshot.thread.mode ?? 'default', hooksEnabled: snapshot.thread.hooksEnabled ?? false }, ...(attachmentIds.length ? { attachmentIds: [...attachmentIds] } : {}) })
    this.save(snapshot, { eventsFrom, operationId: operation.id })
    try {
      // Publish the accepted prompt before repository snapshots or agent startup can block the UI.
      // Both reads must finish before the agent can modify files, but they are independent.
      const [checkpointId, baseline] = await Promise.all([
        this.checkpoints.begin({ threadId: id, turnId, rootPath: snapshot.thread.rootPath, label: text.trim().slice(0, 80) }).catch(() => undefined),
        this.workingState(snapshot.thread.rootPath)
      ])
      if (checkpointId) this.turnCheckpoints.set(turnId, checkpointId)
      if (baseline !== undefined) this.workingTreeBaselines.set(id, baseline)
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
      throw new Error(failure.code === 'session-busy' ? failure.message : 'Could not run thread agent; check Agent Settings')
    }
  }

  hasRunning(provider: ConversationThread['provider']): boolean {
    return [...this.busy].some(id => { try { return this.read(id).thread.provider === provider } catch { return false } })
  }
  async refreshAccounts(provider: ConversationThread['provider']): Promise<void> {
    for (const [id, adapter] of this.adapters) {
      if (this.busy.has(id)) continue
      try { if (this.read(id).thread.provider !== provider) continue } catch { /* deleted */ }
      this.adapters.delete(id); await adapter.dispose()
      try { const snapshot = this.read(id); snapshot.thread.connection = this.sessions.close(id); this.save(snapshot, { eventsFrom: snapshot.events.length }) } catch { /* deleted */ }
    }
  }

  async interrupt(id: string): Promise<void> {
    this.read(id)
    const adapter = this.adapters.get(id)
    if (!adapter) throw new Error('Thread has no live execution')
    await adapter.interrupt()
  }

  async approve(id: string, requestId: string, decision: 'accept' | 'decline'): Promise<void> {
    await this.respond(id, requestId, { decision })
  }

  async respond(id: string, requestId: string, response: ThreadRequestResponse): Promise<void> {
    const snapshot = this.read(id), generation = snapshot.thread.generation ?? 1
    const adapter = this.adapters.get(id)
    if (!adapter) throw new Error('Request has no live execution')
    if (adapter.respondRequest) await this.requests.resolve(id, requestId, generation, response)
    else await adapter.approve(requestId, response.decision === 'accept' || response.decision === 'acceptForSession' ? 'accept' : 'decline')
  }

  async steer(id: string, text: string, attachmentIds: string[] = []): Promise<void> {
    if (!text.trim() || Buffer.byteLength(text) > 64 * 1024) throw Error('Message must contain 1 to 65536 bytes')
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

  async updateQueued(id: string, itemId: string, text: string): Promise<void> {
    if (!text.trim() || Buffer.byteLength(text) > 64 * 1024) throw Error('Message must contain 1 to 65536 bytes')
    const snapshot = this.read(id), item = snapshot.thread.queue?.find(value => value.id === itemId)
    if (!item || item.state !== 'queued') throw Error('Queued input is unavailable')
    item.text = text
    const adapter = this.adapters.get(id)
    if (item.nativeId && adapter?.updateQueued) await adapter.updateQueued(item.nativeId, item, await this.resolveAttachments(id, item.attachmentIds ?? []))
    this.save(snapshot, { eventsFrom: snapshot.events.length })
  }

  async deleteQueued(id: string, itemId: string, preserveAttachments = false): Promise<void> {
    const snapshot = this.read(id), item = snapshot.thread.queue?.find(value => value.id === itemId)
    if (!item || item.state === 'sending') throw Error('Queued input is unavailable')
    const adapter = this.adapters.get(id)
    // An `unknown` item crossed a process boundary without an acknowledgement.
    // Never issue a second native mutation for it: removing it is an explicit
    // local dismissal, not proof that the provider did or did not receive it.
    if (item.state !== 'unknown' && item.nativeId && adapter?.deleteQueued) await adapter.deleteQueued(item.nativeId)
    snapshot.thread.queue = snapshot.thread.queue?.filter(value => value.id !== itemId)
    if (item.operationId) this.history.transitionOperation(id, item.operationId, 'cancelled', 'Queued input was removed locally.')
    this.save(snapshot, { eventsFrom: snapshot.events.length })
    if (!preserveAttachments) await this.releaseAttachments(id, item.attachmentIds ?? [])
  }

  async reorderQueued(id: string, itemIds: string[]): Promise<void> {
    const snapshot = this.read(id), queue = snapshot.thread.queue ?? []
    if (itemIds.length !== queue.length || new Set(itemIds).size !== itemIds.length) throw Error('Invalid queue order')
    const byId = new Map(queue.map(item => [item.id, item]))
    if (itemIds.some(itemId => !byId.has(itemId))) throw Error('Invalid queue order')
    snapshot.thread.queue = itemIds.map(itemId => byId.get(itemId)!)
    const nativeIds = snapshot.thread.queue.map(item => item.nativeId).filter((value): value is string => Boolean(value))
    const adapter = this.adapters.get(id)
    if (nativeIds.length === queue.length && adapter?.reorderQueued) await adapter.reorderQueued(nativeIds)
    this.save(snapshot, { eventsFrom: snapshot.events.length })
  }

  pin(id: string, pinned: boolean): void {
    const snapshot = this.read(id)
    snapshot.thread.pinned = pinned
    this.save(snapshot, { eventsFrom: snapshot.events.length })
  }

  commands(id: string, forceRefresh = false): Promise<ThreadCommandCatalog> {
    return this.commandService?.list(this.read(id).thread, forceRefresh) ?? Promise.resolve({ commands: [] })
  }

  openCli(id: string, command?: string): Promise<import('../../../../shared/types/thread').ThreadCliState> {
    if (this.stopping) return Promise.reject(Error('Application is shutting down'))
    const pending = this.cliStarting.get(id)
    if (pending) return command ? Promise.reject(Error('Native CLI is already starting')) : pending
    const current = this.cliSessions.get(id)
    if (current?.state().running) return command ? Promise.reject(Error('Use the native CLI input while it is open')) : Promise.resolve(current.state())
    if (this.busy.has(id)) return Promise.reject(Error('Finish or stop the active turn before opening the native CLI'))
    if ([...this.cliSessions.values()].filter(session => session.state().running).length + this.cliStarting.size >= 8) return Promise.reject(Error('Close a native CLI session before opening another'))
    const snapshot = this.read(id)
    if (!this.nativeCli) return Promise.reject(Error('Native CLI support is unavailable. Restart the updated application.'))
    this.assertNativeSessionAvailable(id, snapshot.thread.provider, snapshot.thread.nativeSessionId)
    this.busy.add(id)
    const task = (async () => {
      try {
        if (!/^\/(login|logout)(?:\s|$)/.test(command ?? '')) await this.preflight?.(snapshot.thread)
        if (this.stopping) throw Error('Application is shutting down')
        const old = this.adapters.get(id)
        this.adapters.delete(id); await old?.dispose()
        await current?.close()
        // Read again after account discovery: never restore stale pane/root metadata.
        const thread = this.read(id).thread
        let ended = false
        const session = await this.nativeCli!.open(thread, command, async (nativeSessionId, interrupted) => {
          ended = true
          try {
            let latest = this.read(id)
            let eventsFrom = latest.events.length
            if (nativeSessionId && !this.stopping) {
              try {
                const history = await this.nativeCli!.read(thread, nativeSessionId)
                latest = this.read(id)
                latest.events = history.events
                eventsFrom = 0
                if (history.title) latest.thread.title = history.title
                latest.thread.cliNotice = history.truncated ? 'Showing the recent part of this native session. Its complete history remains available in the provider CLI.' : undefined
                latest.thread.nativeSessionId = nativeSessionId
              } catch (error) {
                latest = this.read(id)
                eventsFrom = latest.events.length
                latest.thread.cliNotice = 'Native history could not be imported. Use the CLI to resume or link a saved session before continuing.'
                // A generated ID with no persisted history must never be resumed.
                if (!thread.nativeSessionId) {
                  latest.thread.nativeSessionId = null
                  if ((error as NodeJS.ErrnoException).code === 'ENOENT') latest.thread.cliNotice = undefined
                }
              }
            }
            latest.thread.cliActive = false
            latest.thread.status = this.stopping || interrupted ? 'interrupted' : 'idle'
            this.save(latest, { eventsFrom })
          } catch { /* workspace removed */ }
          finally { this.busy.delete(id) }
        })
        this.cliSessions.set(id, session)
        if (this.stopping) { await session.close(); throw Error('Application is shutting down') }
        const latest = this.read(id)
        latest.thread.cliActive = !ended && session.state().running
        if (latest.thread.cliActive && session.state().nativeSessionId) latest.thread.nativeSessionId = session.state().nativeSessionId
        if (latest.thread.cliActive) latest.thread.status = 'idle'
        this.save(latest, { eventsFrom: latest.events.length })
        return session.state()
      } catch (error) {
        this.busy.delete(id)
        const failed = this.cliSessions.get(id)
        this.cliSessions.delete(id)
        await failed?.close().catch(() => {})
        throw error
      }
    })().finally(() => this.cliStarting.delete(id))
    this.cliStarting.set(id, task)
    return task
  }

  cli(id: string): NativeCliSession | undefined { this.read(id); return this.cliSessions.get(id) }

  async linkCliSession(id: string, nativeSessionId: string): Promise<void> {
    if (this.stopping) throw Error('Application is shutting down')
    const session = this.cli(id)
    if (!session || !this.nativeCli) throw Error('Open the native CLI before linking a saved session')
    this.assertNativeSessionAvailable(id, this.read(id).thread.provider, nativeSessionId)
    await session.linkSession(nativeSessionId)
    if (session.state().running) return // the native exit imports this selected ID
    await session.close() // wait for an already pending exit import
    if (this.cliSessions.get(id) !== session || this.busy.has(id)) throw Error('Finish the active session before linking native history')
    this.busy.add(id)
    try {
      const history = await this.nativeCli.read(this.read(id).thread, nativeSessionId)
      if (this.stopping) throw Error('Application is shutting down')
      const old = this.adapters.get(id)
      this.adapters.delete(id); await old?.dispose()
      const latest = this.read(id)
      latest.events = history.events
      latest.thread.nativeSessionId = nativeSessionId
      latest.thread.cliNotice = history.truncated ? 'Showing the recent part of this native session. Its complete history remains available in the provider CLI.' : undefined
      if (history.title) latest.thread.title = history.title
      this.save(latest)
    } finally { this.busy.delete(id) }
  }

  models(id: string, refresh = false): Promise<ThreadModelCatalog> {
    if (!this.modelService) return Promise.reject(Error('Model discovery is unavailable. Restart the updated application.'))
    return this.modelService.list(this.read(id).thread, refresh)
  }

  async configure(id: string, input: ThreadConfiguration, revision: number): Promise<ThreadSnapshot> {
    if (this.stopping || this.configuring.has(id)) throw Error('Configuration is already being updated')
    this.configuring.add(id)
    try {
      let snapshot = this.read(id)
      if (snapshot.thread.cliActive || snapshot.thread.cliNotice) throw Error('Recover this conversation before changing its configuration')
      if ((snapshot.thread.configurationRevision ?? 0) !== revision) throw Error('Configuration changed. Refresh this conversation and try again.')
      const previous = snapshot.thread.pendingConfiguration ?? snapshot.thread
      const configuration: ThreadConfiguration = { model: input.model ?? previous.model, reasoningEffort: input.reasoningEffort ?? previous.reasoningEffort, access: input.access ?? previous.access ?? 'read-only', networkAccess: input.networkAccess ?? previous.networkAccess ?? false, approvalPolicy: input.approvalPolicy ?? previous.approvalPolicy ?? 'on-request', mode: input.mode ?? previous.mode ?? 'default', hooksEnabled: input.hooksEnabled ?? previous.hooksEnabled ?? false }
      if (configuration.access === 'read-only') configuration.hooksEnabled = false
      if (input.model || input.reasoningEffort !== undefined) {
        const catalog = await this.models(id)
        configuration.model ??= catalog.defaultModel
        const model = catalog.models.find(model => model.id === configuration.model)
        if (!model) throw Error('Select an available model')
        if (input.reasoningEffort && !model.efforts.includes(input.reasoningEffort)) throw Error('This reasoning effort is not supported by the selected model')
        if (!configuration.reasoningEffort || !model.efforts.includes(configuration.reasoningEffort)) configuration.reasoningEffort = model.defaultEffort
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
      return snapshot
    } finally { this.configuring.delete(id) }
  }

  async recover(id: string): Promise<void> {
    if (this.cliSessions.has(id) || this.cliStarting.has(id)) await this.stopCli(id)
    if (this.busy.has(id) || this.configuring.has(id)) throw Error('Finish the active operation before recovery')
    this.configuring.add(id)
    try {
      const snapshot = this.read(id)
      if (snapshot.thread.nativeSessionId && this.nativeCli) {
        const history = await this.nativeCli.read(snapshot.thread, snapshot.thread.nativeSessionId)
        snapshot.events = history.events
        if (history.title) snapshot.thread.title = history.title
        snapshot.thread.cliNotice = history.truncated ? 'Showing the recent part of this native session. Its complete history remains available in the provider CLI.' : undefined
      }
      snapshot.thread.cliActive = false
      snapshot.thread.status = 'idle'
      this.save(snapshot)
    } finally { this.configuring.delete(id) }
  }

  async command(id: string, text: string): Promise<ThreadCommandResult> {
    const match = text.trim().match(/^\/([a-z0-9][a-z0-9_:-]*)(?:\s+([\s\S]*))?$/i)
    if (!match || text.length > 65536) throw Error('Invalid command')
    let name = match[1].toLowerCase()
    const argument = match[2]?.trim() ?? '', snapshot = this.read(id), thread = snapshot.thread
    const aliases: Record<string, string> = { delegation: 'delegations', approvals: 'permissions', 'allowed-tools': 'permissions', name: 'rename', clear: 'new', reset: 'new', cwd: 'pwd', plugin: 'plugins', config: 'settings', login: 'accounts', exit: 'quit' }
    name = aliases[name] ?? name
    if (!hasDesktopCommand(thread.provider, name)) throw Error(`/${name} is not available in Thread yet. Use /help to see supported commands.`)
    if (argument && ['help', 'skills', 'accounts', 'settings', 'pwd', 'status', 'capabilities', 'copy', 'export', 'stop', 'new', 'quit', 'diff', 'usage', 'fork', 'hooks', 'experimental', 'debug-config', 'ps', 'memories'].includes(name)) throw Error(`/${name} does not accept arguments in Thread.`)
    if (name === 'delegations' && argument && !/^[a-z0-9-]{8,128}$/i.test(argument)) throw Error('Use /delegation <taskId> with an exact delegation ID.')
    if (name === 'resume' && argument) {
      const local = this.db.prepare('SELECT id FROM conversation_threads WHERE id = ?').get(argument) as { id: string } | undefined
      if (local) {
        const target = this.read(local.id)
        if (target.thread.provider !== thread.provider || target.thread.rootPath !== thread.rootPath) throw Error('Choose a conversation from this provider and project')
        if (target.thread.archived) { target.thread.archived = false; this.save(target, { eventsFrom: target.events.length }) }
        return { kind: 'navigate', threadId: target.thread.id }
      }
      if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(argument)) throw Error('Use a saved OXESpace conversation ID or an exact native session UUID.')
      for (const row of this.db.prepare('SELECT data_json FROM conversation_threads').all() as { data_json: string }[]) {
        const existing = JSON.parse(row.data_json) as ConversationThread
        if (existing.nativeSessionId !== argument) continue
        if (existing.provider !== thread.provider || existing.rootPath !== thread.rootPath) throw Error('Native session is linked to a different provider or project')
        if (existing.archived) { const restored = this.read(existing.id); restored.thread.archived = false; this.save(restored, { eventsFrom: restored.events.length }) }
        return { kind: 'navigate', threadId: existing.id }
      }
      if (!this.nativeCli) throw Error('Native session import is unavailable')
      this.assertNativeSessionAvailable(id, thread.provider, argument)
      const history = await this.nativeCli.read(thread, argument)
      const imported = this.create({ workspaceId: thread.workspaceId, projectId: thread.projectId, rootPath: thread.rootPath, provider: thread.provider, agentProfileId: thread.agentProfileId })
      imported.thread.nativeSessionId = argument
      imported.thread.title = history.title || `Recovered ${thread.provider} session`
      imported.events = history.events
      imported.thread.cliNotice = history.truncated ? 'Showing the recent part of this native session. Its complete history remains available in the provider CLI.' : undefined
      this.save(imported, { eventsFrom: 0 })
      return { kind: 'navigate', threadId: imported.thread.id }
    }
    const surfaces: Record<string, NonNullable<ThreadCommandResult['surface']>> = { help: 'commands', skills: 'commands', accounts: 'accounts', logout: 'accounts', settings: 'settings', resume: 'sessions', delegations: 'delegations' }
    if (surfaces[name]) return { kind: 'panel', surface: surfaces[name], title: name, ...(name === 'delegations' && argument ? { text: argument } : {}) }
    if (['model', 'effort', 'permissions'].includes(name)) {
      if (!argument) return { kind: 'panel', surface: name as 'model' | 'effort' | 'permissions' }
      const [model, effort, extra] = argument.split(/\s+/)
      if (extra || name !== 'model' && effort) throw Error('Too many command arguments')
      if (name === 'permissions' && !['read-only', 'workspace-write', 'full-access'].includes(model)) throw Error('Choose read-only, workspace-write or full-access')
      await this.configure(id, name === 'model' ? { model, ...(effort ? { reasoningEffort: effort } : {}) } : name === 'effort' ? { reasoningEffort: model } : { access: model as ThreadConfiguration['access'] }, thread.configurationRevision ?? 0)
      return { kind: 'applied' }
    }
    if (name === 'plan') {
      if (argument && !['on', 'off'].includes(argument)) throw Error('Use /plan on or /plan off')
      await this.configure(id, { mode: argument === 'off' ? 'default' : 'plan' }, thread.configurationRevision ?? 0); return { kind: 'applied' }
    }
    if (name === 'pwd') return { kind: 'panel', title: 'Project directory', text: thread.rootPath }
    if (name === 'status') {
      const operation = this.history.operations(id).at(-1)
      return { kind: 'panel', title: 'Conversation status', rows: [
      { label: 'Thread ID', detail: thread.id }, { label: 'Project ID', detail: thread.projectId }, { label: 'Workspace ID', detail: thread.workspaceId },
      { label: 'Provider', detail: thread.provider }, { label: 'Status', detail: thread.status }, { label: 'Model', detail: thread.model || 'Provider default' }, { label: 'Effort', detail: thread.reasoningEffort || 'Automatic' },
      { label: 'Access', detail: thread.access ?? 'read-only' }, { label: 'Network', detail: thread.networkAccess ? 'allowed' : 'blocked' }, { label: 'Approvals', detail: thread.approvalPolicy ?? 'on-request' }, { label: 'Mode', detail: thread.mode ?? 'default' }, { label: 'Hooks', detail: thread.hooksEnabled ? 'native hooks enabled' : 'disabled' },
      { label: 'Connection', detail: thread.connection?.state ?? 'closed' }, { label: 'Generation', detail: String(thread.generation ?? 1) },
      { label: 'Operation', detail: operation ? `${operation.id} · ${operation.state}` : 'None' },
      { label: 'Directory', detail: thread.rootPath }, { label: 'Native session ID (resume)', detail: thread.nativeSessionId ?? 'Not started' }
    ] }
    }
    if (name === 'capabilities') {
      const manifest = thread.capabilities ?? threadCapabilityManifest(thread.provider, this.adapters.get(id)?.capabilities)
      return { kind: 'panel', title: 'Thread capabilities', rows: Object.entries(manifest.features).map(([label, value]) => ({ label, detail: value.implemented ? `${value.verified} · ${value.enabled ? 'enabled' : 'disabled'}` : value.reason ?? 'Unavailable' })) }
    }
    if (name === 'copy' || name === 'export') return { kind: 'panel', title: name === 'copy' ? 'Copy response' : 'Export conversation', text: name === 'copy'
      ? snapshot.events.filter(event => event.type === 'message' && event.role === 'assistant').map(event => event.type === 'message' ? event.text : '').at(-1) ?? ''
      : this.exports.markdown(snapshot) }
    if (name === 'stop') { if (this.busy.has(id)) await this.interrupt(id); return { kind: 'applied' } }
    if ((name === 'archive' || name === 'delete') && argument === 'confirm' && this.busy.has(id)) {
      await this.interrupt(id)
      for (let attempt = 0; attempt < 50 && this.busy.has(id); attempt++) await new Promise(resolve => setTimeout(resolve, 100))
      if (this.busy.has(id)) throw Error('The active turn has not stopped. Try again after it finishes.')
    }
    if (this.busy.has(id) || this.configuring.has(id)) throw Error('Finish the active operation before running this command')
    if (name === 'rename') {
      if (!argument) return { kind: 'panel', surface: 'rename', title: 'Rename conversation' }
      if (thread.provider === 'codex' && thread.nativeSessionId) await (await this.connectAdapter(id, thread)).command?.('rename', argument.slice(0, 120))
      const latest = this.read(id); latest.thread.title = argument.slice(0, 120); this.save(latest, { eventsFrom: latest.events.length }); return { kind: 'applied' }
    }
    if (name === 'new') {
      const created = this.create({ workspaceId: thread.workspaceId, projectId: thread.projectId, rootPath: thread.rootPath, provider: thread.provider })
      Object.assign(created.thread, { model: thread.model, reasoningEffort: thread.reasoningEffort, access: thread.access, networkAccess: thread.networkAccess, approvalPolicy: thread.approvalPolicy, mode: thread.mode, hooksEnabled: thread.hooksEnabled })
      this.save(created, { eventsFrom: created.events.length }); return { kind: 'navigate', threadId: created.thread.id }
    }
    if (name === 'archive' || name === 'delete') {
      if (argument !== 'confirm') return { kind: 'panel', title: name === 'delete' ? 'Delete conversation' : 'Archive conversation', text: name === 'delete' ? 'Delete this OXESpace conversation? The provider session is retained.' : 'Archive this conversation? You can reopen it from /resume.', rows: [{ id: `/${name} confirm`, label: name === 'delete' ? 'Delete conversation' : 'Archive conversation' }] }
      const adapter = this.adapters.get(id)
      this.adapters.delete(id); await adapter?.dispose()
      if (name === 'delete') { this.db.prepare('DELETE FROM conversation_threads WHERE id = ?').run(id); this.snapshots.delete(id); await this.attachmentStore?.removeThread(id); this.changed(id) }
      else { const latest = this.read(id); latest.thread.archived = true; this.save(latest, { eventsFrom: latest.events.length }) }
      return { kind: 'navigate' }
    }
    if (name === 'quit') { const adapter = this.adapters.get(id); this.adapters.delete(id); await adapter?.dispose(); return { kind: 'applied' } }
    if (name === 'diff') {
      return { kind: 'panel', title: 'Project changes', surface: 'changes' }
    }
    if (name === 'checkpoint') {
      const [action = 'list', checkpointId, extra] = argument.split(/\s+/).filter(Boolean)
      if (extra || !['list', 'restore', 'delete'].includes(action) || action !== 'list' && !checkpointId) throw Error('Use /checkpoint, /checkpoint restore <id>, or /checkpoint delete <id>')
      if (action === 'restore') {
        const restored = await this.checkpoints.restore(id, checkpointId)
        return { kind: 'panel', title: 'Checkpoint restored', text: `${restored.fileCount} file${restored.fileCount === 1 ? '' : 's'} restored. Conversation history was not rewound.` }
      }
      if (action === 'delete') { this.checkpoints.delete(id, checkpointId); return { kind: 'applied', title: 'Checkpoint deleted' } }
      const rows = this.checkpoints.list(id).map(value => ({ id: value.state === 'ready' || value.state === 'conflict' ? `/checkpoint restore ${value.id}` : undefined, label: value.label, detail: `${value.state} · ${value.fileCount} file${value.fileCount === 1 ? '' : 's'} · ${new Date(value.createdAt).toLocaleString()}${value.error ? ` · ${value.error}` : ''}` }))
      return { kind: 'panel', title: 'File checkpoints', text: 'Restore changes files only. Conversation history, Git index and unrelated dirty files are preserved.', rows }
    }
    if (['review', 'compact'].includes(name)) { await this.send(id, text); return { kind: 'applied' } }
    if (name === 'rewind' && argument && !/^[1-9][0-9]{0,2}$/.test(argument)) throw Error('Specify the number of turns to rewind (1–999)')
    if (name === 'rewind' && !argument) return { kind: 'panel', title: 'Rewind conversation', text: 'Remove the most recent turn from the native conversation. Files are not reverted.', rows: [{ id: '/rewind 1', label: 'Rewind one turn' }] }
    // Reserve ownership while starting/querying a provider operation.
    this.configuring.add(id)
    try {
      const adapter = await this.connectAdapter(id, thread)
      if (!adapter.command) throw Error('This provider does not expose the requested operation')
      const result = await adapter.command(name, argument)
      if (name === 'fork' && result.threadId) {
        const fork = this.create({ workspaceId: thread.workspaceId, projectId: thread.projectId, rootPath: thread.rootPath, provider: thread.provider })
        fork.thread = { ...fork.thread, nativeSessionId: result.threadId, model: thread.model, reasoningEffort: thread.reasoningEffort, access: thread.access, networkAccess: thread.networkAccess, approvalPolicy: thread.approvalPolicy, mode: thread.mode, hooksEnabled: thread.hooksEnabled, title: `${thread.title} · fork` }
        fork.events = this.read(id).events; this.save(fork)
        return { kind: 'navigate', threadId: fork.thread.id }
      }
      if (name === 'rewind' && this.nativeCli) {
        const current = this.read(id)
        if (current.thread.nativeSessionId) { current.events = (await this.nativeCli.read(current.thread, current.thread.nativeSessionId)).events; this.save(current) }
      }
      return result
    } finally { this.configuring.delete(id) }
  }

  async stopCli(id: string): Promise<void> {
    this.read(id)
    if (this.cliStarting.has(id)) await this.cliStarting.get(id)
    const session = this.cliSessions.get(id)
    await session?.close()
    if (this.cliSessions.get(id) === session) this.cliSessions.delete(id)
  }

  async stop(): Promise<void> {
    for (const id of this.deltaBuffers.keys()) this.flushDeltas(id)
    this.stopping = true
    await Promise.resolve() // let already scheduled turn finalizers register before closing the database
    await Promise.allSettled([...this.finalizationTasks])
    await Promise.allSettled([...this.cliStarting.values()])
    await Promise.allSettled([...this.cliSessions.values()].map(session => session.close()))
    this.cliSessions.clear()
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
    this.workingTreeBaselines.clear()
    this.turnCheckpoints.clear()
    for (const id of this.adapters.keys()) {
      try { const snapshot = this.read(id); snapshot.thread.connection = this.sessions.close(id); this.save(snapshot, { eventsFrom: snapshot.events.length }) } catch { /* deleted */ }
    }
    await Promise.allSettled([...this.adapters.values()].map(adapter => adapter.dispose()))
    this.adapters.clear()
    for (const row of this.db.prepare('SELECT id FROM conversation_threads').all() as { id: string }[]) this.requests.invalidate(row.id)
  }

  private event(id: string, event: ThreadEvent, generation?: number): void {
    if (this.stopping) return
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

  private flushDeltas(id: string): void {
    const buffer = this.deltaBuffers.get(id)
    if (!buffer) return
    this.deltaBuffers.delete(id)
    clearTimeout(this.deltaTimers.get(id)); this.deltaTimers.delete(id)
    for (const [messageId, delta] of buffer) this.applyEvent(id, { type: 'delta', id: messageId, text: delta.text }, delta.generation)
  }

  private applyEvent(id: string, event: ThreadEvent, generation?: number): void {
    if (this.stopping) return
    let snapshot: ThreadSnapshot
    try { snapshot = this.read(id) } catch {
      this.busy.delete(id)
      const adapter = this.adapters.get(id)
      this.adapters.delete(id)
      void adapter?.dispose().catch(() => {})
      return
    }
    if (generation !== undefined && generation !== (snapshot.thread.generation ?? 1)) return
    const activeTurn = snapshot.turns?.at(-1)
    const operationId = activeTurn?.operationId
    let eventsFrom = snapshot.events.length
    if (snapshot.thread.connection?.state === 'connected') snapshot.thread.connection = this.sessions.heartbeat(id)
    if (event.type === 'request') {
      const adapter = this.adapters.get(id)
      event.request.generation = snapshot.thread.generation ?? 1
      if (adapter?.respondRequest) this.requests.register(id, event.request, response => adapter.respondRequest!(event.id, response))
    } else if (event.type === 'request-resolved' && event.state !== 'pending') {
      this.requests.settle(id, event.id, event.state)
      const requestIndex = snapshot.events.findIndex(value => value.type === 'request' && value.id === event.id)
      const request = requestIndex >= 0 ? snapshot.events[requestIndex] : undefined
      if (request?.type === 'request') request.request.state = event.state
      if (requestIndex >= 0) eventsFrom = Math.min(eventsFrom, requestIndex)
    }
    if (activeTurn?.status === 'running' && (event.type === 'tool' || event.type === 'subagent' || event.type === 'turn-diff' || event.type === 'plan') && event.turnId) activeTurn.nativeId = event.turnId
    if (event.type === 'failure-details') {
      const completedIndex = snapshot.events.findIndex(value => value.type === 'completed' && value.failure?.id === event.id)
      const completed = completedIndex >= 0 ? snapshot.events[completedIndex] : undefined
      if (completed?.type !== 'completed' || !completed.failure) return
      completed.failure = { ...completed.failure, ...(event.usage ? { usage: event.usage } : {}), usageUnavailable: event.usageUnavailable }
      eventsFrom = Math.min(eventsFrom, completedIndex)
    }
    else if (event.type === 'configuration') {
      if (event.model !== undefined) snapshot.thread.model = event.model
      if (event.reasoningEffort !== undefined) snapshot.thread.reasoningEffort = event.reasoningEffort
      if (event.access !== undefined) snapshot.thread.access = event.access
      if (event.networkAccess !== undefined) snapshot.thread.networkAccess = event.networkAccess
      if (event.approvalPolicy !== undefined) snapshot.thread.approvalPolicy = event.approvalPolicy
      if (event.hooksEnabled !== undefined) snapshot.thread.hooksEnabled = event.hooksEnabled
      if (activeTurn?.status === 'running') Object.assign(activeTurn.configuration, { ...(event.model !== undefined ? { model: event.model } : {}), ...(event.reasoningEffort !== undefined ? { reasoningEffort: event.reasoningEffort } : {}), ...(event.access !== undefined ? { access: event.access } : {}), ...(event.networkAccess !== undefined ? { networkAccess: event.networkAccess } : {}), ...(event.approvalPolicy !== undefined ? { approvalPolicy: event.approvalPolicy } : {}), ...(event.hooksEnabled !== undefined ? { hooksEnabled: event.hooksEnabled } : {}) })
    }
    else if (event.type === 'session') snapshot.thread.nativeSessionId = event.nativeSessionId
    else if (event.type === 'completed') {
      const turn = snapshot.turns?.at(-1)
      if (turn?.status === 'running') { turn.status = event.status; turn.completedAt = Date.now() }
      snapshot.events.forEach((value, index) => {
        if (value.type === 'turn-diff' && value.turnId === turn?.nativeId) {
          value.files = value.files.map(file => ({ ...file, state: event.status === 'completed' ? 'completed' : 'failed' }))
          eventsFrom = Math.min(eventsFrom, index)
        }
      })
      snapshot.thread.status = event.status === 'completed' ? 'idle' : event.status
      this.busy.delete(id)
      // Native patch notifications may omit files changed by shell commands.
      // Compare against the pre-turn working tree for both providers, while
      // keeping provider patches authoritative for paths they already report.
      const needsVerifiedDiff = this.workingTreeBaselines.has(id)
      const needsCheckpoint = Boolean(turn && this.turnCheckpoints.has(turn.id))
      if (needsVerifiedDiff || needsCheckpoint) this.finalizing.add(id)
      for (const request of this.requests.invalidate(id, event.status === 'completed' ? 'expired' : 'cancelled')) {
        const requestIndex = snapshot.events.findIndex(value => value.type === 'request' && value.id === request.id)
        const persisted = requestIndex >= 0 ? snapshot.events[requestIndex] : undefined
        if (persisted?.type === 'request') persisted.request.state = request.state
        if (requestIndex >= 0) eventsFrom = Math.min(eventsFrom, requestIndex)
        snapshot.events.push({ type: 'request-resolved', id: request.id, state: request.state })
      }
      const unresolved = snapshot.events.filter(value => value.type === 'approval' && !snapshot.events.some(resolved => resolved.type === 'approval-resolved' && resolved.id === value.id))
      for (const approval of unresolved) if (approval.type === 'approval') snapshot.events.push({ type: 'approval-resolved', id: approval.id })
      snapshot.events.push(event)
      if (operationId) this.history.transitionOperation(id, operationId, event.status === 'completed' ? 'completed' : event.status === 'interrupted' ? 'cancelled' : 'failed', event.error)
      if (event.status === 'completed' && turn?.attachmentIds?.length) void this.releaseAttachments(id, turn.attachmentIds)
      if (needsVerifiedDiff || needsCheckpoint) queueMicrotask(() => {
        const task = this.finalizeTurnThenDrain(id, event.status, turn?.id, needsVerifiedDiff)
        this.finalizationTasks.add(task)
        void task.finally(() => this.finalizationTasks.delete(task)).catch(() => {})
      })
      else queueMicrotask(() => void this.drainQueue(id))
    } else if (event.type === 'delta') {
      const existingIndex = snapshot.events.findIndex(value => value.type === 'message' && value.role === 'assistant' && value.id === event.id)
      const existing = existingIndex >= 0 ? snapshot.events[existingIndex] : undefined
      if (existing?.type === 'message') existing.text = (existing.text + event.text).slice(0, 256 * 1024)
      else snapshot.events.push({ type: 'message', id: event.id, role: 'assistant', text: event.text.slice(0, 256 * 1024) })
      eventsFrom = existingIndex >= 0 ? Math.min(eventsFrom, existingIndex) : eventsFrom
    } else {
      if (event.type === 'approval' || event.type === 'request') snapshot.thread.status = 'approval'
      const index = snapshot.events.findIndex(value => 'id' in value && value.id === event.id && value.type === event.type)
      if (index >= 0) {
        const previous = snapshot.events[index]
        snapshot.events[index] = event.type === 'tool' && previous.type === 'tool' ? { ...previous, ...event, name: event.name === 'Tool result' ? previous.name : event.name, detail: event.detail || previous.detail } : event
        eventsFrom = Math.min(eventsFrom, index)
      }
      else snapshot.events.push(event)
      if (event.type === 'approval-resolved' || event.type === 'request-resolved') snapshot.thread.status = this.requests.list(id, snapshot.thread.generation ?? 1).length ? 'approval' : 'running'
    }
    if (operationId && event.type !== 'completed' && event.type !== 'session' && event.type !== 'configuration') this.history.transitionOperation(id, operationId, 'running')
    this.save(snapshot, { eventsFrom, ...(operationId ? { operationId } : {}) })
  }

  private save(snapshot: ThreadSnapshot, options?: ThreadHistoryWriteOptions): void {
    snapshot.thread.updatedAt = Date.now()
    if (!options) this.history.rewriteHistory(snapshot)
    else if (options.eventsFrom === snapshot.events.length && !options.operationId) this.history.updateThreadMetadata(snapshot.thread)
    else this.history.persistFrom(snapshot, options.eventsFrom ?? 0, options.operationId)
    this.snapshots.set(snapshot.thread.id, snapshot)
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

  private async workingState(rootPath: string): Promise<{ patch: string; untracked: Set<string> } | undefined> {
    const run = (args: string[]) => new Promise<string>((resolve, reject) => {
      const child = execFile('git', args, { cwd: rootPath, windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout: 15000 }, (error, stdout) => error ? reject(error) : resolve(stdout))
      child.stdin?.end()
    })
    try {
      const [patch, status] = await Promise.all([
        run(['--no-pager', 'diff', '--no-ext-diff', '--no-textconv', '--binary', 'HEAD', '--']),
        run(['status', '--porcelain=v1', '-z', '--untracked-files=all'])
      ])
      const untracked = new Set(status.split('\0').flatMap(entry => entry.startsWith('?? ') ? [entry.slice(3)] : []))
      return { patch, untracked }
    } catch { return undefined }
  }

  private async captureWorkingTreeDiff(id: string, status: 'completed' | 'interrupted' | 'failed', turnId?: string): Promise<void> {
    const before = this.workingTreeBaselines.get(id)
    this.workingTreeBaselines.delete(id)
    try {
      const snapshot = this.read(id)
      if (before !== undefined) {
        const after = await this.workingState(snapshot.thread.rootPath)
        if (after !== undefined && (after.patch !== before.patch || [...after.untracked].some(path => !before.untracked.has(path)))) {
          const turnStart = snapshot.events.findIndex(event => event.type === 'message' && event.id === turnId)
          const reportedPaths = new Set(snapshot.events.slice(Math.max(0, turnStart)).flatMap(event => event.type === 'turn-diff' && event.id.startsWith('turn-diff:') ? event.files.map(file => file.path.replace(/\\/g, '/').toLowerCase()) : []))
          const previous = new Map(splitThreadPatch(before.patch).map(file => [file.path, file.patch]))
          const files: import('../../../../shared/types/thread').ThreadFileChange[] = splitThreadPatch(after.patch)
            .filter(file => previous.get(file.path) !== file.patch && !reportedPaths.has(file.path.replace(/\\/g, '/').toLowerCase()))
            .map(file => ({ ...file, source: 'working-tree-observation', authorship: 'indeterminate', state: status === 'completed' ? 'completed' as const : 'failed' as const }))
          for (const path of after.untracked) if (!before.untracked.has(path) && !reportedPaths.has(path.replace(/\\/g, '/').toLowerCase())) files.push({ path, kind: 'add', source: 'working-tree-observation', authorship: 'indeterminate', state: status === 'completed' ? 'completed' : 'failed' })
          if (files.length) this.event(id, { type: 'turn-diff', id: `verified-diff:${turnId ?? randomUUID()}`, turnId: turnId ?? '', files })
        }
      }
    } catch { /* Repository may have been removed after the turn. */ }
  }

  private async finalizeTurnThenDrain(id: string, status: 'completed' | 'interrupted' | 'failed', turnId: string | undefined, captureDiff: boolean): Promise<void> {
    try {
      if (captureDiff) await this.captureWorkingTreeDiff(id, status, turnId)
      const checkpointId = turnId ? this.turnCheckpoints.get(turnId) : undefined
      if (checkpointId) await this.checkpoints.finalize(checkpointId)
    } finally {
      if (turnId) this.turnCheckpoints.delete(turnId)
      this.finalizing.delete(id)
      await this.drainQueue(id)
    }
  }

  private async connectAdapter(id: string, thread: ConversationThread, runPreflight = true): Promise<AgentConversationAdapter> {
    const existing = this.adapters.get(id)
    if (existing) return existing
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
      const latest = this.read(id)
      latest.thread.capabilities = threadCapabilityManifest(latest.thread.provider, adapter.capabilities, false, adapter.evidence)
      this.save(latest, { eventsFrom: latest.events.length })
      const owned = adapter, generation = latest.thread.generation ?? 1
      await adapter.start({ rootPath: latest.thread.rootPath, nativeSessionId: latest.thread.nativeSessionId, model: latest.thread.model, reasoningEffort: latest.thread.reasoningEffort, access: latest.thread.access, networkAccess: latest.thread.networkAccess ?? false, approvalPolicy: latest.thread.approvalPolicy ?? 'on-request', mode: latest.thread.mode, hooksEnabled: latest.thread.hooksEnabled ?? false }, event => { if (this.adapters.get(id) === owned) this.event(id, event, generation) })
      const connected = this.read(id)
      connected.thread.capabilities = threadCapabilityManifest(connected.thread.provider, adapter.capabilities, true, adapter.evidence)
      connected.thread.connection = this.sessions.connected(id)
      this.save(connected, { eventsFrom: connected.events.length })
      return adapter
    } catch (error) {
      if (adapter && this.adapters.get(id) === adapter) this.adapters.delete(id)
      await adapter?.dispose().catch(() => {})
      try {
        const degraded = this.read(id)
        degraded.thread.connection = this.sessions.failed(id, error instanceof Error ? error.message : 'Provider connection failed')
        this.save(degraded, { eventsFrom: degraded.events.length })
      } catch { /* Thread may have been deleted while the provider was starting. */ }
      throw error
    }
  }

  private async drainQueue(id: string): Promise<void> {
    if (this.stopping || this.busy.has(id) || this.finalizing.has(id) || this.configuring.has(id)) return
    let snapshot: ThreadSnapshot
    try { snapshot = this.read(id) } catch { return }
    const item = snapshot.thread.queue?.find(value => value.state === 'queued')
    if (!item) return
    item.state = 'sending'
    if (item.operationId) this.history.transitionOperation(id, item.operationId, 'sent')
    this.save(snapshot, { eventsFrom: snapshot.events.length })
    try {
      const adapter = this.adapters.get(id)
      if (item.nativeId && adapter?.startQueued) {
        const latest = this.read(id)
        latest.thread.queue = latest.thread.queue?.filter(value => value.id !== item.id)
        latest.thread.status = 'running'
        const attachments = await this.resolveAttachments(id, item.attachmentIds ?? [])
        latest.events.push({ type: 'message', id: item.id, role: 'user', text: item.text, ...(attachments.length ? { attachments: attachments.map(({ path: _path, ...attachment }) => attachment) } : {}) })
        latest.turns ??= []
        latest.turns.push({ id: item.id, ...(item.operationId ? { operationId: item.operationId } : {}), sequence: latest.turns.length + 1, startedAt: Date.now(), status: 'running', configuration: { model: latest.thread.model, reasoningEffort: latest.thread.reasoningEffort, access: latest.thread.access ?? 'read-only', networkAccess: latest.thread.networkAccess ?? false, approvalPolicy: latest.thread.approvalPolicy ?? 'on-request', mode: latest.thread.mode ?? 'default', hooksEnabled: latest.thread.hooksEnabled ?? false }, ...(item.attachmentIds?.length ? { attachmentIds: [...item.attachmentIds] } : {}) })
        const checkpointId = await this.checkpoints.begin({ threadId: id, turnId: item.id, rootPath: latest.thread.rootPath, label: item.text.trim().slice(0, 80) }).catch(() => undefined)
        if (checkpointId) this.turnCheckpoints.set(item.id, checkpointId)
        if (item.operationId) this.history.transitionOperation(id, item.operationId, 'running')
        this.busy.add(id); this.save(latest, { eventsFrom: latest.events.length - 1, ...(item.operationId ? { operationId: item.operationId } : {}) })
        await adapter.startQueued(item.nativeId)
      } else {
        const latest = this.read(id)
        latest.thread.queue = latest.thread.queue?.filter(value => value.id !== item.id)
        if (item.operationId) this.history.transitionOperation(id, item.operationId, 'completed')
        this.save(latest, { eventsFrom: latest.events.length })
        await this.send(id, item.text, item.attachmentIds ?? [])
      }
    } catch (error) {
      const latest = this.read(id)
      latest.thread.queue ??= []
      let failed = latest.thread.queue.find(value => value.id === item.id)
      if (!failed) { failed = { ...item }; latest.thread.queue.push(failed) }
      failed.state = 'failed'; failed.error = error instanceof Error ? error.message : 'Could not send queued input'
      if (failed.operationId) this.history.transitionOperation(id, failed.operationId, 'failed', failed.error)
      this.busy.delete(id); this.save(latest, { eventsFrom: latest.events.length })
    }
  }

  private assertNativeSessionAvailable(id: string, provider: ConversationThread['provider'], nativeSessionId: string | null): void {
    if (!nativeSessionId) return
    const owners = new Set([...this.adapters.keys(), ...this.cliSessions.keys()])
    for (const otherId of owners) {
      if (otherId === id) continue
      const cli = this.cliSessions.get(otherId)
      if (!this.adapters.has(otherId) && !cli?.state().running) continue
      try {
        const other = this.read(otherId).thread
        const activeNativeId = cli?.state().nativeSessionId ?? other.nativeSessionId
        if (other.provider === provider && activeNativeId === nativeSessionId) {
          throw Error('This native session is already open in another Thread conversation')
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes('already open')) throw error
        // Deleted local owners are ignored and cleaned up by their lifecycle.
      }
    }
  }
}
