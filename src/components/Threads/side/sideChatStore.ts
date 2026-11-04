import { create } from 'zustand'
import { mainMessage } from '../../../../shared/messages'
import { useThreadStore } from '../../../store/thread.store'
import { applySideEvent, initialSideChat, SIDE_SEND_FAILED, withQuestion, type SideChatState } from './sideChatModel'

/**
 * Side chats (B1.2) per conversation, outside any component (T60). Switching conversation tabs, closing the drawer with
 * ✕ or Mod+. only hides it: the copy, its answers and its cost stay, and events that arrive meanwhile land here. The
 * copy goes only on "Discard and close…", when its conversation is archived or deleted (main closes it too), or with
 * the window (main closes it). At most one per conversation.
 */
interface SideChatStore {
  /** The conversations whose drawer is showing. */
  shown: Record<string, true>
  chats: Record<string, SideChatState>
}

export const useSideChatStore = create<SideChatStore>(() => ({ shown: {}, chats: {} }))

const api = () => window.oxe?.thread

function patch(threadId: string, change: (state: SideChatState) => SideChatState): void {
  useSideChatStore.setState(store => {
    const current = store.chats[threadId]
    return current ? { chats: { ...store.chats, [threadId]: change(current) } } : store
  })
}

function drop(threadId: string): SideChatState | undefined {
  const current = useSideChatStore.getState().chats[threadId]
  useSideChatStore.setState(store => {
    const chats = { ...store.chats }, shown = { ...store.shown }
    delete chats[threadId]; delete shown[threadId]
    return { chats, shown }
  })
  return current
}

let unsubscribe: (() => void) | null = null
/** One listener for every copy: an event goes to the conversation whose copy it came from. */
function listen(): void {
  if (unsubscribe) return
  const fromMain = api()?.onSideEvent?.(({ sideId, event }) => {
    const entry = Object.entries(useSideChatStore.getState().chats).find(([, state]) => state.sideId === sideId)
    if (entry) patch(entry[0], state => applySideEvent(state, event))
  })
  // Archived or deleted: main has already thrown its copy away, so this one goes as well.
  const fromThreads = useThreadStore.subscribe(store => {
    const { chats } = useSideChatStore.getState()
    if (!store.threads.length) return
    for (const threadId of Object.keys(chats)) {
      const thread = store.threads.find(item => item.id === threadId)
      if (!thread || thread.archived) drop(threadId)
    }
  })
  unsubscribe = () => { fromMain?.(); fromThreads() }
}

/** Forgets every side chat without telling main: tests start from nothing. */
export function resetSideChats(): void {
  unsubscribe?.()
  unsubscribe = null
  useSideChatStore.setState({ shown: {}, chats: {} })
}

export function showSideChat(threadId: string, shown: boolean): void {
  useSideChatStore.setState(store => {
    const next = { ...store.shown }
    if (shown) next[threadId] = true
    else delete next[threadId]
    return { shown: next }
  })
}

/** Opens this conversation's copy unless it already has one (opening or open); a refused or failed one tries again. */
export function ensureSideChat(threadId: string): void {
  const existing = useSideChatStore.getState().chats[threadId]
  if (existing && (existing.phase === 'opening' || existing.phase === 'open')) return
  listen()
  const opening = initialSideChat()
  useSideChatStore.setState(store => ({ chats: { ...store.chats, [threadId]: opening } }))
  const thread = api()
  if (!thread?.sideOpen) {
    patch(threadId, state => ({ ...state, phase: 'refused', refusal: mainMessage('thread.side.unavailable', {}) }))
    return
  }
  const still = () => useSideChatStore.getState().chats[threadId] === opening
  void thread.sideOpen(threadId).then(result => {
    // Discarded while it was opening: let main throw the copy away at once.
    if (!still()) { if (result.ok) void thread.sideClose?.(result.side.sideId).catch(() => undefined); return }
    if (!result.ok) { patch(threadId, state => ({ ...state, phase: 'refused', refusal: result.message })); return }
    patch(threadId, state => ({ ...state, phase: 'open', sideId: result.side.sideId }))
  }, () => { if (still()) patch(threadId, state => ({ ...state, phase: 'failed' })) })
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

/** "Discard and close…": main deletes the copy, and the drawer closes. */
export async function discardSideChat(threadId: string): Promise<void> {
  const sideId = drop(threadId)?.sideId
  if (sideId) await api()?.sideClose?.(sideId).catch(() => undefined)
}

/** Whether discarding loses something the person may want: an answer from the copy. */
export function sideChatHasAnswers(state: SideChatState | undefined): boolean {
  return Boolean(state?.entries.some(entry => entry.role === 'assistant'))
}
