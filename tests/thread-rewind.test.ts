import { describe, expect, it } from 'vitest'
import { ThreadRewindError, planLocalRewind, readAllTurnIds, verifyRevert } from '../electron/main/services/conversation/thread-rewind'
import type { ThreadEvent, ThreadTurn } from '../shared/types/thread'

const configuration = { model: 'm', reasoningEffort: 'low', access: 'read-only' as const, networkAccess: false, approvalPolicy: 'on-request' as const, mode: 'default' as const, hooksEnabled: false }
const turn = (id: string, sequence: number): ThreadTurn => ({ id, sequence, status: 'completed', configuration })
const user = (id: string): ThreadEvent => ({ type: 'message', id, role: 'user', text: id })
const reply = (id: string): ThreadEvent => ({ type: 'message', id: `${id}-reply`, role: 'assistant', text: 'ok' })

describe('rewind helpers', () => {
  it('cuts events and turns at the target user message', () => {
    const plan = planLocalRewind({ events: [user('a'), reply('a'), user('b'), reply('b'), user('c')], turns: [turn('a', 1), turn('b', 2), turn('c', 3)] }, 'b')
    expect(plan.events.map(event => 'id' in event && event.id)).toEqual(['a', 'a-reply'])
    expect(plan.turns.map(value => value.id)).toEqual(['a'])
    expect(plan.dropped.map(value => value.id)).toEqual(['b', 'c'])
  })

  it('refuses an unknown turn or one without its message', () => {
    expect(() => planLocalRewind({ events: [], turns: [turn('a', 1)] }, 'a')).toThrow(ThreadRewindError)
    expect(() => planLocalRewind({ events: [user('a')], turns: [turn('a', 1)] }, 'zzz')).toThrow(ThreadRewindError)
  })

  it('verifies the exact remaining prefix', () => {
    expect(() => verifyRevert(['a', 'b', 'c'], ['a'], 'b')).not.toThrow()
    expect(() => verifyRevert(['a', 'b', 'c'], ['a', 'b'], 'b')).toThrow(/does not match/)
    expect(() => verifyRevert(['a', 'b', 'c'], ['a'], 'x')).toThrow(/no longer has/)
  })

  it('pages through provider turns and aborts on a repeated cursor or endless history', async () => {
    const pages: Record<string, { ids: string[]; next: string | null }> = { start: { ids: ['a'], next: 'p2' }, p2: { ids: ['b'], next: null } }
    expect(await readAllTurnIds(async cursor => pages[cursor ?? 'start'])).toEqual(['a', 'b'])
    await expect(readAllTurnIds(async () => ({ ids: ['a'], next: 'same' }))).rejects.toMatchObject({ code: 'proof-mismatch' })
    let counter = 0
    await expect(readAllTurnIds(async () => ({ ids: ['a'], next: `c${counter++}` }))).rejects.toMatchObject({ code: 'history-limit' })
  })
})
