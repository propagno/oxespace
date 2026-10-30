import { create } from 'zustand'
import { humanizeError } from '../../utils/humanizeError'
import { refusalOf } from './approvalsApi'
import { isHandedOff } from './approvalsBoot'
import { byCreatedAt, type ApprovalHistoryEntry, type ApprovalRefusal, type ApprovalRequest, type ApprovalResolution, type ApprovalsApi } from './approvalsContract'

/** Something to tell the person above the request on screen. */
export type ApprovalNotice =
  /** Main refused the answer (C3 code); the queue was read again. */
  | { kind: 'refused'; code: ApprovalRefusal }
  /** The answer could not be delivered; the shared error path words it. */
  | { kind: 'failed'; text: string }
  /** The request on screen was settled without the person (timeout or cancel). */
  | { kind: 'settled'; by: 'timeout' | 'cancelled' }

interface ApprovalsState {
  /** Pending requests, oldest first. The first one is on screen. */
  queue: ApprovalRequest[]
  /** This session's decisions, oldest first. */
  history: ApprovalHistoryEntry[]
  /** The request whose answer is on its way. */
  busyId: string | null
  notice: ApprovalNotice | null
  historyOpen: boolean
}

interface ApprovalsActions {
  sync(api: ApprovalsApi): Promise<void>
  received(request: ApprovalRequest): void
  resolved(resolution: ApprovalResolution): void
  respond(api: ApprovalsApi, optionId: string): Promise<void>
  setHistoryOpen(open: boolean): void
  dismissNotice(): void
  reset(): void
}

const initial: ApprovalsState = { queue: [], history: [], busyId: null, notice: null, historyOpen: false }

const keep = (queue: ApprovalRequest[]): ApprovalRequest[] => queue.filter(request => !isHandedOff(request.id)).sort(byCreatedAt)

function mergeHistory(current: ApprovalHistoryEntry[], incoming: ApprovalHistoryEntry[]): ApprovalHistoryEntry[] {
  const byId = new Map(current.map(entry => [entry.id, entry]))
  for (const entry of incoming) byId.set(entry.id, entry)
  return [...byId.values()].sort((a, b) => a.at - b.at)
}

function entryOf(request: ApprovalRequest, resolution: ApprovalResolution): ApprovalHistoryEntry {
  return { id: request.id, kind: request.kind, requester: request.requester, risk: request.risk, environment: request.environment, outcome: resolution.outcome, by: resolution.by, at: resolution.at ?? Date.now() }
}

/** The approval window's state. It only ever records what the person or main decided; it never answers by itself. */
export const useApprovalsStore = create<ApprovalsState & ApprovalsActions>()((set, get) => ({
  ...initial,

  async sync(api) {
    const [queue, history] = await Promise.all([api.list(), api.history().catch(() => [])])
    set(state => ({ queue: keep(queue), history: mergeHistory(state.history, history) }))
  },

  received(request) {
    if (isHandedOff(request.id)) return
    set(state => ({ queue: keep([...state.queue.filter(item => item.id !== request.id), request]) }))
  },

  resolved(resolution) {
    const { queue, history } = get()
    const request = queue.find(item => item.id === resolution.id)
    if (!request) return
    const onScreen = queue[0]?.id === resolution.id
    set({
      queue: queue.filter(item => item.id !== resolution.id),
      history: history.some(entry => entry.id === resolution.id) ? history : mergeHistory(history, [entryOf(request, resolution)]),
      ...(onScreen && resolution.by !== 'user' ? { notice: { kind: 'settled', by: resolution.by } as const } : {}),
      ...(get().busyId === resolution.id ? { busyId: null } : {})
    })
  },

  async respond(api, optionId) {
    const request = get().queue[0]
    if (!request || get().busyId) return
    const option = request.options.find(item => item.id === optionId)
    if (!option) return
    set({ busyId: request.id, notice: null })
    try {
      await api.respond({ id: request.id, optionId, generation: request.generation })
      // Main also announces it on approvals:resolved; whichever arrives first records it once.
      get().resolved({ id: request.id, outcome: option.intent, by: 'user', at: Date.now() })
      set({ busyId: null })
    } catch (cause) {
      const code = refusalOf(cause)
      set({ busyId: null, notice: code ? { kind: 'refused', code } : { kind: 'failed', text: humanizeError(cause) } })
      // A refused answer means the window's copy is out of date: read the queue again.
      if (code) await get().sync(api).catch(() => {})
    }
  },

  setHistoryOpen(open) { set({ historyOpen: open }) },
  dismissNotice() { set({ notice: null }) },
  reset() { set({ ...initial }) }
}))
