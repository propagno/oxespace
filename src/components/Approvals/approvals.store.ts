import { create } from 'zustand'
import type { MainMessage } from '../../../shared/messages'
import type { ApprovalRequest, ApprovalResolved, ApprovalsApi } from '../../../shared/types/approvals'
import { humanizeError } from '../../utils/humanizeError'
import { isHandedOff } from './approvalsBoot'
import { historyRow, queueOrder, type ApprovalHistoryRow } from './approvalsRules'

/** The request a notice or an answer belongs to: its id and generation. */
export interface ApprovalRef { id: string; generation: number }

export const refKey = (ref: ApprovalRef): string => `${ref.id}#${ref.generation}`

/**
 * Something to tell the person about one request, shown only while that request (that generation) is on screen: a
 * notice never carries over to the next request. A stale-generation refusal also shows on the newer generation of
 * the same request, which it explains.
 */
export type ApprovalNotice = ApprovalRef & (
  /** Main refused the answer; its C3 message says why. The queue was read again. */
  | { kind: 'refused'; refusal: string; message: MainMessage }
  /** The answer could not be delivered; the shared error path words it. */
  | { kind: 'failed'; text: string }
)

/** The request on screen was settled without the person (expired, cancelled, answered natively): told once, apart from the next request. */
export interface ApprovalSettled extends ApprovalRef { by: 'timeout' | 'cancelled' | 'native' }

export function noticeFor(notice: ApprovalNotice | null, request: ApprovalRef): ApprovalNotice | null {
  if (!notice || notice.id !== request.id) return null
  if (notice.generation === request.generation) return notice
  return notice.kind === 'refused' && notice.refusal === 'staleGeneration' && request.generation > notice.generation ? notice : null
}

interface ApprovalsState {
  /** Pending requests, oldest first. The first one is on screen. */
  queue: ApprovalRequest[]
  /** This session's decisions, newest first. */
  history: ApprovalHistoryRow[]
  /** The request (`id#generation`) whose answer is on its way. */
  busy: string | null
  notice: ApprovalNotice | null
  settled: ApprovalSettled | null
  historyOpen: boolean
}

interface ApprovalsActions {
  sync(api: ApprovalsApi): Promise<void>
  received(request: ApprovalRequest): void
  resolved(resolution: ApprovalResolved): void
  /**
   * Answers the request the person saw (`shown`, captured when it was rendered), never whatever is first in the queue
   * at the moment of the call. Nothing is sent when that request (that generation) is no longer pending here, or the
   * option is not one of its options.
   */
  respond(api: ApprovalsApi, shown: Pick<ApprovalRequest, 'id' | 'generation' | 'options'>, optionId: string): Promise<void>
  setHistoryOpen(open: boolean): void
  dismissNotice(): void
  takeSettled(): ApprovalSettled | null
  reset(): void
}

const initial: ApprovalsState = { queue: [], history: [], busy: null, notice: null, settled: null, historyOpen: false }

/** One entry per request id, its newest generation; handed-off ones left out. */
function keep(queue: ApprovalRequest[]): ApprovalRequest[] {
  const newest = new Map<string, ApprovalRequest>()
  for (const request of queue) {
    if (isHandedOff(request)) continue
    const known = newest.get(request.id)
    if (!known || request.generation >= known.generation) newest.set(request.id, request)
  }
  return [...newest.values()].sort(queueOrder)
}

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
    set(state => {
      // An older generation arriving late never replaces the newer one.
      const known = state.queue.find(item => item.id === request.id)
      if (known && known.generation > request.generation) return state
      return { queue: keep([...state.queue.filter(item => item.id !== request.id), request]) }
    })
  },

  resolved(resolution) {
    const { queue, history, busy } = get()
    const request = queue.find(item => item.id === resolution.id)
    // Nothing here, or a resolution for an older generation: the newer one stays open (R8).
    if (!request || request.generation > resolution.generation) return
    const onScreen = queue[0]?.id === resolution.id
    set({
      queue: queue.filter(item => item.id !== resolution.id),
      history: history.some(entry => entry.id === resolution.id) ? history : mergeHistory(history, [rowOf(request, resolution)]),
      ...(onScreen && (resolution.by === 'timeout' || resolution.by === 'cancelled' || resolution.by === 'native') ? { settled: { id: request.id, generation: request.generation, by: resolution.by } } : {}),
      ...(busy === refKey(request) ? { busy: null } : {})
    })
  },

  async respond(api, shown, optionId) {
    if (get().busy) return
    // The request the person saw, at the generation they saw: if it is gone or was re-issued, nothing is answered.
    const request = get().queue.find(item => item.id === shown.id && item.generation === shown.generation)
    if (!request) return
    // The option must be one the person saw on this request, and still one of its options.
    const option = shown.options.find(item => item.id === optionId)
    if (!option || !request.options.some(item => item.id === optionId && item.intent === option.intent)) return
    const ref = { id: request.id, generation: request.generation }
    set({ busy: refKey(ref), notice: null })
    try {
      const result = await api.respond({ ...ref, optionId })
      if (result.ok) {
        // Main also announces it on approvals:resolved; whichever arrives first records it once.
        get().resolved({ ...ref, outcome: option.intent, optionId, by: 'user' })
        set({ busy: null })
        return
      }
      set({ busy: null, notice: { ...ref, kind: 'refused', refusal: result.refusal, message: result.message } })
      // A refused answer means the window's copy is out of date: read the queue again.
      await get().sync(api).catch(() => {})
    } catch (cause) {
      set({ busy: null, notice: { ...ref, kind: 'failed', text: humanizeError(cause) } })
    }
  },

  setHistoryOpen(open) { set({ historyOpen: open }) },
  dismissNotice() { set({ notice: null }) },
  takeSettled() { const settled = get().settled; if (settled) set({ settled: null }); return settled },
  reset() { set({ ...initial }) }
}))
