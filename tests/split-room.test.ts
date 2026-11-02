import { afterEach, describe, expect, it } from 'vitest'
import type { PaneNode } from '../shared/types/pane-tree'
import { layoutPaneSize, MIN_PANE_HEIGHT_PX, MIN_PANE_WIDTH_PX, paneSize, splitHasRoom } from '../src/components/Grid/splitRoom'

afterEach(() => { document.body.innerHTML = '' })

describe('room to split a pane', () => {
  it('beside: each half keeps at least the minimum width, gap included', () => {
    const exact = MIN_PANE_WIDTH_PX * 2 + 10
    expect(splitHasRoom({ width: exact, height: 400 }, 'vertical')).toBe(true)
    expect(splitHasRoom({ width: exact - 1, height: 400 }, 'vertical')).toBe(false)
    // A 2×2 grid at 1440 px gives ~700 px panes: one split fits, the next (175 px halves) does not.
    expect(splitHasRoom({ width: 700, height: 400 }, 'vertical')).toBe(true)
    expect(splitHasRoom({ width: 345, height: 400 }, 'vertical')).toBe(false)
  })

  it('below: each half keeps at least the minimum height; the width does not matter', () => {
    expect(splitHasRoom({ width: 100, height: MIN_PANE_HEIGHT_PX * 2 + 10 }, 'horizontal')).toBe(true)
    expect(splitHasRoom({ width: 2000, height: MIN_PANE_HEIGHT_PX * 2 + 9 }, 'horizontal')).toBe(false)
  })

  it('a pane that is not drawn has no size, so nothing is refused for it', () => {
    expect(paneSize('missing')).toBeNull()
    const pane = document.createElement('section')
    pane.dataset.testid = 'pane-container'
    pane.dataset.paneId = 'p "1"'
    document.body.append(pane)
    // jsdom draws nothing: zero size counts as not drawn.
    expect(paneSize('p "1"')).toBeNull()
    pane.getBoundingClientRect = () => ({ width: 700, height: 400 }) as DOMRect
    expect(paneSize('p "1"')).toEqual({ width: 700, height: 400 })
  })
  it('measures from the layout, so a maximized pane is judged by the room it goes back to', () => {
    // Four columns side by side in a 1440 px grid: each has ~350 px, too narrow to split beside, maximized or not.
    const tree = { kind: 'split', direction: 'horizontal', children: ['a', 'b', 'c', 'd'].map(paneId => ({ kind: 'leaf', paneId })) } as unknown as PaneNode
    const size = layoutPaneSize(tree, 'a', { width: 1440, height: 800 })!
    expect(Math.round(size.width)).toBe(350)
    expect(splitHasRoom(size, 'vertical')).toBe(false)
    expect(splitHasRoom(size, 'horizontal')).toBe(true)
    expect(layoutPaneSize(tree, 'missing', { width: 1440, height: 800 })).toBeNull()
    expect(layoutPaneSize(tree, 'a', null)).toBeNull()
  })
})
