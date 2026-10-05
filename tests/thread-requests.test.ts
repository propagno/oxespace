import { describe, expect, it, vi } from 'vitest'
import { ThreadRequestRegistry } from '../electron/main/services/conversation/thread-request-registry'
import type { ThreadRequest } from '../shared/types/thread'

const request = (overrides: Partial<ThreadRequest> = {}): ThreadRequest => ({
  id: 'request-1', nativeId: 'native-1', nativeMethod: 'item/tool/requestUserInput', kind: 'question',
  title: 'Choose', generation: 2, createdAt: Date.now(), state: 'pending', questions: [{ id: 'q', question: 'Choose?' }], ...overrides
})

describe('ThreadRequestRegistry', () => {
  it('keeps a response visible while sending and never resurrects it after invalidation', async () => {
    const registry = new ThreadRequestRegistry()
    let reject!: (error: Error) => void
    const respond = vi.fn(() => new Promise<void>((_resolve, fail) => { reject = fail }))
    registry.register('thread', request(), respond)
    const sending = registry.resolve('thread', 'request-1', 2, { answers: { q: ['a'] } })
    expect(registry.list('thread')).toHaveLength(1)
    await expect(registry.resolve('thread', 'request-1', 2, { answers: { q: ['b'] } })).rejects.toThrow('already being sent')
    expect(registry.invalidate('thread')).toHaveLength(1)
    registry.register('thread', request({ id: 'new-request' }), vi.fn(async () => {}))
    reject(Error('Connection lost'))
    await expect(sending).rejects.toThrow('Connection lost')
    expect(registry.list('thread').map(value => value.id)).toEqual(['new-request'])
    expect(respond).toHaveBeenCalledOnce()
    registry.invalidate('thread')
  })
  it('does not overwrite expiry when a pending response completes late', async () => {
    vi.useFakeTimers()
    try {
      const registry = new ThreadRequestRegistry(), expired = vi.fn()
      let finish!: () => void
      registry.register('thread', request({ expiresAt: Date.now() + 10 }), () => new Promise<void>(resolve => { finish = resolve }), expired)
      const sending = registry.resolve('thread', 'request-1', 2, { answers: { q: ['a'] } })
      vi.advanceTimersByTime(11)
      finish()
      expect(await sending).toMatchObject({ state: 'expired', resolution: 'unknown' })
      expect(expired).toHaveBeenCalledOnce()
      expect(registry.list('thread')).toEqual([])
    } finally { vi.useRealTimers() }
  })
  it('allows an explicit retry after a failed response only while still pending', async () => {
    const registry = new ThreadRequestRegistry(), respond = vi.fn().mockRejectedValueOnce(Error('Not sent')).mockResolvedValue(undefined)
    registry.register('thread', request(), respond)
    await expect(registry.resolve('thread', 'request-1', 2, { answers: { q: ['a'] } })).rejects.toThrow('Not sent')
    expect(registry.list('thread')).toHaveLength(1)
    await registry.resolve('thread', 'request-1', 2, { answers: { q: ['a'] } })
    expect(registry.list('thread')).toEqual([])
  })
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
  it('reports timed expiration so the saved conversation can explain why a question closed', () => {
    vi.useFakeTimers()
    try {
      const registry = new ThreadRequestRegistry(), expired = vi.fn()
      registry.register('thread', request({ expiresAt: Date.now() + 10 }), vi.fn(async () => {}), expired)
      vi.advanceTimersByTime(10)
      expect(expired).toHaveBeenCalledOnce()
      expect(expired.mock.calls[0][0]).toMatchObject({ state: 'expired', resolution: 'unknown', resolvedAt: expect.any(Number) })
      expect(registry.list('thread')).toEqual([])
    } finally { vi.useRealTimers() }
  })
})
