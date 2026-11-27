import { randomUUID } from 'node:crypto'
import type {
  AgentConversationAdapter,
  ConversationThread,
  ThreadConfiguration,
  ThreadEvent,
  ThreadProvider,
  ThreadSideEvent,
  ThreadSideMode,
  ThreadSideOpenOptions,
  ThreadSideOpenResult
} from '../../../../shared/types/thread'
import { mainMessage } from '../../../../shared/messages'
import { THREAD_MESSAGE_MAX_CHARS, THREAD_PROMPT_MAX_CHARS } from '../../../../shared/threadLimits'
import { MainRefusal } from '../main-refusal'
import {
  buildSideChatContextBrief,
  buildTerminalSideChatContextBrief,
  type SideChatTerminalContextInput
} from './side-chat-context'

/** Built-in tools a side chat never gets, on top of the read-only tool list: defence in depth. */
export const SIDE_CHAT_DISALLOWED_TOOLS = ['Bash', 'Edit', 'Write', 'NotebookEdit'] as const

const SIDE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isThreadProvider(value: unknown): value is ThreadProvider {
  return value === 'claude' || value === 'codex' || value === 'antigravity'
}

/**
 * A side chat answers questions in the ordinary mode, not plan mode (T59): read-only access and tools, the
 * disallowed write tools, no network, no hooks, and whatever asks for approval is declined (see forward).
 */
export function sideChatConfiguration(thread: Pick<ConversationThread, 'model' | 'reasoningEffort'>): ThreadConfiguration {
  return { ...(thread.model ? { model: thread.model } : {}), ...(thread.reasoningEffort ? { reasoningEffort: thread.reasoningEffort } : {}),
    access: 'read-only', mode: 'default', approvalPolicy: 'on-request', networkAccess: false, hooksEnabled: false }
}

export interface SideChatConnectRequest {
  provider: ThreadProvider
  model?: string
  mode: ThreadSideMode
}

/** What the side chats need from the app. Reading the main conversation or terminal is all they get: nothing writes back. */
export interface ThreadSideHost {
  readThread(id: string): ConversationThread
  /** Optional read-only thread event lookup for Antigravity, cross-provider, or session-less side chats. */
  readThreadContext?(id: string): { events: ThreadEvent[]; branch?: string | null } | null
  /** Optional read-only ScreenMirror / terminal snapshot lookup for OxeCode side chats. */
  readTerminalContext?(input: { paneId: string; workspaceId?: string; rootPath?: string }): Promise<SideChatTerminalContextInput | null> | SideChatTerminalContextInput | null
  /** Optional default provider when opening a terminal side chat whose pane has no detected ThreadProvider. */
  defaultProvider?(): ThreadProvider
  /** Called when the main conversation changes, so a side chat goes when it is archived or deleted. */
  subscribe(id: string, listener: () => void): () => void
  /** A provider connection; `forkId` is the copy's id where OXESpace chooses it. */
  connect(thread: ConversationThread, forkId: string, request?: SideChatConnectRequest): Promise<AgentConversationAdapter>
  /** The provider answered that it cannot open or fork its session. */
  unavailable(error: unknown): boolean
  /** Deletes the copy's own session file by its id, and never one of the `keep` ids. */
  discard(thread: ConversationThread, forkId: string, keep: readonly (string | null)[], provider?: ThreadProvider): Promise<void>
}

interface Side {
  sideId: string
  targetId: string
  source: 'thread' | 'terminal'
  provider: ThreadProvider
  mainNativeSessionId: string | null
  thread: ConversationThread
  adapter: AgentConversationAdapter
  /** The ids the copy was created with or reported: the only session files closing may delete. */
  forkIds: Set<string>
  /** Ephemeral context preamble prepended to the first turn when not using a native session fork. */
  contextBrief: string | null
  briefSent: boolean
  sentWrappedPrompt: string | null
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
 * Side chats (B1.2, OXE-466): an ephemeral read-only copy or context-briefed session across Antigravity, Claude and
 * Codex, for both OxeChat conversations (same-provider and cross-provider) and OxeCode terminal panes. They never
 * write to the main conversation, PTY or database; their events, usage included, go only to the window that opened
 * them. Each is discarded when closed, when its main conversation is archived or deleted, and when the app quits.
 */
export class ThreadSideChats {
  private readonly sides = new Map<string, Side>()

  constructor(private readonly host: ThreadSideHost) {}

  /** One side chat per conversation or terminal target: opening another replaces the previous one. */
  async open(threadId: string, emit: (event: ThreadSideEvent) => void, options?: ThreadSideOpenOptions): Promise<ThreadSideOpenResult> {
    if (options?.source === 'terminal') return this.openTerminal(threadId, emit, options)

    const thread = this.host.readThread(threadId)
    const provider: ThreadProvider = options?.provider ?? thread.provider
    const sameProvider = provider === thread.provider
    const canNativeFork = sameProvider && (provider === 'claude' || provider === 'codex') && Boolean(thread.nativeSessionId)

    let mode: ThreadSideMode = 'native-fork'
    let contextBrief: string | null = null
    let effectiveThread: ConversationThread

    if (canNativeFork) {
      effectiveThread = { ...thread, ...(options?.model ? { model: options.model } : {}) }
    } else {
      const ctx = this.host.readThreadContext?.(threadId) ?? null
      if (sameProvider && (provider === 'claude' || provider === 'codex') && !thread.nativeSessionId) {
        if (!ctx || !ctx.events.some(event => event.type === 'message')) {
          return { ok: false, message: mainMessage('thread.side.noSession', {}) }
        }
      }
      mode = 'ephemeral-context'
      contextBrief = buildSideChatContextBrief({ thread, events: ctx?.events ?? [], branch: ctx?.branch })
      effectiveThread = {
        ...thread,
        provider,
        nativeSessionId: null,
        model: options?.model ?? (sameProvider ? thread.model : undefined),
        reasoningEffort: sameProvider ? thread.reasoningEffort : undefined
      }
    }

    await this.closeThread(threadId)
    const forkId = randomUUID()
    let adapter: AgentConversationAdapter
    try {
      adapter = await this.host.connect(effectiveThread, forkId, { provider, model: effectiveThread.model, mode })
    } catch (error) {
      if (this.host.unavailable(error)) return { ok: false, message: mainMessage('thread.side.unavailable', {}) }
      throw error
    }

    const side: Side = {
      sideId: randomUUID(),
      targetId: threadId,
      source: 'thread',
      provider,
      mainNativeSessionId: thread.nativeSessionId,
      thread: { ...effectiveThread },
      adapter,
      forkIds: new Set([forkId]),
      contextBrief,
      briefSent: false,
      sentWrappedPrompt: null,
      emit,
      release: () => {}
    }
    this.sides.set(side.sideId, side)
    try {
      await side.adapter.start(
        { rootPath: effectiveThread.rootPath, nativeSessionId: mode === 'native-fork' ? thread.nativeSessionId : null, ...sideChatConfiguration(effectiveThread) },
        event => this.forward(side, event)
      )
    } catch (error) {
      await this.close(side.sideId)
      if (this.host.unavailable(error)) return { ok: false, message: mainMessage('thread.side.unavailable', {}) }
      throw error
    }
    if (!this.sides.has(side.sideId)) throw new MainRefusal('thread.side.closed', {})
    side.release = this.host.subscribe(threadId, () => this.mainChanged(threadId))
    return {
      ok: true,
      side: {
        sideId: side.sideId,
        threadId,
        provider,
        readOnly: true,
        mode,
        source: 'thread',
        sourceProvider: thread.provider
      }
    }
  }

  private async openTerminal(targetId: string, emit: (event: ThreadSideEvent) => void, options: ThreadSideOpenOptions): Promise<ThreadSideOpenResult> {
    const paneId = options.paneId?.trim() || (targetId.startsWith('terminal:') ? targetId.slice('terminal:'.length) : '')
    if (!paneId) throw new MainRefusal('thread.side.invalidInput', {})
    const terminal = await this.host.readTerminalContext?.({ paneId, workspaceId: options.workspaceId, rootPath: options.rootPath })
    if (!terminal) return { ok: false, message: mainMessage('thread.side.unavailable', {}) }

    const provider: ThreadProvider = options.provider ?? (isThreadProvider(terminal.agent) ? terminal.agent : this.host.defaultProvider?.() ?? 'claude')
    const rootPath = terminal.cwd || terminal.rootPath || options.rootPath || ''
    if (!rootPath) return { ok: false, message: mainMessage('thread.side.unavailable', {}) }

    const stub: ConversationThread = {
      id: targetId,
      workspaceId: terminal.workspaceId ?? options.workspaceId ?? 'code',
      projectId: '',
      rootPath,
      provider,
      nativeSessionId: null,
      title: terminal.paneTitle || 'Terminal',
      pinned: false,
      status: 'idle',
      generation: 1,
      createdAt: 0,
      updatedAt: 0,
      ...(options.model ? { model: options.model } : {})
    }
    const contextBrief = buildTerminalSideChatContextBrief({ ...terminal, rootPath: terminal.rootPath || rootPath })

    await this.closeThread(targetId)
    const forkId = randomUUID()
    let adapter: AgentConversationAdapter
    try {
      adapter = await this.host.connect(stub, forkId, { provider, model: options.model, mode: 'terminal-context' })
    } catch (error) {
      if (this.host.unavailable(error)) return { ok: false, message: mainMessage('thread.side.unavailable', {}) }
      throw error
    }

    const side: Side = {
      sideId: randomUUID(),
      targetId,
      source: 'terminal',
      provider,
      mainNativeSessionId: null,
      thread: { ...stub },
      adapter,
      forkIds: new Set([forkId]),
      contextBrief,
      briefSent: false,
      sentWrappedPrompt: null,
      emit,
      release: () => {}
    }
    this.sides.set(side.sideId, side)
    try {
      await side.adapter.start(
        { rootPath: stub.rootPath, nativeSessionId: null, ...sideChatConfiguration(stub) },
        event => this.forward(side, event)
      )
    } catch (error) {
      await this.close(side.sideId)
      if (this.host.unavailable(error)) return { ok: false, message: mainMessage('thread.side.unavailable', {}) }
      throw error
    }
    if (!this.sides.has(side.sideId)) throw new MainRefusal('thread.side.closed', {})
    return {
      ok: true,
      side: {
        sideId: side.sideId,
        threadId: targetId,
        provider,
        readOnly: true,
        mode: 'terminal-context',
        source: 'terminal',
        paneId: terminal.paneId
      }
    }
  }

  async send(sideId: unknown, text: unknown): Promise<void> {
    const side = this.sides.get(sideChatId(sideId))
    const message = sideChatText(text)
    if (!side) throw new MainRefusal('thread.side.closed', {})
    if (side.contextBrief && !side.briefSent) {
      const separator = '\n\nUser question:\n'
      const maxBrief = Math.max(0, THREAD_PROMPT_MAX_CHARS - message.length - separator.length)
      const brief = maxBrief >= side.contextBrief.length ? side.contextBrief : side.contextBrief.slice(0, maxBrief)
      const payload = brief ? `${brief}${separator}${message}` : message
      side.sentWrappedPrompt = payload.trim()
      await side.adapter.send(payload)
      side.briefSent = true
      return
    }
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
    if (side.source === 'thread') {
      try { current = this.host.readThread(side.targetId).nativeSessionId } catch { /* the main conversation is gone */ }
    }
    const keep = [side.mainNativeSessionId, current]
    for (const forkId of side.forkIds) await this.host.discard(side.thread, forkId, keep, side.provider).catch(() => {})
  }

  async closeThread(threadId: string): Promise<void> {
    await Promise.all([...this.sides.values()].filter(side => side.targetId === threadId).map(side => this.close(side.sideId)))
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
    if (event.type === 'session' && event.nativeSessionId && event.nativeSessionId !== side.mainNativeSessionId) side.forkIds.add(event.nativeSessionId)
    // Suppress echoed wrapped context-brief prompts so internal reference preambles never appear in the drawer.
    if (event.type === 'message' && event.role === 'user' && side.sentWrappedPrompt && event.text.trim() === side.sentWrappedPrompt) return
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
