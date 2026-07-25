import { describe, expect, test } from 'vitest'
import { MAX_MOUNTED_TERMINAL_PANES, selectWorkspacesToEvict } from '../../src/components/Terminal/webglBudget'

/** MRU order is least-recently-visited first. */
const evict = (
  order: string[],
  panesPerWorkspace: Record<string, number>,
  active: string | null,
  cap: number,
  budget = MAX_MOUNTED_TERMINAL_PANES
): string[] => selectWorkspacesToEvict(order, (id) => panesPerWorkspace[id] ?? 0, active, cap, budget)

describe('selectWorkspacesToEvict', () => {
  test('keeps everything when both limits are satisfied', () => {
    expect(evict(['a', 'b', 'c'], { a: 2, b: 2, c: 2 }, 'c', 5)).toEqual([])
  })

  test('evicts the least-recently-visited first when over the user cap', () => {
    expect(evict(['a', 'b', 'c', 'd'], { a: 1, b: 1, c: 1, d: 1 }, 'd', 2)).toEqual(['a', 'b'])
  })

  test('lets many single-pane workspaces stay mounted', () => {
    // The old workspace-count budget evicted these for no reason: six panes is
    // well inside the WebGL budget.
    expect(evict(['a', 'b', 'c', 'd', 'e', 'f'], { a: 1, b: 1, c: 1, d: 1, e: 1, f: 1 }, 'f', 8)).toEqual([])
  })

  test('evicts pane-heavy workspaces that blow the WebGL budget', () => {
    // Four four-pane workspaces = 16 contexts, over the budget of 12. Evicting
    // just the oldest brings it back to exactly 12, so it stops there — the
    // workspace-count budget would have kept all four.
    expect(evict(['a', 'b', 'c', 'd'], { a: 4, b: 4, c: 4, d: 4 }, 'd', 8)).toEqual(['a'])

    // One more pane-heavy workspace forces a second eviction.
    expect(evict(['a', 'b', 'c', 'd', 'e'], { a: 4, b: 4, c: 4, d: 4, e: 4 }, 'e', 8)).toEqual(['a', 'b'])
  })

  test('never evicts the active workspace', () => {
    // 'a' is oldest but is what the user is looking at.
    expect(evict(['a', 'b', 'c'], { a: 4, b: 4, c: 4 }, 'a', 8, 6)).toEqual(['b', 'c'])
  })

  test('keeps the active workspace even when it alone exceeds the budget', () => {
    // A DOM-renderer fallback is bad; unmounting the visible pane is worse.
    expect(evict(['a'], { a: 20 }, 'a', 8)).toEqual([])
  })

  test('respects a user cap tighter than the pane budget', () => {
    expect(evict(['a', 'b', 'c'], { a: 1, b: 1, c: 1 }, 'c', 1)).toEqual(['a', 'b'])
  })
})
