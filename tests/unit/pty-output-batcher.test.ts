import { describe, expect, test, vi } from 'vitest'
import { PtyOutputBatcher } from '../../electron/main/services/pty-output-batcher'

describe('PtyOutputBatcher', () => {
  test('coalesces bursts and preserves output order', () => {
    vi.useFakeTimers()
    const emit = vi.fn()
    const batcher = new PtyOutputBatcher('pane-1', emit, 16, 1024)

    batcher.push('first ')
    batcher.push('second')
    vi.advanceTimersByTime(16)
    vi.useRealTimers()

    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith({ paneId: 'pane-1', data: 'first second' })
  })

  test('flushes a large chunk immediately', () => {
    const emit = vi.fn()
    const batcher = new PtyOutputBatcher('pane-1', emit, 16, 4)

    batcher.push('1234')

    expect(emit).toHaveBeenCalledWith({ paneId: 'pane-1', data: '1234' })
  })
})
