import type { ThreadSnapshot } from './types/thread'

/**
 * Run plan (OXE-167, AG-11 §5.1): the text main sends is exactly the one the card shows (MARCA 15/11, answer 3),
 * never built from agent text. English for any language but Portuguese.
 */
export function executePlanPrompt(language: string): string {
  return /^pt\b/i.test(language) ? 'Execute o plano acima, uma etapa por vez.' : 'Carry out the plan above, one step at a time.'
}

export type PlanExecutionRefusal = 'not-latest' | 'running' | 'not-plan' | 'no-plan' | 'read-only'
export type PlanExecution = { available: true } | { available: false; reason: PlanExecutionRefusal }

/**
 * Whether the plan of `turnId` can run: the latest turn, ended completed, the conversation idle and still in Plan,
 * the turn holding a plan (a `plan` event or an assistant message), and an access other than Read only (which keeps
 * "Mudar acesso"). The window shows Run plan from this; main refuses with it.
 */
export function planExecution(snapshot: Pick<ThreadSnapshot, 'thread' | 'events' | 'turns'>, turnId: string): PlanExecution {
  const turns = snapshot.turns ?? []
  const turn = turns.at(-1)
  if (!turn || turn.id !== turnId) return { available: false, reason: 'not-latest' }
  if (turn.status !== 'completed' || snapshot.thread.status !== 'idle') return { available: false, reason: 'running' }
  if (snapshot.thread.mode !== 'plan') return { available: false, reason: 'not-plan' }
  const start = snapshot.events.findIndex(event => event.type === 'message' && event.role === 'user' && event.id === turnId)
  const events = start < 0 ? [] : snapshot.events.slice(start + 1)
  const hasPlan = events.some(event => (event.type === 'plan' && event.steps.length > 0) || (event.type === 'message' && event.role === 'assistant' && event.text.trim().length > 0))
  if (!hasPlan) return { available: false, reason: 'no-plan' }
  if ((snapshot.thread.access ?? 'read-only') === 'read-only') return { available: false, reason: 'read-only' }
  return { available: true }
}
