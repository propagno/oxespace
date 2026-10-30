import { create } from 'zustand'
import type { MainMessage } from '../../../shared/messages'
import type { ApprovalRequest, ApprovalResolved, ApprovalsApi } from '../../../shared/types/approvals'
import { humanizeError } from '../../utils/humanizeError'
import { isHandedOff } from './approvalsBoot'
import { historyRow, queueOrder, type ApprovalHistoryRow } from './approvalsRules'

/** Something to tell the person above the request on screen. */
export type ApprovalNotice =
  /** Main refused the answer; its C3 message says why. The queue was read again. */
  | { kind: 'refused'; message: MainMessage }
  /** The answer could not be delivered; the shared error path words it. */
  | { kind: 'failed'; text: string }
  /** The request on screen was settled without the person. */
  | { kind: 'settled'; by: 'timeout' | 'cancelled' | 'native' }

interface ApprovalsState {
  /** Pending requests, oldest first. The first one is on screen. */
  queue: ApprovalRequest[]
  /** This session's decisions, newest first. */
  history: ApprovalHistoryRow[]
  /** The request whose answer is on its way. */
  busyId: string | null
  notice: ApprovalNotice | null
  historyOpen: boolean
}

interface ApprovalsActions {
  sync(api: ApprovalsApi): Promise<void>
  received(request: ApprovalRequest): void
  resolved(resolution: ApprovalResolved): void
  respond(api: ApprovalsApi, optionId: string): Promise<void>
  setHistoryOpen(open: boolean): void
  dismissNotice(): void
  reset(): void
}

const initial: ApprovalsState = { queue: [], history: [], busyId: null, notice: null, historyOpen: false }

const keep = (queue: ApprovalRequest[]): ApprovalRequest[] => queue.filter(request => !isHandedOff(request)).sort(queueOrder)

function mergeHistory(current: ApprovalHistoryRow[], incoming: ApprovalHistoryRow[]): ApprovalHistoryRow[] {
  const byId = new Map(current.map(entry => [entry.id, entry]))
  for (const entry of incoming) byId.set(entry.id, entry)
  return [...byId.values()].sort((a, b) => b.resolvedAt - a.resolvedAt)
}

function rowOf(request: ApprovalRequest, resolution: ApprovalResolved): ApprovalHistoryRow {
  return { id: request.id, kind: request.kind, requester: request.requester, risk: request.risk, title: request.title, summary: request.summary, outcome: resolution.outcome, by: resolution.by, resolvedAt: Date.now() }
}

/** The approval window's state. It only records what the person or main decided; it never answers by itself. */
export const useApprovalsStore = create<ApprovalsState & ApprovalsActions>()((set, get) => ({
  ...initial,

  async sync(api) {
    const [queue, history] = await Promise.all([api.list(), api.history().catch(() => [])])
    set(state => ({ queue: keep(queue), history: mergeHistory(state.history, history.map(historyRow)) }))
  },

  received(request) {
    if (isHandedOff(request)) return
    set(state => ({ queue: keep([...state.queue.filter(item => item.id !== request.id), request]) }))
  },

  resolved(resolution) {
    const { queue, history, busyId } = get()
    const request = queue.find(item => item.id === resolution.id)
    if (!request) return
    const onScreen = queue[0]?.id === resolution.id
    set({
      queue: queue.filter(item => item.id !== resolution.id),
      history: history.some(entry => entry.id === resolution.id) ? history : mergeHistory(history, [rowOf(request, resolution)]),
      ...(onScreen && resolution.by !== 'user' ? { notice: { kind: 'settled', by: resolution.by } as const } : {}),
      ...(busyId === resolution.id ? { busyId: null } : {})
    })
  },

  async respond(api, optionId) {
    const request = get().queue[0]
    if (!request || get().busyId) return
    const option = request.options.find(item => item.id === optionId)
    if (!option) return
    set({ busyId: request.id, notice: null })
    try {
      const result = await api.respond({ id: request.id, optionId, generation: request.generation })
      if (result.ok) {
        // Main also announces it on approvals:resolved; whichever arrives first records it once.
        get().resolved({ id: request.id, generation: request.generation, outcome: option.intent, optionId, by: 'user' })
        set({ busyId: null })
        return
      }
      set({ busyId: null, notice: { kind: 'refused', message: result.message } })
      // A refused answer means the window's copy is out of date: read the queue again.
      await get().sync(api).catch(() => {})
    } catch (cause) {
      set({ busyId: null, notice: { kind: 'failed', text: humanizeError(cause) } })
    }
  },

  setHistoryOpen(open) { set({ historyOpen: open }) },
  dismissNotice() { set({ notice: null }) },
  reset() { set({ ...initial }) }
}))
