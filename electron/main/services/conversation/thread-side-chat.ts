import { randomUUID } from 'node:crypto'
import type { AgentConversationAdapter, ConversationThread, ThreadConfiguration, ThreadEvent, ThreadSideEvent, ThreadSideOpenResult } from '../../../../shared/types/thread'
import { mainMessage } from '../../../../shared/messages'
import { THREAD_MESSAGE_MAX_CHARS } from '../../../../shared/threadLimits'
import { MainRefusal } from '../main-refusal'

/** Built-in tools a side chat never gets, on top of plan mode and the read-only tool list: defence in depth. */
export const SIDE_CHAT_DISALLOWED_TOOLS = ['Bash', 'Edit', 'Write', 'NotebookEdit'] as const

const SIDE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A side chat runs in read mode: plan, read-only tools, no hooks; whatever asks for approval is declined (see forward). */
export function sideChatConfiguration(thread: Pick<ConversationThread, 'model' | 'reasoningEffort'>): ThreadConfiguration {
  return { ...(thread.model ? { model: thread.model } : {}), ...(thread.reasoningEffort ? { reasoningEffort: thread.reasoningEffort } : {}),
    access: 'read-only', mode: 'plan', approvalPolicy: 'on-request', networkAccess: false, hooksEnabled: false }
}

/** What the side chats need from the app. Reading the main conversation is all they get of it: nothing writes to it. */
export interface ThreadSideHost {
  readThread(id: string): ConversationThread
  /** Called when the main conversation changes, so a side chat goes when it is archived or deleted. */
  subscribe(id: string, listener: () => void): () => void
  /** A provider connection that copies the session; `forkId` is the copy's id where OXESpace chooses it. */
  connect(thread: ConversationThread, forkId: string): Promise<AgentConversationAdapter>
  /** The provider answered that it cannot fork its session. */
  unavailable(error: unknown): boolean
  /** Deletes the copy's own session file by its id, and never one of the `keep` ids. */
  discard(thread: ConversationThread, forkId: string, keep: readonly (string | null)[]): Promise<void>
}

interface Side {
  sideId: string
  thread: ConversationThread
  adapter: AgentConversationAdapter
  /** The ids the copy was created with or reported: the only session files closing may delete. */
  forkIds: Set<string>
  emit(event: ThreadSideEvent): void
  release(): void
}

export function sideChatId(value: unknown): string {
  if (typeof value !== 'string' || !SIDE_ID.test(value)) throw new MainRefusal('thread.side.invalidInput', {})
  return value
}

export function sideChatText(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > THREAD_MESSAGE_MAX_CHARS || value.includes('\0')) throw new MainRefusal('thread.side.invalidInput', {})
  return value
}

/**
 * Side chats (B1.2): an ephemeral read-only copy of a conversation's native session. They never write to the main
 * conversation or the database; their events, usage included, go only to the window that opened them. Each is
 * discarded when closed, when its main conversation is archived or deleted, and when the app quits.
 */
export class ThreadSideChats {
  private readonly sides = new Map<string, Side>()

  constructor(private readonly host: ThreadSideHost) {}

  /** One side chat per conversation: opening another replaces the previous one. */
  async open(threadId: string, emit: (event: ThreadSideEvent) => void): Promise<ThreadSideOpenResult> {
    const thread = this.host.readThread(threadId)
    if (!thread.nativeSessionId) return { ok: false, message: mainMessage('thread.side.noSession', {}) }
    await this.closeThread(threadId)
    const forkId = randomUUID()
    const side: Side = { sideId: randomUUID(), thread: { ...thread }, adapter: await this.host.connect(thread, forkId), forkIds: new Set([forkId]), emit, release: () => {} }
    this.sides.set(side.sideId, side)
    try {
      await side.adapter.start({ rootPath: thread.rootPath, nativeSessionId: thread.nativeSessionId, ...sideChatConfiguration(thread) }, event => this.forward(side, event))
    } catch (error) {
      await this.close(side.sideId)
      if (this.host.unavailable(error)) return { ok: false, message: mainMessage('thread.side.unavailable', {}) }
      throw error
    }
    if (!this.sides.has(side.sideId)) throw new MainRefusal('thread.side.closed', {})
    side.release = this.host.subscribe(threadId, () => this.mainChanged(threadId))
    return { ok: true, side: { sideId: side.sideId, threadId, provider: thread.provider, readOnly: true } }
  }

  async send(sideId: unknown, text: unknown): Promise<void> {
    const side = this.sides.get(sideChatId(sideId))
    const message = sideChatText(text)
    if (!side) throw new MainRefusal('thread.side.closed', {})
    await side.adapter.send(message)
  }

  /** Ends the copy and deletes only its own session file. Closing one that is gone does nothing. */
  async close(sideId: unknown): Promise<void> {
    const side = this.sides.get(sideChatId(sideId))
    if (!side) return
    this.sides.delete(side.sideId)
    side.release()
    await side.adapter.dispose().catch(() => {})
    let current: string | null = null
    try { current = this.host.readThread(side.thread.id).nativeSessionId } catch { /* the main conversation is gone */ }
    const keep = [side.thread.nativeSessionId, current]
    for (const forkId of side.forkIds) await this.host.discard(side.thread, forkId, keep).catch(() => {})
  }

  async closeThread(threadId: string): Promise<void> {
    await Promise.all([...this.sides.values()].filter(side => side.thread.id === threadId).map(side => this.close(side.sideId)))
  }

  /** On quit: every side chat goes. */
  async stop(): Promise<void> {
    await Promise.allSettled([...this.sides.keys()].map(sideId => this.close(sideId)))
  }

  get size(): number { return this.sides.size }

  private mainChanged(threadId: string): void {
    let closed: boolean
    try { closed = this.host.readThread(threadId).archived === true } catch { closed = true }
    if (closed) void this.closeThread(threadId)
  }

  private forward(side: Side, event: ThreadEvent): void {
    if (this.sides.get(side.sideId) !== side) return
    if (event.type === 'session' && event.nativeSessionId && event.nativeSessionId !== side.thread.nativeSessionId) side.forkIds.add(event.nativeSessionId)
    // Nothing in a side chat is approved: a request is declined at once and never shown.
    if (event.type === 'request') {
      const decline = side.adapter.respondRequest ? side.adapter.respondRequest(event.id, { decision: 'decline', reason: 'A side chat is read-only.' }) : side.adapter.approve(event.id, 'decline')
      void decline.catch(() => {})
      return
    }
    if (event.type === 'approval' || event.type === 'approval-resolved' || event.type === 'request-resolved') return
    side.emit({ sideId: side.sideId, event })
  }
}
