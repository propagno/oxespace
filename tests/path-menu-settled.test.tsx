import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OPEN_IN_SETTLE_MS, useOpenInStore, useSettledOpenInTargets } from '../src/lib/openIn'
import type { OpenInTargets } from '../shared/types/open-in'

const zed: OpenInTargets = { editors: [{ id: 'zed', name: 'Zed' }], preferred: 'auto' }
const both: OpenInTargets = { editors: [{ id: 'vscode', name: 'VS Code' }, { id: 'zed', name: 'Zed' }], preferred: 'auto' }

/** FL-11: a menu opened before main's editor scan answered got rows inserted above "Copy relative path". */
describe('useSettledOpenInTargets', () => {
  // The list arrives when the store gets it (main's answer, or a read on window focus); main itself never answers here.
  const answer = (targets: OpenInTargets): void => { useOpenInStore.setState({ targets }) }
  beforeEach(() => {
    vi.useFakeTimers()
    useOpenInStore.setState({ targets: null })
    ;(window as unknown as { oxe: unknown }).oxe = { app: { openInTargets: () => new Promise<OpenInTargets>(() => undefined) } }
  })
  afterEach(() => { vi.useRealTimers() })

  it('opens at once with a list read before', () => {
    useOpenInStore.setState({ targets: zed })
    const { result } = renderHook(() => useSettledOpenInTargets())
    expect(result.current).toBe(zed)
  })

  it('waits for the first list, then keeps it while open', () => {
    const { result } = renderHook(() => useSettledOpenInTargets())
    expect(result.current).toBeUndefined()
    act(() => { answer(zed) })
    expect(result.current).toEqual(zed)
    // A list read again (window focus) reaches the next menu, not this one.
    act(() => { answer(both) })
    expect(result.current).toEqual(zed)
  })

  it('opens without editors when the list is late, and does not add them afterwards', () => {
    const { result } = renderHook(() => useSettledOpenInTargets())
    act(() => { vi.advanceTimersByTime(OPEN_IN_SETTLE_MS) })
    expect(result.current).toBeNull()
    act(() => { answer(zed) })
    expect(result.current).toBeNull()
  })
})
