import { create } from 'zustand'
import { mainMessage } from '../../../../shared/messages'
import type { ThreadProvider, ThreadSideOpenOptions } from '../../../../shared/types/thread'
import { useThreadStore } from '../../../store/thread.store'
import { applySideEvent, initialSideChat, SIDE_SEND_FAILED, withQuestion, type SideChatState } from './sideChatModel'

/**
 * Side chats (B1.2, OXE-466) per conversation or OxeCode terminal pane, outside any component (T60).
 * Switching tabs or closing the drawer with ✕ / Mod+. only hides it: the copy, its answers and its cost stay, and
 * events that arrive meanwhile land here. Switching provider cleanly discards the previous ephemeral copy and opens
 * a fresh read-only side session on the chosen provider without touching the main conversation.
 */
interface SideChatStore {
  /** The conversations or terminal panes whose drawer is showing. */
  shown: Record<string, true>
  chats: Record<string, SideChatState>
  /** Unsent text per conversation or terminal side chat; survives closing the drawer (OXE-479 pre-fill). */
  drafts: Record<string, string>
}

export const useSideChatStore = create<SideChatStore>(() => ({ shown: {}, chats: {}, drafts: {} }))

const TERMINAL_PREFIX = 'terminal:'
/** Stable side-chat store key for an OxeCode terminal pane so it never collides with conversation ids. */
export const terminalSideKey = (paneId: string): string => `${TERMINAL_PREFIX}${paneId}`

const api = () => window.oxe?.thread
const pendingOpens = new Map<string, Promise<string | null>>()

function patch(threadId: string, change: (state: SideChatState) => SideChatState): void {
  useSideChatStore.setState(store => {
    const current = store.chats[threadId]
    return current ? { chats: { ...store.chats, [threadId]: change(current) } } : store
  })
}

function drop(threadId: string, keepShown = false): SideChatState | undefined {
  const current = useSideChatStore.getState().chats[threadId]
  pendingOpens.delete(threadId)
  useSideChatStore.setState(store => {
    const chats = { ...store.chats }, shown = { ...store.shown }
    delete chats[threadId]
    if (!keepShown) delete shown[threadId]
    return { chats, shown }
  })
  return current
}

let unsubscribe: (() => void) | null = null
/** One listener for every copy: an event goes to the conversation or terminal whose copy it came from. */
function listen(): void {
  if (unsubscribe) return
  const fromMain = api()?.onSideEvent?.(({ sideId, event }) => {
    const entry = Object.entries(useSideChatStore.getState().chats).find(([, state]) => state.sideId === sideId)
    if (entry) patch(entry[0], state => applySideEvent(state, event))
  })
  // Archived or deleted conversations: main has already thrown its copy away, so this one goes as well.
  const fromThreads = useThreadStore.subscribe(store => {
    const { chats } = useSideChatStore.getState()
    if (!store.threads.length) return
    for (const key of Object.keys(chats)) {
      if (key.startsWith(TERMINAL_PREFIX)) continue
      const thread = store.threads.find(item => item.id === key)
      if (!thread || thread.archived) drop(key)
    }
  })
  unsubscribe = () => { fromMain?.(); fromThreads() }
}

/** Forgets every side chat without telling main: tests start from nothing. */
export function resetSideChats(): void {
  unsubscribe?.()
  unsubscribe = null
  pendingOpens.clear()
  useSideChatStore.setState({ shown: {}, chats: {}, drafts: {} })
}

export function setSideChatDraft(threadId: string, text: string): void {
  useSideChatStore.setState(store => {
    const drafts = { ...store.drafts }
    if (text) drafts[threadId] = text
    else delete drafts[threadId]
    return { drafts }
  })
}

/** Opens the side chat drawer pre-filled with `text` (without sending or polluting the main conversation, OXE-479). */
export function openSideChatWithDraft(threadId: string, text?: string): void {
  if (text && text.trim()) setSideChatDraft(threadId, text)
  showSideChat(threadId, true)
}

export function showSideChat(threadId: string, shown: boolean): void {
  useSideChatStore.setState(store => {
    const next = { ...store.shown }
    if (shown) next[threadId] = true
    else delete next[threadId]
    return { shown: next }
  })
}

/** Toggles visibility of a conversation or terminal side chat drawer and returns the new open state. */
export function toggleSideChat(threadId: string): boolean {
  const next = !useSideChatStore.getState().shown[threadId]
  showSideChat(threadId, next)
  return next
}

/** Opens this target's copy unless it already has one (opening or open); a refused or failed one tries again. */
export function ensureSideChat(threadId: string, options?: ThreadSideOpenOptions): Promise<string | null> {
  const existing = useSideChatStore.getState().chats[threadId]
  const providerMatches = !options?.provider || existing?.provider === options.provider
  if (existing && providerMatches) {
    if (existing.phase === 'open' && existing.sideId) return Promise.resolve(existing.sideId)
    if (existing.phase === 'opening') return pendingOpens.get(threadId) ?? Promise.resolve(null)
  }
  listen()
  const opening = initialSideChat({
    provider: options?.provider ?? null,
    source: options?.source ?? (threadId.startsWith(TERMINAL_PREFIX) ? 'terminal' : 'thread')
  })
  useSideChatStore.setState(store => ({ chats: { ...store.chats, [threadId]: opening } }))
  const thread = api()
  if (!thread?.sideOpen) {
    patch(threadId, state => ({ ...state, phase: 'refused', refusal: mainMessage('thread.side.unavailable', {}) }))
    return Promise.resolve(null)
  }
  const still = () => useSideChatStore.getState().chats[threadId] === opening
  const call = options !== undefined ? thread.sideOpen(threadId, options) : thread.sideOpen(threadId)
  const pending = call.then(result => {
    if (pendingOpens.get(threadId) === pending) pendingOpens.delete(threadId)
    // Discarded or switched while opening: let main throw the stale copy away at once.
    if (!still()) { if (result.ok) void thread.sideClose?.(result.side.sideId).catch(() => undefined); return null }
    if (!result.ok) { patch(threadId, state => ({ ...state, phase: 'refused', refusal: result.message })); return null }
    patch(threadId, state => ({
      ...state,
      phase: 'open',
      sideId: result.side.sideId,
      provider: result.side.provider,
      mode: result.side.mode ?? null,
      source: result.side.source ?? state.source
    }))
    return result.side.sideId
  }, () => {
    if (pendingOpens.get(threadId) === pending) pendingOpens.delete(threadId)
    if (still()) patch(threadId, state => ({ ...state, phase: 'failed' }))
    return null
  })
  pendingOpens.set(threadId, pending)
  return pending
}

/** Discards the current ephemeral side session and opens a fresh read-only one on `provider`, keeping the drawer open. */
export async function switchSideChatProvider(
  threadId: string,
  provider: ThreadProvider,
  options?: Omit<ThreadSideOpenOptions, 'provider'>
): Promise<string | null> {
  const previous = drop(threadId, true)
  if (previous?.sideId) await api()?.sideClose?.(previous.sideId).catch(() => undefined)
  return ensureSideChat(threadId, { ...options, provider })
}

export async function sendSideChat(threadId: string, text: string): Promise<void> {
  const sideId = useSideChatStore.getState().chats[threadId]?.sideId
  const question = text.trim()
  if (!sideId || !question) return
  patch(threadId, state => withQuestion(state, `local-${Date.now()}`, question))
  // Main's refusal is English for its log; the drawer says it in the interface's language.
  try {
    const thread = api()
    if (!thread?.sideSend) throw new Error('No side chat in this build')
    await thread.sideSend(sideId, question)
  } catch {
    patch(threadId, state => ({ ...state, busy: false, activity: null, error: SIDE_SEND_FAILED }))
  }
}

/** Shows the drawer, ensures the read-only side chat is open, and asks `question` right away (used by `/btw`). */
export async function askSideChat(threadId: string, question: string, options?: ThreadSideOpenOptions): Promise<void> {
  showSideChat(threadId, true)
  const sideId = await ensureSideChat(threadId, options)
  if (sideId && question.trim()) await sendSideChat(threadId, question)
}

/** "Discard and close…": main deletes the copy, and the drawer closes. */
export async function discardSideChat(threadId: string): Promise<void> {
  const sideId = drop(threadId)?.sideId
  if (sideId) await api()?.sideClose?.(sideId).catch(() => undefined)
}

/** Whether discarding loses something the person may want: an answer from the copy. */
export function sideChatHasAnswers(state: SideChatState | undefined): boolean {
  return Boolean(state?.entries.some(entry => entry.role === 'assistant'))
}
