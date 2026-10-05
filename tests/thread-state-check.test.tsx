import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useThreadStateCheck } from '../src/components/Threads/useThreadStateCheck'
import type { ThreadSnapshot } from '../shared/types/thread'

afterEach(() => vi.useRealTimers())
function fixture() {
  vi.useFakeTimers(); vi.setSystemTime(100000)
  const observe = vi.fn(async () => ({ state: 'unknown', source: 'codex-app-server', observedAt: Date.now(), detail: 'Unconfirmed' }))
  Object.defineProperty(window, 'oxe', { configurable: true, value: { thread: { observe } } })
  const snapshot = { thread: { id: 'one', provider: 'codex', status: 'running', generation: 1, updatedAt: Date.now() }, turns: [{ id: 'turn', nativeId: 'native-turn', startedAt: Date.now() }], events: [] } as unknown as ThreadSnapshot
  return { observe, snapshot }
}
const advance = async (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
describe('silent turn state checks', () => {
  it('waits one minute, backs off, and stops after three read-only checks', async () => {
    const f = fixture()
    renderHook(() => useThreadStateCheck(f.snapshot, false))
    await advance(59999); expect(f.observe).not.toHaveBeenCalled()
    await advance(1); expect(f.observe).toHaveBeenCalledTimes(1)
    await advance(119999); expect(f.observe).toHaveBeenCalledTimes(1)
    await advance(1); expect(f.observe).toHaveBeenCalledTimes(2)
    await advance(240000); expect(f.observe).toHaveBeenCalledTimes(3)
    await advance(900000); expect(f.observe).toHaveBeenCalledTimes(3)
  })
  it('stops polling after a confirmed terminal observation', async () => {
    const f = fixture(); f.observe.mockResolvedValue({ state: 'completed', source: 'codex-app-server', observedAt: Date.now(), detail: 'Finished' })
    const hook = renderHook(() => useThreadStateCheck(f.snapshot, false))
    await advance(60000)
    expect(hook.result.current.observation?.state).toBe('completed')
    await advance(900000); expect(f.observe).toHaveBeenCalledTimes(1)
  })
  it('ignores a late result after switching conversations and cancels the old timer', async () => {
    const f = fixture()
    let done!: (value: Awaited<ReturnType<typeof f.observe>>) => void
    f.observe.mockImplementationOnce(() => new Promise(resolve => { done = resolve }))
    const hook = renderHook(({ snapshot }) => useThreadStateCheck(snapshot, false), { initialProps: { snapshot: f.snapshot } })
    await advance(60000)
    hook.rerender({ snapshot: { ...f.snapshot, thread: { ...f.snapshot.thread, id: 'two', provider: 'claude' } } })
    await act(async () => { done({ state: 'completed', source: 'codex-app-server', observedAt: Date.now(), detail: 'Old result' }) })
    expect(hook.result.current.observation).toBeUndefined()
    await advance(900000); expect(f.observe).toHaveBeenCalledTimes(1)
  })
  it('does not query during a user question or before native acknowledgement', async () => {
    const f = fixture()
    const hook = renderHook(({ waiting }) => useThreadStateCheck(f.snapshot, waiting), { initialProps: { waiting: true } })
    await advance(600000); expect(f.observe).not.toHaveBeenCalled()
    f.snapshot.turns![0].nativeId = undefined
    hook.rerender({ waiting: false })
    await advance(600000); expect(f.observe).not.toHaveBeenCalled()
  })
})
