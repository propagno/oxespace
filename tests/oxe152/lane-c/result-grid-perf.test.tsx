// OXE-351 (part a): the OxeQuery result grid's hot paths. Each visible cell is turned into text once per render (it was
// twice: its title and its text); a scroll is applied once per animation frame; the filter runs on a deferred value,
// so typing stays responsive on a large result; and a column resize that is still going when the grid unmounts leaves
// no listener behind.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const counts = vi.hoisted(() => ({ cells: 0 }))
vi.mock('../../../src/components/OxeQuery/grid-format', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../src/components/OxeQuery/grid-format')>()
  return { ...actual, displayCell: (value: unknown) => { counts.cells++; return actual.displayCell(value) } }
})

import { ResultGrid } from '../../../src/components/OxeQuery/ResultGrid'

const columns = ['id', 'doc', 'note']
const rows: unknown[][] = Array.from({ length: 6 }, (_, i) => [i + 1, { key: `k${i}`, nested: [i] }, `text ${i}`])

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers() })

describe('OXE-351 (a) · ResultGrid hot paths', () => {
  it('turns each visible cell into text once per render', () => {
    render(<ResultGrid columns={columns} types={['int4', 'jsonb', 'text']} rows={rows} onCopy={vi.fn()} onSelect={vi.fn()} />)
    const grid = screen.getByRole('grid', { name: 'Result' })
    const cells = screen.getAllByRole('gridcell').length
    counts.cells = 0
    fireEvent.keyDown(grid, { key: 'ArrowDown' })
    expect(cells).toBe(18)
    // The move re-renders every visible row; the sampled widths are memoized and do not run again.
    expect(counts.cells, 'one serialization per visible cell').toBe(cells)
  })

  it('applies a scroll once per animation frame', () => {
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.push(callback); return frames.length })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
    const many: unknown[][] = Array.from({ length: 500 }, (_, i) => [i + 1, null, `row ${i}`])
    render(<ResultGrid columns={columns} rows={many} onCopy={vi.fn()} onSelect={vi.fn()} />)
    const grid = screen.getByRole('grid', { name: 'Result' })
    const firstRow = () => screen.getAllByRole('rowheader')[0].textContent
    expect(firstRow()).toBe('1')
    for (const top of [400, 2_000, 6_000]) { grid.scrollTop = top; fireEvent.scroll(grid) }
    expect(firstRow(), 'nothing moves before the frame').toBe('1')
    expect(frames.length).toBeGreaterThan(0)
    act(() => { frames.at(-1)!(performance.now()) })
    expect(Number(firstRow())).toBeGreaterThan(100)
  })

  it('filters a large result after a pause in typing, and a small one at once', () => {
    const small = render(<ResultGrid columns={columns} rows={rows} onCopy={vi.fn()} onSelect={vi.fn()} />)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'text 3' } })
    expect(screen.getAllByRole('rowheader').map(cell => cell.textContent), 'a small result filters at once').toEqual(['4'])
    small.unmount()

    vi.useFakeTimers()
    const large: unknown[][] = Array.from({ length: 6_000 }, (_, i) => [i + 1, null, `row ${i}`])
    render(<ResultGrid columns={columns} rows={large} onCopy={vi.fn()} onSelect={vi.fn()} />)
    const box = screen.getByRole('searchbox')
    for (const text of ['r', 'ro', 'row 5999']) fireEvent.change(box, { target: { value: text } })
    expect(box).toHaveValue('row 5999')
    expect(screen.getAllByRole('rowheader')[0].textContent, 'not filtered while typing').toBe('1')
    act(() => { vi.advanceTimersByTime(150) })
    expect(screen.getAllByRole('rowheader').map(cell => cell.textContent), 'filtered once, after the pause').toEqual(['6000'])
    const source = readFileSync(join(process.cwd(), 'src/components/OxeQuery/ResultGrid.tsx'), 'utf8')
    expect(source).toMatch(/viewOrder\(rows, appliedFilter/)
  })

  it('leaves no resize listener behind when it unmounts in the middle of a resize', () => {
    const added: string[] = []
    const removed: string[] = []
    const add = window.addEventListener.bind(window)
    const remove = window.removeEventListener.bind(window)
    vi.spyOn(window, 'addEventListener').mockImplementation((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => { added.push(type); add(type, listener, options) })
    vi.spyOn(window, 'removeEventListener').mockImplementation((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) => { removed.push(type); remove(type, listener, options) })
    const view = render(<ResultGrid columns={columns} rows={rows} onCopy={vi.fn()} onSelect={vi.fn()} />)
    fireEvent.mouseDown(screen.getByRole('separator', { name: /doc/ }), { clientX: 100 })
    expect(added.filter(type => type === 'mousemove')).toHaveLength(1)
    view.unmount()
    expect(removed.filter(type => type === 'mousemove'), 'the resize listener goes with the grid').toHaveLength(1)
    expect(removed.filter(type => type === 'mouseup').length).toBeGreaterThanOrEqual(2)
  })
})
