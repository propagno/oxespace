import { randomUUID } from 'node:crypto'
import type { ThreadEvent, ThreadEventEnvelope, ThreadOperationState } from '../../../../shared/types/thread'

const terminalStates = new Set<ThreadOperationState>(['completed', 'failed', 'cancelled', 'unknown'])
const ranks: Record<ThreadOperationState, number> = {
  created: 0,
  sent: 1,
  acknowledged: 2,
  running: 3,
  completed: 4,
  failed: 4,
  cancelled: 4,
  unknown: 4
}

export function isTerminalThreadOperation(state: ThreadOperationState): boolean {
  return terminalStates.has(state)
}

/** Prevents late provider callbacks from regressing or replacing a terminal result. */
export function canTransitionThreadOperation(from: ThreadOperationState, to: ThreadOperationState): boolean {
  if (from === to) return true
  if (isTerminalThreadOperation(from)) return false
  return ranks[to] >= ranks[from]
}

export function createThreadEventEnvelope<T extends ThreadEvent>(input: {
  payload: T
  threadId: string
  sequence: number
  generation: number
  eventId?: string
  operationId?: string
  turnId?: string
  createdAt?: number
}): ThreadEventEnvelope<T> {
  const now = input.createdAt ?? Date.now()
  return {
    schemaVersion: 2,
    eventId: input.eventId ?? randomUUID(),
    ...(input.operationId ? { operationId: input.operationId } : {}),
    threadId: input.threadId,
    ...(input.turnId ? { turnId: input.turnId } : {}),
    generation: input.generation,
    sequence: input.sequence,
    createdAt: now,
    updatedAt: now,
    payload: input.payload
  }
}
