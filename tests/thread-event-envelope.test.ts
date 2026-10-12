import { describe, expect, it } from 'vitest'
import { canTransitionThreadOperation, createThreadEventEnvelope, isTerminalThreadOperation } from '../electron/main/services/conversation/thread-event-envelope'

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
