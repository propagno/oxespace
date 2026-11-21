// Frozen acceptance test for 1.5.2 Polimento 2 (Jira OXE-188, AG-06, CA-1 and CA-2; A17, A18). Written by the planner; the
// executor must not edit it. On main f65fa5374 two conversations side by side split 1fr/1fr (ThreadView.css
// .thread-grid.is-split) with nothing between them to resize.
// Contract:
// - src/components/Threads/threadGridLayout.ts (new) exports SPLIT_RATIO_MIN = 35, SPLIT_RATIO_MAX = 65,
//   SPLIT_RATIO_DEFAULT = 50 and clampSplitRatio(value): the first column's share in percent, rounded, within 35–65.
// - src/store/thread.store.ts: splitRatio (default 50) and setSplitRatio(value), which stores clampSplitRatio(value).
// - src/ui/Splitter.tsx gains an optional `unit` prop: how many pixels one unit of `value` is while dragging (default 1,
//   so every other splitter is unchanged).
// - src/components/Threads/ThreadGrid.tsx: in split mode, a src/ui Splitter between the two cells, orientation
//   "vertical", label thread:grid.resize (new: "Redimensionar as colunas" / "Resize the columns"), value = splitRatio,
//   min 35, max 65, defaultValue 50, step 5, unit = the .thread-grid element's getBoundingClientRect().width / 100;
//   onChange → setSplitRatio. The grid carries the share as the inline custom property --thread-split ("60%"), which
//   ThreadView.css uses for the first column (both cells keep min-width: 0).
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ThreadSnapshot } from '../../../shared/types/thread'
import { ThreadGrid } from '../../../src/components/Threads/ThreadGrid'
import { SPLIT_RATIO_DEFAULT, SPLIT_RATIO_MAX, SPLIT_RATIO_MIN, clampSplitRatio } from '../../../src/components/Threads/threadGridLayout'
import { useThreadStore } from '../../../src/store/thread.store'
import { i18n } from '../../../src/i18n'

vi.mock('../../../src/components/Threads/ThreadView', () => ({
  ThreadView: ({ threadId, cell }: { threadId: string | null; cell?: string }) => <div data-testid="thread-view" data-selected={threadId ?? ''} data-cell={cell ?? ''} />
}))

const tt = (key: string): string => i18n.t(key, { ns: 'thread' }) as string
const snapshot = (id: string): ThreadSnapshot => ({ thread: { id, workspaceId: 'thread:p1', projectId: 'p1', rootPath: '/repo', provider: 'claude', title: id, pinned: false, status: 'idle', nativeSessionId: null, createdAt: 1, updatedAt: 1 }, events: [] }) as unknown as ThreadSnapshot
const GRID_WIDTH = 1000

beforeEach(() => {
  // jsdom has no PointerEvent; the Splitter reads clientX from it.
  if (!('PointerEvent' in window)) {
    class PointerEventShim extends MouseEvent { pointerId: number; constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 1 } }
    Object.defineProperty(window, 'PointerEvent', { configurable: true, value: PointerEventShim })
  }
  HTMLElement.prototype.setPointerCapture ??= () => undefined
  HTMLElement.prototype.releasePointerCapture ??= () => undefined
  const real = HTMLElement.prototype.getBoundingClientRect
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('thread-grid') ? { x: 0, y: 0, top: 0, left: 0, right: GRID_WIDTH, bottom: 600, width: GRID_WIDTH, height: 600, toJSON: () => ({}) } as DOMRect : real.call(this)
  })
  const a = snapshot('conv-a'), b = snapshot('conv-b')
  Object.defineProperty(window, 'oxe', { configurable: true, value: { thread: { read: vi.fn(async (id: string) => snapshot(id)) } } })
  useThreadStore.setState({ selectedId: 'conv-a', snapshot: a, secondaryId: 'conv-b', activeCell: 'primary', threads: [a.thread, b.thread], snapshotCache: { 'conv-b': b }, snapshotCacheOrder: ['conv-b'], projects: [] } as never)
  useThreadStore.getState().setSplitRatio(SPLIT_RATIO_DEFAULT)
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const separator = (): HTMLElement => screen.getByRole('separator', { name: tt('grid.resize') })
const grid = (): HTMLElement => document.querySelector<HTMLElement>('.thread-grid')!
function drag(by: number): void {
  const handle = separator()
  fireEvent.pointerDown(handle, { clientX: 500, pointerId: 1, button: 0 })
  fireEvent.pointerMove(handle, { clientX: 500 + by / 2, pointerId: 1 })
  fireEvent.pointerMove(handle, { clientX: 500 + by, pointerId: 1 })
  fireEvent.pointerUp(handle, { clientX: 500 + by, pointerId: 1 })
}

describe('OXE-188 · AG-06 the side-by-side divider', () => {
  test('side-by-side Splitter clamps column width between 35 and 65 percent and double-click resets to 50/50', () => {
    expect([SPLIT_RATIO_MIN, SPLIT_RATIO_MAX, SPLIT_RATIO_DEFAULT]).toEqual([35, 65, 50])
    expect([clampSplitRatio(10), clampSplitRatio(57.4), clampSplitRatio(99)]).toEqual([35, 57, 65])
    expect(tt('grid.resize'), 'thread:grid.resize exists').not.toBe('grid.resize')
    render(<ThreadGrid />)
    expect(screen.getAllByTestId('thread-view')).toHaveLength(2)
    expect(grid().style.getPropertyValue('--thread-split')).toBe('50%')
    // 100 px of a 1000 px grid is 10 points.
    act(() => drag(100))
    expect(useThreadStore.getState().splitRatio).toBe(60)
    expect(grid().style.getPropertyValue('--thread-split')).toBe('60%')
    act(() => drag(300))
    expect(useThreadStore.getState().splitRatio, 'never above 65').toBe(65)
    act(() => drag(-1000))
    expect(useThreadStore.getState().splitRatio, 'never below 35').toBe(35)
    expect(grid().style.getPropertyValue('--thread-split')).toBe('35%')
    act(() => { fireEvent.doubleClick(separator()) })
    expect(useThreadStore.getState().splitRatio).toBe(50)
    expect(grid().style.getPropertyValue('--thread-split')).toBe('50%')
    // One conversation: no divider.
    act(() => { useThreadStore.getState().closeSecondary() })
    expect(screen.queryByRole('separator', { name: tt('grid.resize') })).toBeNull()
  })

  test('keyboard arrows move the side-by-side Splitter separator with updated aria-valuenow', () => {
    render(<ThreadGrid />)
    const handle = separator()
    expect(handle).toHaveAttribute('aria-orientation', 'vertical')
    expect(handle).toHaveAttribute('aria-valuemin', '35')
    expect(handle).toHaveAttribute('aria-valuemax', '65')
    expect(handle).toHaveAttribute('aria-valuenow', '50')
    handle.focus()
    act(() => { fireEvent.keyDown(handle, { key: 'ArrowRight' }) })
    expect(separator()).toHaveAttribute('aria-valuenow', '55')
    act(() => { fireEvent.keyDown(separator(), { key: 'ArrowLeft' }) })
    act(() => { fireEvent.keyDown(separator(), { key: 'ArrowLeft' }) })
    expect(separator()).toHaveAttribute('aria-valuenow', '45')
    act(() => { fireEvent.keyDown(separator(), { key: 'End' }) })
    expect(separator()).toHaveAttribute('aria-valuenow', '65')
    act(() => { fireEvent.keyDown(separator(), { key: 'Home' }) })
    expect(separator()).toHaveAttribute('aria-valuenow', '35')
    expect(useThreadStore.getState().splitRatio).toBe(35)
  })
})
