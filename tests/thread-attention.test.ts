import { describe, expect, it } from 'vitest'
import { decideThreadAttention, threadAttentionText } from '../src/utils/threadAttention'

const idle = { status: 'idle' as const, lastTurnStatus: 'completed' as const }

describe('decideThreadAttention', () => {
  it('stays silent on first sight and on unchanged status', () => {
    expect(decideThreadAttention({ previous: undefined, current: idle, viewing: false }).kind).toBeNull()
    expect(decideThreadAttention({ previous: 'idle', current: idle, viewing: false }).kind).toBeNull()
  })

  it('reports a finished turn only when it is known to have completed', () => {
    expect(decideThreadAttention({ previous: 'running', current: idle, viewing: false })).toEqual({ kind: 'finished', unread: true, notify: true })
    // Unknown outcome is never reported as success.
    expect(decideThreadAttention({ previous: 'running', current: { status: 'idle' }, viewing: false }).kind).toBeNull()
    // A turn the user stopped says nothing.
    expect(decideThreadAttention({ previous: 'running', current: { status: 'interrupted', lastTurnStatus: 'interrupted' }, viewing: false }).kind).toBeNull()
    expect(decideThreadAttention({ previous: 'running', current: { status: 'idle', lastTurnStatus: 'interrupted' }, viewing: false }).kind).toBeNull()
  })

  it('asks for attention on approval and failure', () => {
    expect(decideThreadAttention({ previous: 'running', current: { status: 'approval' }, viewing: false }).kind).toBe('needs-approval')
    expect(decideThreadAttention({ previous: 'running', current: { status: 'failed', lastTurnStatus: 'failed' }, viewing: false }).kind).toBe('failed')
    expect(decideThreadAttention({ previous: 'idle', current: { status: 'approval' }, viewing: false }).kind).toBe('needs-approval')
  })

  it('does not interrupt a thread that is being watched', () => {
    expect(decideThreadAttention({ previous: 'running', current: idle, viewing: true })).toEqual({ kind: 'finished', unread: false, notify: false })
    expect(decideThreadAttention({ previous: 'running', current: { status: 'approval' }, viewing: true }).notify).toBe(false)
  })

  it('words each kind and falls back for an untitled thread', () => {
    expect(threadAttentionText('finished', 'Fix login').title).toBe('Fix login — terminou')
    expect(threadAttentionText('needs-approval', '  ').title).toMatch(/^Conversa — precisa/)
    expect(threadAttentionText('failed', 'x').body).toMatch(/erro/)
  })
})
