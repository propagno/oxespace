import { describe, expect, it, vi } from 'vitest'
import { ThreadRequestRegistry } from '../electron/main/services/conversation/thread-request-registry'
import type { ThreadRequest } from '../shared/types/thread'

const request = (overrides: Partial<ThreadRequest> = {}): ThreadRequest => ({
  id: 'request-1', nativeId: 'native-1', nativeMethod: 'item/tool/requestUserInput', kind: 'question',
  title: 'Choose', generation: 2, createdAt: Date.now(), state: 'pending', ...overrides
})

describe('ThreadRequestRegistry', () => {
  it('resolves once and rejects stale generations', async () => {
    const registry = new ThreadRequestRegistry(), respond = vi.fn(async () => {})
    registry.register('thread', request(), respond)
    await expect(registry.resolve('thread', 'request-1', 1, { answers: { q: ['a'] } })).rejects.toThrow('older')
    await registry.resolve('thread', 'request-1', 2, { answers: { q: ['a'] } })
    expect(respond).toHaveBeenCalledWith({ answers: { q: ['a'] } })
    await expect(registry.resolve('thread', 'request-1', 2, {})).rejects.toThrow('no longer')
  })

  it('isolates threads and expires requests without invoking the provider', () => {
    const registry = new ThreadRequestRegistry(), respond = vi.fn(async () => {})
    registry.register('one', request({ expiresAt: Date.now() - 1 }), respond)
    registry.register('two', request({ id: 'request-2', nativeId: 'native-2' }), respond)
    expect(registry.list('one')).toEqual([])
    expect(registry.list('two')).toHaveLength(1)
    expect(registry.invalidate('two')[0]).toMatchObject({ state: 'cancelled' })
    expect(respond).not.toHaveBeenCalled()
  })
})
