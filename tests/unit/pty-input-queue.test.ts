import { describe, expect, test, vi } from 'vitest'
import { PtyInputQueue } from '../../electron/main/services/pty-input-queue'

describe('PtyInputQueue', () => {
  test('writes a large paste completely and in order', () => {
    vi.useFakeTimers()
    const write = vi.fn()
    const queue = new PtyInputQueue({ write }, 4, 1)
    const payload = '0123456789abcdef'

    queue.enqueue(payload)
    vi.runAllTimers()
    vi.useRealTimers()

    expect(write.mock.calls.map(([chunk]) => chunk).join('')).toBe(payload)
    expect(write.mock.calls).toEqual([['0123'], ['4567'], ['89ab'], ['cdef']])
  })

  test('keeps later input behind the current paste', () => {
    vi.useFakeTimers()
    const write = vi.fn()
    const queue = new PtyInputQueue({ write }, 4, 1)

    queue.enqueue('abcdefgh')
    queue.enqueue('XYZ')
    vi.runAllTimers()
    vi.useRealTimers()

    expect(write.mock.calls.map(([chunk]) => chunk).join('')).toBe('abcdefghXYZ')
  })

  test('drops queued input after disposal', () => {
    vi.useFakeTimers()
    const write = vi.fn()
    const queue = new PtyInputQueue({ write }, 4, 1)

    queue.enqueue('abcdefgh')
    queue.dispose()
    vi.runAllTimers()
    vi.useRealTimers()

    expect(write).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenCalledWith('abcd')
  })

  test('does not repeatedly concatenate a fragmented paste', () => {
    vi.useFakeTimers()
    const write = vi.fn()
    const queue = new PtyInputQueue({ write }, 4, 1)
    const fragments = ['ab', 'cd', 'ef', 'gh', 'ij']

    for (const fragment of fragments) queue.enqueue(fragment)
    vi.runAllTimers()
    vi.useRealTimers()

    expect(write.mock.calls.map(([chunk]) => chunk).join('')).toBe(fragments.join(''))
  })

  test('applies backpressure until the queued paste drains below the resume watermark', async () => {
    vi.useFakeTimers()
    const write = vi.fn()
    const queue = new PtyInputQueue({ write }, 4, 1, 8, 4)

    const drained = queue.enqueue('abcdefghijkl')
    let settled = false
    void drained.then(() => { settled = true })

    await Promise.resolve()
    expect(settled).toBe(false)

    await vi.runAllTimersAsync()
    expect(settled).toBe(true)
    expect(write.mock.calls.map(([chunk]) => chunk).join('')).toBe('abcdefghijkl')
    vi.useRealTimers()
  })
})
