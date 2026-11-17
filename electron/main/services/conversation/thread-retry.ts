import type { ThreadAuditEntry, ThreadSnapshot } from '../../../../shared/types/thread'
import { assertThreadMessage } from '../../../../shared/threadLimits'
import { editablePrompt } from '../../../../shared/threadPromptEdit'
import type { ThreadCheckpointService } from './thread-checkpoints'

/** What a retry or an edit needs from the orchestrator, and nothing more. */
export interface RetryHost {
  checkpoints: ThreadCheckpointService
  isStopping(): boolean
  /** A turn is starting, running or finishing, or the thread is being reconfigured. */
  isActive(id: string): boolean
  isFinalizing(id: string): boolean
  /** Waits for every turn that is capturing its diff and checkpoint. */
  settleFinalization(): Promise<void>
  read(id: string): ThreadSnapshot
  changed(id: string): void
  audit(id: string, entry: Omit<ThreadAuditEntry, 'id' | 'at' | 'threadId' | 'projectRoot'>): void
  send(id: string, text: string, attachmentIds: string[]): Promise<void>
  /** Saves the snapshot's turns from `turnsFrom` on (an edited turn's mark). */
  saveTurns(snapshot: ThreadSnapshot, turnsFrom: number): void
}

/**
 * Undoes a turn's file changes from its checkpoint. A turn without a usable checkpoint refuses with the reason rather
 * than let the next prompt go onto unknown files. Returns how many files it restored.
 */
async function restoreTurnFiles(host: RetryHost, id: string, turnId: string, again: 'Retry' | 'Edit'): Promise<number> {
  const checkpoints = host.checkpoints.list(id).filter(checkpoint => checkpoint.turnId === turnId)
  const restorable = checkpoints.filter(checkpoint => checkpoint.state === 'ready' || checkpoint.state === 'conflict')
  if (!restorable.length) {
    throw Error(checkpoints.length
      ? `This turn's changes cannot be undone: its checkpoint did not complete. ${again} without undoing, or undo the files yourself.`
      : `This turn's changes cannot be undone: it has no checkpoint (it may have been removed after 30 days). ${again} without undoing, or undo the files yourself.`)
  }
  let restoredFiles = 0
  for (const checkpoint of restorable.sort((a, b) => b.createdAt - a.createdAt)) {
    if (checkpoint.fileCount === 0) continue
    await host.checkpoints.restore(id, checkpoint.id)
    restoredFiles += checkpoint.fileCount
  }
  host.audit(id, { action: 'undo-file', actor: 'user', summary: `Undid ${restoredFiles} file${restoredFiles === 1 ? '' : 's'} before ${again === 'Retry' ? 'retrying a turn' : 'editing a prompt'}` })
  host.changed(id)
  return restoredFiles
}

/**
 * Sends a turn's prompt again. With restoreFiles, the turn's file changes are undone first; a turn without a
 * usable checkpoint makes that refuse with the reason rather than send onto unknown files.
 */
export async function retryTurn(host: RetryHost, id: string, turnId: string, options: { restoreFiles?: boolean } = {}): Promise<{ restoredFiles: number }> {
  if (host.isStopping()) throw Error('Application is shutting down')
  if (host.isFinalizing(id)) await host.settleFinalization()
  if (host.isActive(id)) throw Error('Finish the active turn before retrying.')
  const snapshot = host.read(id)
  const turn = snapshot.turns?.find(value => value.id === turnId)
  if (!turn || turn.status === 'running') throw Error('This turn cannot be retried.')
  const prompt = snapshot.events.find(event => event.type === 'message' && event.role === 'user' && event.id === turnId)
  if (prompt?.type !== 'message') throw Error('The prompt of this turn is not available.')
  const restoredFiles = options.restoreFiles ? await restoreTurnFiles(host, id, turnId, 'Retry') : 0
  await host.send(id, prompt.text, prompt.attachments?.map(attachment => attachment.id) ?? [])
  return { restoredFiles }
}

/**
 * Edits the latest prompt (OXE-167, AG-10 §2.1): the edited text goes as the next turn through the normal send, and the
 * edited turn is marked `editedInto: <the new turn's id>`. The agent's session is not rewound and nothing is deleted.
 * Only editablePrompt's turn can be edited. With restoreFiles, the turn's file changes are undone first, as a retry does.
 */
export async function editPrompt(host: RetryHost, id: string, turnId: string, text: string, options: { restoreFiles?: boolean } = {}): Promise<{ restoredFiles: number }> {
  if (host.isStopping()) throw Error('Application is shutting down')
  assertThreadMessage(text)
  if (host.isFinalizing(id)) await host.settleFinalization()
  if (host.isActive(id)) throw Error('Finish the active turn before editing a prompt.')
  const snapshot = host.read(id)
  if (editablePrompt(snapshot)?.turnId !== turnId) throw Error('Only the latest prompt, once its turn ended, can be edited.')
  const prompt = snapshot.events.find(event => event.type === 'message' && event.role === 'user' && event.id === turnId)
  const attachmentIds = prompt?.type === 'message' ? prompt.attachments?.map(attachment => attachment.id) ?? [] : []
  const restoredFiles = options.restoreFiles ? await restoreTurnFiles(host, id, turnId, 'Edit') : 0
  await host.send(id, text, attachmentIds)
  const latest = host.read(id), turns = latest.turns ?? []
  const index = turns.findIndex(value => value.id === turnId), next = turns.at(-1)
  if (index >= 0 && next && next.id !== turnId) {
    turns[index].editedInto = next.id
    host.saveTurns(latest, index)
  }
  return { restoredFiles }
}

/**
 * Rewind left 1.5.0 (product decision, 2026-11-12). A conversation an earlier version left with a rewind that was
 * never confirmed is put back whole: its turns stay, the marker and the safety copies it kept for a Redo go, and no
 * file is touched. Returns the conversations it settled.
 */
export function settleLegacyRewinds(host: {
  ids(): string[]
  read(id: string): ThreadSnapshot
  save(snapshot: ThreadSnapshot): void
  deleteCheckpoint(id: string, checkpointId: string): void
}): string[] {
  const settled: string[] = []
  for (const id of host.ids()) {
    try {
      const snapshot = host.read(id)
      const pending = (snapshot.thread as { rewind?: { redoCheckpointIds?: string[] } }).rewind
      if (!pending) continue
      for (const checkpointId of pending.redoCheckpointIds ?? []) {
        try { host.deleteCheckpoint(id, checkpointId) } catch { /* already gone */ }
      }
      delete (snapshot.thread as { rewind?: unknown }).rewind
      host.save(snapshot)
      settled.push(id)
    } catch { /* a conversation that cannot be read is left as it is */ }
  }
  return settled
}
