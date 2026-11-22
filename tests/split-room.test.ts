import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { PaneNode } from '../shared/types/pane-tree'
import { layoutPaneSize, MIN_PANE_HEIGHT_PX, MIN_PANE_WIDTH_PX, PANE_HALF_GAP_PX, PANE_OUTER_GUTTER_PX, paneSize, splitHalf, splitHasRoom } from '../src/components/Grid/splitRoom'

afterEach(() => { document.body.innerHTML = '' })

const columns = (...ids: string[]) => ({ kind: 'split', direction: 'horizontal', children: ids.map(paneId => ({ kind: 'leaf', paneId })) }) as unknown as PaneNode

describe('room to split a pane', () => {
  it('beside: each half keeps at least the minimum width; a pane measured on screen counts the worst gap (12 px)', () => {
    const exact = MIN_PANE_WIDTH_PX * 2 + 12
    expect(splitHasRoom({ width: exact, height: 400 }, 'vertical')).toBe(true)
    expect(splitHasRoom({ width: exact - 1, height: 400 }, 'vertical')).toBe(false)
    // A 2×2 grid at 1440 px gives ~700 px panes: one split fits, the next (175 px halves) does not.
    expect(splitHasRoom({ width: 700, height: 400 }, 'vertical')).toBe(true)
    expect(splitHasRoom({ width: 345, height: 400 }, 'vertical')).toBe(false)
  })

  it('below: each half keeps at least the minimum height; the width does not matter', () => {
    expect(splitHasRoom({ width: 100, height: MIN_PANE_HEIGHT_PX * 2 + 12 }, 'horizontal')).toBe(true)
    expect(splitHasRoom({ width: 2000, height: MIN_PANE_HEIGHT_PX * 2 + 11 }, 'horizontal')).toBe(false)
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
    // Four columns side by side in a 1440 px grid: each has a 360 px share; the first loses 8 px at the edge and 4 px
    // at the gap, so 348 px: too narrow to split beside, maximized or not.
    const tree = columns('a', 'b', 'c', 'd')
    const size = layoutPaneSize(tree, 'a', { width: 1440, height: 800 })!
    expect(size.width).toBe(348)
    expect(splitHasRoom(size, 'vertical')).toBe(false)
    expect(splitHasRoom(size, 'horizontal')).toBe(true)
    expect(layoutPaneSize(tree, 'missing', { width: 1440, height: 800 })).toBeNull()
    expect(layoutPaneSize(tree, 'a', null)).toBeNull()
  })
})

describe('OXE-344 · the room counts the grid\'s real gutters (8 px at an edge, 4 px each side of a gap)', () => {
  it('a pane at the grid\'s edge: its halves are what the grid draws, and a 238 px half is refused', () => {
    // Two columns in a 1000 px grid: the right one has a 500 px share, 4 px inside and 8 px at the edge, so 488 px.
    const right = layoutPaneSize(columns('a', 'b'), 'b', { width: 1000, height: 800 })!
    expect(right.width).toBe(488)
    expect(right.edges).toEqual({ left: false, right: true, top: true, bottom: true })
    // Split, each half has a 250 px share: 250 − 4 − 4 = 242 inside, 250 − 4 − 8 = 238 at the edge.
    expect(splitHalf(right, 'vertical').width).toBe(238)
    expect(splitHasRoom(right, 'vertical')).toBe(false)
  })

  it('a pane in the middle: both halves keep 4 px on each side', () => {
    // Three columns in a 1500 px grid: the middle one has a 500 px share, 4 px on both sides, so 492 px.
    const middle = layoutPaneSize(columns('a', 'b', 'c'), 'b', { width: 1500, height: 800 })!
    expect(middle.width).toBeCloseTo(492, 6)
    expect(splitHalf(middle, 'vertical').width).toBeCloseTo(242, 6)
    expect(splitHasRoom(middle, 'vertical')).toBe(true)
  })

  it('a pane alone: 8 px on both sides, the halves split evenly', () => {
    const alone = layoutPaneSize({ kind: 'leaf', paneId: 'a' } as unknown as PaneNode, 'a', { width: 1000, height: 260 })!
    expect(alone).toMatchObject({ width: 984, height: 244 })
    expect(splitHalf(alone, 'vertical').width).toBe(488)
    expect(splitHalf(alone, 'horizontal').height).toBe(118)
    expect(splitHasRoom(alone, 'horizontal')).toBe(false)
  })

  it('the gutters are the grid\'s own: var(--space-2) is 8 px, and the gap is half of it', () => {
    const tokens = readFileSync(join(__dirname, '../src/styles/tokens.generated.css'), 'utf8')
    expect(tokens).toMatch(new RegExp(`--space-2:\\s*${PANE_OUTER_GUTTER_PX}px;`))
    const grid = readFileSync(join(__dirname, '../src/components/Grid/WorkspaceSplitGrid.tsx'), 'utf8')
    expect(grid).toContain("const PANE_OUTER_GUTTER = 'var(--space-2)'")
    expect(grid).toContain("const PANE_HALF_GAP = 'calc(var(--space-2) / 2)'")
    expect(PANE_HALF_GAP_PX).toBe(PANE_OUTER_GUTTER_PX / 2)
  })
})
