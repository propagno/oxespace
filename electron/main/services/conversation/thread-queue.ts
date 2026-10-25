import type { AgentConversationAdapter, ConversationThread, ThreadAttachment, ThreadOperationState, ThreadSnapshot } from '../../../../shared/types/thread'
import { assertThreadMessage } from '../../../../shared/threadLimits'
import { turnConfiguration } from './kernel/turn-configuration'
import type { ThreadHistoryWriteOptions } from './thread-history'

/** What the message queue needs from the orchestrator, and nothing more. */
export interface QueueHost {
  isStopping(): boolean
  isBusy(id: string): boolean
  /** A turn is running or finishing, or the thread is being reconfigured: the queue waits. */
  blocksDrain(id: string): boolean
  setBusy(id: string, busy: boolean): void
  /** Marks that the running turn is being stopped so a queued item can go right after it. */
  markSendNowAfterStop(id: string, marked: boolean): void
  /** True once per stop: the first drain after it clears the flag. */
  takeSendNowAfterStop(id: string): boolean
  read(id: string): ThreadSnapshot
  save(snapshot: ThreadSnapshot, options?: ThreadHistoryWriteOptions): void
  transitionOperation(id: string, operationId: string, state: ThreadOperationState, reason?: string): void
  adapter(id: string): AgentConversationAdapter | undefined
  resolveAttachments(id: string, attachmentIds: string[]): Promise<ThreadAttachment[]>
  releaseAttachments(id: string, attachmentIds: string[]): Promise<void>
  applyPendingRewind(id: string): Promise<void>
  /** Starts checkpoint and baseline tracking for a turn in the thread's working checkout. */
  beginTurn(id: string, turnId: string, thread: ConversationThread, label: string, baseline: boolean): Promise<void>
  send(id: string, text: string, attachmentIds: string[]): Promise<void>
  interrupt(id: string): Promise<void>
}

const savePlain = (host: QueueHost, snapshot: ThreadSnapshot) => host.save(snapshot, { eventsFrom: snapshot.events.length })
const nativeIdsOf = (items: Array<{ nativeId?: string }>): string[] => items.map(item => item.nativeId).filter((value): value is string => Boolean(value))

export async function updateQueued(host: QueueHost, id: string, itemId: string, text: string): Promise<void> {
  assertThreadMessage(text)
  const snapshot = host.read(id), item = snapshot.thread.queue?.find(value => value.id === itemId)
  if (!item || item.state !== 'queued') throw Error('Queued input is unavailable')
  item.text = text
  const adapter = host.adapter(id)
  if (item.nativeId && adapter?.updateQueued) await adapter.updateQueued(item.nativeId, item, await host.resolveAttachments(id, item.attachmentIds ?? []))
  savePlain(host, snapshot)
}

export async function deleteQueued(host: QueueHost, id: string, itemId: string, preserveAttachments = false): Promise<void> {
  const snapshot = host.read(id), item = snapshot.thread.queue?.find(value => value.id === itemId)
  if (!item || item.state === 'sending') throw Error('Queued input is unavailable')
  const adapter = host.adapter(id)
  // An `unknown` item crossed a process boundary without an acknowledgement.
  // Never issue a second native mutation for it: removing it is an explicit
  // local dismissal, not proof that the provider did or did not receive it.
  if (item.state !== 'unknown' && item.nativeId && adapter?.deleteQueued) await adapter.deleteQueued(item.nativeId)
  snapshot.thread.queue = snapshot.thread.queue?.filter(value => value.id !== itemId)
  if (!snapshot.thread.queue?.some(value => value.state === 'queued')) delete snapshot.thread.queuePause
  if (item.operationId) host.transitionOperation(id, item.operationId, 'cancelled', 'Queued input was removed locally.')
  savePlain(host, snapshot)
  if (!preserveAttachments) await host.releaseAttachments(id, item.attachmentIds ?? [])
}

/** Clears a pause and lets the queue continue from its first waiting item. */
export async function resumeQueue(host: QueueHost, id: string): Promise<void> {
  const snapshot = host.read(id)
  if (!snapshot.thread.queuePause) return
  delete snapshot.thread.queuePause
  savePlain(host, snapshot)
  await drainQueue(host, id)
}

/**
 * Moves one waiting item to the front and sends it. While a turn runs, that turn is stopped first and the
 * item goes as soon as it ends; the stop is the user's choice, so it does not pause the queue.
 */
export async function sendQueuedNow(host: QueueHost, id: string, itemId: string): Promise<void> {
  const snapshot = host.read(id), queue = snapshot.thread.queue ?? []
  const item = queue.find(value => value.id === itemId)
  if (!item || item.state !== 'queued') throw Error('Queued input is unavailable')
  if (queue[0]?.id !== itemId) {
    const nativeIds = nativeIdsOf([item, ...queue.filter(value => value.id !== itemId)])
    snapshot.thread.queue = [item, ...queue.filter(value => value.id !== itemId)]
    const adapter = host.adapter(id)
    if (nativeIds.length === queue.length && adapter?.reorderQueued) await adapter.reorderQueued(nativeIds)
  }
  delete snapshot.thread.queuePause
  savePlain(host, snapshot)
  if (host.isBusy(id)) {
    host.markSendNowAfterStop(id, true)
    try { await host.interrupt(id) } catch (error) { host.markSendNowAfterStop(id, false); throw error }
    return
  }
  await drainQueue(host, id)
}

export async function reorderQueued(host: QueueHost, id: string, itemIds: string[]): Promise<void> {
  const snapshot = host.read(id), queue = snapshot.thread.queue ?? []
  if (itemIds.length !== queue.length || new Set(itemIds).size !== itemIds.length) throw Error('Invalid queue order')
  const byId = new Map(queue.map(item => [item.id, item]))
  if (itemIds.some(itemId => !byId.has(itemId))) throw Error('Invalid queue order')
  snapshot.thread.queue = itemIds.map(itemId => byId.get(itemId)!)
  const nativeIds = nativeIdsOf(snapshot.thread.queue)
  const adapter = host.adapter(id)
  if (nativeIds.length === queue.length && adapter?.reorderQueued) await adapter.reorderQueued(nativeIds)
  savePlain(host, snapshot)
}

/** Sends the first waiting item, unless a turn is active, the queue is paused or there is none. */
export async function drainQueue(host: QueueHost, id: string): Promise<void> {
  if (host.isStopping() || host.blocksDrain(id)) return
  let snapshot: ThreadSnapshot
  try { snapshot = host.read(id) } catch { return }
  // The flag lasts until the first drain after the stop, whether or not that turn ended up paused.
  if (host.takeSendNowAfterStop(id) && snapshot.thread.queuePause) {
    delete snapshot.thread.queuePause
    savePlain(host, snapshot)
  }
  if (snapshot.thread.queuePause) return
  let item = snapshot.thread.queue?.find(value => value.state === 'queued')
  if (!item) return
  // The next queued message confirms a pending rewind, as a sent one does.
  if (snapshot.thread.rewind) {
    try { await host.applyPendingRewind(id) } catch { return }
    snapshot = host.read(id)
    item = snapshot.thread.queue?.find(value => value.state === 'queued')
    if (!item) return
  }
  item.state = 'sending'
  if (item.operationId) host.transitionOperation(id, item.operationId, 'sent')
  savePlain(host, snapshot)
  try {
    const adapter = host.adapter(id)
    if (item.nativeId && adapter?.startQueued) {
      const latest = host.read(id)
      latest.thread.queue = latest.thread.queue?.filter(value => value.id !== item.id)
      latest.thread.status = 'running'
      delete latest.thread.providerObservation
      const attachments = await host.resolveAttachments(id, item.attachmentIds ?? [])
      latest.events.push({ type: 'message', id: item.id, role: 'user', text: item.text, ...(attachments.length ? { attachments: attachments.map(({ path: _path, ...attachment }) => attachment) } : {}) })
      latest.turns ??= []
      latest.turns.push({ id: item.id, ...(item.operationId ? { operationId: item.operationId } : {}), sequence: latest.turns.length + 1, startedAt: Date.now(), status: 'running', configuration: turnConfiguration(latest.thread), ...(item.attachmentIds?.length ? { attachmentIds: [...item.attachmentIds] } : {}) })
      await host.beginTurn(id, item.id, latest.thread, item.text.trim().slice(0, 80), false)
      if (item.operationId) host.transitionOperation(id, item.operationId, 'running')
      host.setBusy(id, true); host.save(latest, { eventsFrom: latest.events.length - 1, ...(item.operationId ? { operationId: item.operationId } : {}) })
      await adapter.startQueued(item.nativeId)
    } else {
      const latest = host.read(id)
      latest.thread.queue = latest.thread.queue?.filter(value => value.id !== item.id)
      if (item.operationId) host.transitionOperation(id, item.operationId, 'completed')
      savePlain(host, latest)
      await host.send(id, item.text, item.attachmentIds ?? [])
    }
  } catch (error) {
    const latest = host.read(id)
    latest.thread.queue ??= []
    let failed = latest.thread.queue.find(value => value.id === item.id)
    if (!failed) { failed = { ...item }; latest.thread.queue.push(failed) }
    failed.state = 'failed'; failed.error = error instanceof Error ? error.message : 'Could not send queued input'
    if (failed.operationId) host.transitionOperation(id, failed.operationId, 'failed', failed.error)
    host.setBusy(id, false); savePlain(host, latest)
  }
}
