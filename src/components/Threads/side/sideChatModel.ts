import type { MainMessage } from '../../../../shared/messages'
import type { ThreadEvent } from '../../../../shared/types/thread'

/**
 * The side chat (B1.2) as the drawer shows it: a read-only copy of the conversation's session, so a question asked
 * here never reaches the conversation. Its own messages, what it is doing, and what it has cost so far.
 */
export interface SideChatEntry { id: string; role: 'user' | 'assistant'; text: string }

export interface SideChatCost {
  /** Turns whose provider reported a price; Codex reports tokens only. */
  usd: number
  pricedTurns: number
  inputTokens: number
  outputTokens: number
}

export type SideChatPhase = 'opening' | 'open' | 'refused' | 'failed'

export interface SideChatState {
  phase: SideChatPhase
  sideId: string | null
  /** Why it could not open (no native session yet, the provider cannot copy its session). */
  refusal: MainMessage | null
  entries: SideChatEntry[]
  /** A question was sent and the turn has not completed. */
  busy: boolean
  /** What the copy says it is doing right now (reading, reasoning…), while busy. */
  activity: string | null
  cost: SideChatCost
  /** The last turn failed: its error, in the provider's words. */
  error: string | null
}

/** `error` when the question never reached the copy (it was closed, or main refused the text). */
export const SIDE_SEND_FAILED = '\u0000send'

export const EMPTY_COST: SideChatCost = { usd: 0, pricedTurns: 0, inputTokens: 0, outputTokens: 0 }
export const initialSideChat = (): SideChatState => ({ phase: 'opening', sideId: null, refusal: null, entries: [], busy: false, activity: null, cost: EMPTY_COST, error: null })

function upsert(entries: SideChatEntry[], entry: SideChatEntry): SideChatEntry[] {
  const index = entries.findIndex(item => item.id === entry.id)
  return index < 0 ? [...entries, entry] : entries.map((item, at) => at === index ? entry : item)
}

/** The question the person typed, shown at once; a provider that echoes it back does not show it twice. */
export function withQuestion(state: SideChatState, id: string, text: string): SideChatState {
  return { ...state, entries: [...state.entries, { id, role: 'user', text }], busy: true, activity: null, error: null }
}

export function applySideEvent(state: SideChatState, event: ThreadEvent): SideChatState {
  switch (event.type) {
    case 'message': {
      if (event.role === 'user') {
        const last = [...state.entries].reverse().find(entry => entry.role === 'user')
        if (last && last.text.trim() === event.text.trim()) return state
      }
      return { ...state, entries: upsert(state.entries, { id: event.id, role: event.role, text: event.text }) }
    }
    case 'delta': {
      const current = state.entries.find(entry => entry.id === event.id)
      return { ...state, entries: upsert(state.entries, { id: event.id, role: 'assistant', text: (current?.text ?? '') + event.text }) }
    }
    case 'activity':
      return { ...state, activity: event.summary ?? event.phase }
    case 'tool':
      return event.state === 'running' ? { ...state, activity: event.name } : state
    case 'turn-cost': {
      const cost = state.cost
      return { ...state, cost: {
        usd: cost.usd + (event.usd ?? 0), pricedTurns: cost.pricedTurns + (event.usd === undefined ? 0 : 1),
        inputTokens: cost.inputTokens + (event.inputTokens ?? 0) + (event.cacheReadTokens ?? 0) + (event.cacheCreationTokens ?? 0),
        outputTokens: cost.outputTokens + (event.outputTokens ?? 0)
      } }
    }
    case 'completed':
      return { ...state, busy: false, activity: null, error: event.status === 'failed' ? event.error ?? '' : null }
    default:
      return state
  }
}
