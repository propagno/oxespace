import { describe, expect, it } from 'vitest'
import { canTransitionThreadOperation, createThreadEventEnvelope, deriveThreadDelivery, isTerminalThreadOperation } from '../electron/main/services/conversation/thread-event-envelope'

describe('Thread event envelope', () => {
  it('creates a versioned envelope with stable caller identity', () => {
    const envelope = createThreadEventEnvelope({
      payload: { type: 'message', id: 'message', role: 'user', text: 'Hello' },
      threadId: 'thread', turnId: 'turn', operationId: 'operation', eventId: 'event',
      generation: 4, sequence: 9, createdAt: 123
    })
    expect(envelope).toEqual({
      schemaVersion: 2, eventId: 'event', operationId: 'operation', threadId: 'thread', turnId: 'turn',
      generation: 4, sequence: 9, createdAt: 123, updatedAt: 123,
      payload: { type: 'message', id: 'message', role: 'user', text: 'Hello' }
    })
  })

  it('allows forward progress but never regresses or replaces a terminal state', () => {
    expect(canTransitionThreadOperation('created', 'sent')).toBe(true)
    expect(canTransitionThreadOperation('running', 'sent')).toBe(false)
    expect(canTransitionThreadOperation('completed', 'failed')).toBe(false)
    expect(isTerminalThreadOperation('unknown')).toBe(true)
    expect(isTerminalThreadOperation('running')).toBe(false)
  })
})

describe('Thread delivery', () => {
  it('reports what was observed about the input, not the turn outcome', () => {
    const at = (state: Parameters<typeof deriveThreadDelivery>[0]['state'], error?: string) => deriveThreadDelivery({ state, ...(error ? { error } : {}), updatedAt: 7 })
    expect(at('created').state).toBe('sending')
    expect(at('sent').state).toBe('sending')
    for (const state of ['acknowledged', 'running', 'completed', 'cancelled'] as const) expect(at(state).state).toBe('delivered')
    expect(at('unknown', 'process closed')).toEqual({ state: 'unconfirmed', error: 'process closed', updatedAt: 7 })
    expect(at('failed', 'auth')).toEqual({ state: 'rejected', error: 'auth', updatedAt: 7 })
  })
})
