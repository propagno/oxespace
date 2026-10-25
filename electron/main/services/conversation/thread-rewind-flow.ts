import type { AppDatabase } from '../../db'
import type { AgentConversationAdapter, ConversationThread, ThreadAuditEntry, ThreadRewindResult, ThreadSnapshot } from '../../../../shared/types/thread'
import { forkClaudeBefore } from './claude-transcript-fork'
import type { ThreadCheckpointService } from './thread-checkpoints'
import type { ThreadHistoryWriteOptions } from './thread-history'
import { ThreadRewindError, planLocalRewind } from './thread-rewind'

/** What retry, rewind and redo need from the orchestrator, and nothing more. */
export interface RewindHost {
  db: AppDatabase
  checkpoints: ThreadCheckpointService
  isStopping(): boolean
  /** A turn is starting, running or finishing, or the thread is being reconfigured. */
  isActive(id: string): boolean
  isFinalizing(id: string): boolean
  /** Waits for every turn that is capturing its diff and checkpoint. */
  settleFinalization(): Promise<void>
  withConfiguring<T>(id: string, run: () => Promise<T>): Promise<T>
  read(id: string): ThreadSnapshot
  readForRenderer(id: string): ThreadSnapshot
  save(snapshot: ThreadSnapshot, options?: ThreadHistoryWriteOptions): void
  /** Writes the whole snapshot, events and turns included, and makes it the cached one. */
  replace(snapshot: ThreadSnapshot): void
  cancelOperation(id: string, operationId: string, reason: string): void
  changed(id: string): void
  audit(id: string, entry: Omit<ThreadAuditEntry, 'id' | 'at' | 'threadId' | 'projectRoot'>): void
  send(id: string, text: string, attachmentIds: string[]): Promise<void>
  connectAdapter(id: string, thread: ConversationThread): Promise<AgentConversationAdapter>
  disposeAdapter(id: string): Promise<void>
}

/**
 * Sends a turn's prompt again. With restoreFiles, the turn's file changes are undone first; a turn without a
 * usable checkpoint makes that refuse with the reason rather than send onto unknown files.
 */
export async function retryTurn(host: RewindHost, id: string, turnId: string, options: { restoreFiles?: boolean } = {}): Promise<{ restoredFiles: number }> {
  if (host.isStopping()) throw Error('Application is shutting down')
  if (host.isFinalizing(id)) await host.settleFinalization()
  if (host.isActive(id)) throw Error('Finish the active turn before retrying.')
  const snapshot = host.read(id)
  const turn = snapshot.turns?.find(value => value.id === turnId)
  if (!turn || turn.status === 'running') throw Error('This turn cannot be retried.')
  const prompt = snapshot.events.find(event => event.type === 'message' && event.role === 'user' && event.id === turnId)
  if (prompt?.type !== 'message') throw Error('The prompt of this turn is not available.')
  let restoredFiles = 0
  if (options.restoreFiles) {
    const checkpoints = host.checkpoints.list(id).filter(checkpoint => checkpoint.turnId === turnId)
    const restorable = checkpoints.filter(checkpoint => checkpoint.state === 'ready' || checkpoint.state === 'conflict')
    if (!restorable.length) {
      throw Error(checkpoints.length
        ? 'This turn\'s changes cannot be undone: its checkpoint did not complete. Retry without undoing, or undo the files yourself.'
        : 'This turn\'s changes cannot be undone: it has no checkpoint (it may have been removed after 30 days). Retry without undoing, or undo the files yourself.')
    }
    for (const checkpoint of restorable.sort((a, b) => b.createdAt - a.createdAt)) {
      if (checkpoint.fileCount === 0) continue
      await host.checkpoints.restore(id, checkpoint.id)
      restoredFiles += checkpoint.fileCount
    }
    host.audit(id, { action: 'undo-file', actor: 'user', summary: `Undid ${restoredFiles} file${restoredFiles === 1 ? '' : 's'} before retrying a turn` })
    host.changed(id)
  }
  await host.send(id, prompt.text, prompt.attachments?.map(attachment => attachment.id) ?? [])
  return { restoredFiles }
}

/**
 * Rewinds to just before a turn, as VS Code does: the later turns stay in the conversation, greyed, with a
 * Redo, and leave it only when the next message is sent. The provider's history is rewound at that moment
 * too (a Claude fork, a Codex revert), so a Redo never has to undo anything at the provider. When files are
 * restored, their current state is captured first, so Redo brings the files back as well.
 */
export async function rewind(host: RewindHost, id: string, turnId: string, options: { restoreFiles?: boolean } = {}): Promise<ThreadRewindResult> {
  if (host.isStopping()) throw Error('Application is shutting down')
  // A just-finished turn is still capturing its diff and checkpoint; that is a moment, not a refusal.
  if (host.isFinalizing(id)) await host.settleFinalization()
  if (host.isActive(id)) throw new ThreadRewindError('unavailable', 'Finish the active turn before rewinding.')
  const current = host.read(id)
  if (current.thread.cliActive) throw new ThreadRewindError('unavailable', 'The native CLI owns this conversation.')
  if (current.thread.status === 'approval') throw new ThreadRewindError('unavailable', 'Resolve the pending request before rewinding.')
  if (current.thread.queue?.some(item => item.state === 'sending')) throw new ThreadRewindError('unavailable', 'A queued message is being sent.')
  if (current.thread.rewind) throw new ThreadRewindError('unavailable', 'Redo the previous rewind, or send a message to confirm it, before rewinding again.')
  const plan = planLocalRewind(current, turnId)
  const target = plan.dropped[0]
  const claude = current.thread.provider === 'claude'
  // Checked now, so a rewind that cannot be applied at the provider is refused here rather than at send.
  if (!claude && !target.nativeId) throw new ThreadRewindError('unavailable', 'This turn has no provider identity, so it cannot be rewound safely.')
  if (claude && !current.thread.nativeSessionId) throw new ThreadRewindError('unavailable', 'This conversation has no Claude session to rewind yet.')
  return host.withConfiguring(id, async () => {
    const result: ThreadRewindResult = { snapshot: host.readForRenderer(id), removedTurns: plan.dropped.length }
    const redoCheckpointIds: string[] = []
    if (options.restoreFiles) {
      const dropped = new Set(plan.dropped.map(turn => turn.id))
      const restorable = host.checkpoints.list(id).filter(value => value.turnId && dropped.has(value.turnId) && (value.state === 'ready' || value.state === 'conflict'))
      // The files as they are now, in every checkout the dropped turns used, so Redo can bring them back.
      const roots = [...new Set(restorable.flatMap(checkpoint => {
        const row = host.db.prepare('SELECT root_path FROM conversation_checkpoints WHERE id = ?').get(checkpoint.id) as { root_path: string } | undefined
        return row ? [row.root_path] : []
      }))]
      for (const root of roots) {
        const redoId = await host.checkpoints.begin({ threadId: id, turnId: `redo:${turnId}`, rootPath: root, label: 'Before rewind' }).catch(() => undefined)
        if (redoId) redoCheckpointIds.push(redoId)
      }
      let restored = 0
      try {
        // Newest first, so each restore sees the working tree its checkpoint recorded.
        for (const checkpoint of restorable.sort((a, b) => b.createdAt - a.createdAt)) { await host.checkpoints.restore(id, checkpoint.id); restored += checkpoint.fileCount }
        result.restoredFiles = restored
      } catch (error) {
        result.restoredFiles = restored
        result.fileError = error instanceof Error ? error.message : 'Files could not be restored.'
      }
      for (const redoId of redoCheckpointIds) await host.checkpoints.finalize(redoId).catch(() => undefined)
    }
    const latest = host.read(id)
    latest.thread.rewind = { turnId, at: Date.now(), removedTurns: plan.dropped.length, ...(redoCheckpointIds.length ? { redoCheckpointIds } : {}) }
    if (latest.thread.queue?.some(item => item.state === 'queued')) latest.thread.queuePause = { reason: 'interrupted', since: Date.now() }
    latest.thread.updatedAt = Date.now()
    host.save(latest, { eventsFrom: latest.events.length })
    host.changed(id)
    result.snapshot = host.readForRenderer(id)
    const files = result.restoredFiles !== undefined ? `, restored ${result.restoredFiles} file${result.restoredFiles === 1 ? '' : 's'}` : ''
    host.audit(id, { action: 'rewind', actor: 'user', summary: `Rewound ${result.removedTurns} turn${result.removedTurns === 1 ? '' : 's'} (pending until the next message)${files}`, ...(result.fileError ? { detail: result.fileError } : {}) })
    return result
  })
}

/**
 * Undoes a rewind that was not sent yet: the turns come back, and the files when the rewind restored them.
 * A file changed since the rewind blocks the file part with its reason, and the rewind stays in place.
 */
export async function redoRewind(host: RewindHost, id: string): Promise<ThreadSnapshot> {
  if (host.isActive(id)) throw Error('Finish the active operation before redoing.')
  const pending = host.read(id).thread.rewind
  if (!pending) throw Error('There is nothing to redo.')
  return host.withConfiguring(id, async () => {
    for (const redoId of [...(pending.redoCheckpointIds ?? [])].reverse()) await host.checkpoints.restore(id, redoId)
    const latest = host.read(id)
    delete latest.thread.rewind
    latest.thread.updatedAt = Date.now()
    host.save(latest, { eventsFrom: latest.events.length })
    host.changed(id)
    host.audit(id, { action: 'rewind', actor: 'user', summary: `Redid a rewind of ${pending.removedTurns} turn${pending.removedTurns === 1 ? '' : 's'}` })
    return host.readForRenderer(id)
  })
}

/**
 * Confirms a pending rewind: rewinds the provider's history (a Claude fork that ends before the target
 * prompt, or a Codex revert), then drops the later turns locally. Runs right before the next turn starts.
 */
export async function applyPendingRewind(host: RewindHost, id: string): Promise<void> {
  const current = host.read(id)
  const pending = current.thread.rewind
  if (!pending) return
  const plan = planLocalRewind(current, pending.turnId)
  const target = plan.dropped[0]
  const claude = current.thread.provider === 'claude'
  let forkedSession: string | undefined
  if (claude) {
    // Claude cannot drop history in place: write a fork that ends before the
    // target prompt and resume that instead. The original stays on disk.
    const turns = current.turns ?? []
    const prompts = turns.map(turn => {
      const event = current.events.find(value => value.type === 'message' && value.role === 'user' && value.id === turn.id)
      return event?.type === 'message' ? event.text : ''
    })
    forkedSession = (await forkClaudeBefore({ rootPath: current.thread.rootPath, sessionId: current.thread.nativeSessionId!, localPrompts: prompts, targetIndex: turns.indexOf(target) })).sessionId
    // The running process holds the old history in memory; the next send resumes the fork.
    await host.disposeAdapter(id).catch(() => {})
  } else {
    const adapter = await host.connectAdapter(id, current.thread)
    if (!adapter.rewind) throw new ThreadRewindError('unsupported', 'This provider cannot rewind a conversation.')
    await adapter.rewind(target.nativeId!)
  }
  // Proven. Recompute against the latest state and commit atomically.
  const latest = host.read(id)
  if (forkedSession) {
    latest.thread.nativeSessionId = forkedSession
    // Cursor offsets described the original transcript.
    delete latest.thread.nativeHistoryCursor
    delete latest.thread.connection
  }
  const final = planLocalRewind(latest, pending.turnId)
  latest.events = final.events
  latest.turns = final.turns
  latest.thread.status = 'idle'
  latest.thread.lastTurnStatus = final.turns.at(-1)?.status
  delete latest.thread.providerObservation
  delete latest.thread.rewind
  latest.thread.updatedAt = Date.now()
  for (const turn of final.dropped) if (turn.operationId) host.cancelOperation(id, turn.operationId, 'The conversation was rewound.')
  host.replace(latest)
  host.changed(id)
}
