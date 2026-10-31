import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EMPTY_FILTER, parsePgArray, pinColumns, pinOffsets, readCell, viewOrder } from '../src/components/OxeQuery/grid-model'
import { ArrayList, JsonTree } from '../src/components/OxeQuery/CellValue'
import { CellViewer } from '../src/components/OxeQuery/WorkbenchPanels'
import { ResultGrid } from '../src/components/OxeQuery/ResultGrid'

const rows: unknown[][] = [[1, 'Ana', null], [2, 'Bo', 'NULL'], [3, 'Cy', 'x'], [10, 'ana maria', 'y']]

describe('viewOrder', () => {
  it('returns null when nothing filters or sorts', () => {
    expect(viewOrder(rows, EMPTY_FILTER, null)).toBeNull()
  })
  it('filters by text in any column, case-insensitively, NULL included', () => {
    expect(viewOrder(rows, { text: 'ANA', columns: {} }, null)).toEqual([0, 3])
    expect(viewOrder(rows, { text: 'null', columns: {} }, null)).toEqual([0, 1])
  })
  it('filters by one column and combines with the any-column text', () => {
    expect(viewOrder(rows, { text: '', columns: { 2: 'x' } }, null)).toEqual([2])
    expect(viewOrder(rows, { text: 'ana', columns: { 0: '1' } }, null)).toEqual([0, 3])
    expect(viewOrder(rows, { text: 'zzz', columns: {} }, null)).toEqual([])
  })
  it('sorts only the rows that passed, numbers as numbers', () => {
    expect(viewOrder(rows, { text: 'a', columns: {} }, { column: 0, direction: 'desc' })).toEqual([3, 0])
    expect(viewOrder(rows, EMPTY_FILTER, { column: 0, direction: 'desc' })).toEqual([3, 2, 1, 0])
  })
})

describe('pinning', () => {
  it('moves pinned columns first, keeping each group in order', () => {
    expect(pinColumns([0, 1, 2, 3], new Set([2, 1]))).toEqual([1, 2, 0, 3])
  })
  it('stacks the offsets of pinned columns after the row-number column', () => {
    const order = pinColumns([0, 1, 2], new Set([2]))
    expect([...pinOffsets(order, new Set([2]), () => 100, 56)]).toEqual([[2, 56]])
    expect([...pinOffsets(pinColumns([0, 1, 2], new Set([1, 2])), new Set([1, 2]), column => column * 10 + 50, 56)]).toEqual([[1, 56], [2, 116]])
  })
})

describe('readCell', () => {
  it('reads json text and objects, and leaves plain text alone', () => {
    expect(readCell('{"a":[1,2]}', 'jsonb')).toEqual({ kind: 'json', data: { a: [1, 2] } })
    expect(readCell({ a: 1 })).toEqual({ kind: 'json', data: { a: 1 } })
    expect(readCell('hello', 'text')).toEqual({ kind: 'other' })
    expect(readCell('{not json', 'jsonb')).toEqual({ kind: 'other' })
    expect(readCell('"quoted"', 'jsonb')).toEqual({ kind: 'other' })
    expect(readCell(null, 'jsonb')).toEqual({ kind: 'other' })
  })
  it('reads arrays from JS arrays and from PostgreSQL literals of array types', () => {
    expect(readCell([1, null, 'a'])).toEqual({ kind: 'array', items: ['1', null, 'a'] })
    expect(readCell('{1,2,NULL}', 'integer[]')).toEqual({ kind: 'array', items: ['1', '2', null] })
    expect(readCell('{a,b}', '_text')).toEqual({ kind: 'array', items: ['a', 'b'] })
    expect(readCell('{a,b}', 'text')).toEqual({ kind: 'other' })
  })
  it('parses quoting, escapes, empties and nested arrays', () => {
    expect(parsePgArray('{"a, b","c\\"d",NULL,"NULL"}')).toEqual(['a, b', 'c"d', null, 'NULL'])
    expect(parsePgArray('{}')).toEqual([])
    expect(parsePgArray('{{1,2},{3}}')).toEqual(['{1,2}', '{3}'])
    expect(parsePgArray('not an array')).toBeNull()
  })
})

describe('JsonTree', () => {
  const data = { name: 'Ana', tags: ['a', 'b'], deep: { level: { two: { three: 3 } } }, nothing: null }
  it('shows values, folds a node and reopens it', () => {
    render(<JsonTree data={data} />)
    expect(screen.getByText('"Ana"')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Collapse tags' }))
    expect(screen.queryByText('"b"')).toBeNull()
    expect(screen.getByText(/2 items/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Expand tags' }))
    expect(screen.getByText('"b"')).toBeTruthy()
  })
  it('collapses everything and expands everything', () => {
    render(<JsonTree data={data} />)
    expect(screen.queryByText('3')).toBeNull() // deeper than the default open depth
    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }))
    expect(screen.getByText('3')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }))
    expect(screen.queryByText('"Ana"')).toBeNull()
  })
})

describe('ArrayList', () => {
  it('lists elements with NULL marked and a count', () => {
    render(<ArrayList items={['x', null]} />)
    const list = screen.getByRole('list', { name: 'Array elements' })
    expect(within(list).getAllByRole('listitem').map(item => item.textContent)).toEqual(['x', 'NULL'])
    expect(screen.getByText('2 items')).toBeTruthy()
  })
})

describe('CellViewer', () => {
  it('shows a jsonb cell as a tree and copies it pretty-printed', () => {
    const onCopy = vi.fn()
    render(<CellViewer cell={{ column: 'doc', type: 'jsonb', value: '{"a":1}', row: 0 }} onCopy={onCopy} onClose={() => undefined} />)
    expect(screen.getByRole('group', { name: 'JSON document' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect(onCopy).toHaveBeenCalledWith('{\n  "a": 1\n}')
  })
  it('shows an array column as a list and plain text as text', () => {
    const { unmount } = render(<CellViewer cell={{ column: 'tags', type: 'text[]', value: '{a,b}', row: 1 }} onCopy={() => undefined} onClose={() => undefined} />)
    expect(screen.getByRole('list', { name: 'Array elements' })).toBeTruthy()
    unmount()
    render(<CellViewer cell={{ column: 'note', type: 'text', value: 'hi', row: 1 }} onCopy={() => undefined} onClose={() => undefined} />)
    expect(screen.queryByRole('list')).toBeNull()
    expect(screen.getByText('hi')).toBeTruthy()
  })
})

describe('ResultGrid filter and pin', () => {
  const columns = ['id', 'name', 'note']
  const bodyNames = (): string[] => screen.getAllByRole('gridcell').filter(cell => cell.id.endsWith('-1')).map(cell => cell.textContent ?? '')

  it('filters the loaded rows without calling for more, and clears', () => {
    render(<ResultGrid columns={columns} rows={rows} onCopy={() => undefined} />)
    expect(bodyNames()).toHaveLength(4)
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter loaded rows' }), { target: { value: 'ana' } })
    expect(bodyNames()).toEqual(['Ana', 'ana maria'])
    expect(screen.getByRole('status').textContent).toBe('2 of 4 loaded rows')
    fireEvent.click(screen.getByRole('button', { name: 'Clear filter' }))
    expect(bodyNames()).toHaveLength(4)
  })
  it('filters one chosen column only', () => {
    render(<ResultGrid columns={columns} rows={rows} onCopy={() => undefined} />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter column' }), { target: { value: '2' } })
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter loaded rows' }), { target: { value: 'x' } })
    expect(bodyNames()).toEqual(['Cy'])
  })
  it('shows an empty result for a filter that matches nothing, and keeps the sort', () => {
    render(<ResultGrid columns={columns} rows={rows} onCopy={() => undefined} />)
    fireEvent.click(screen.getByRole('columnheader', { name: /id/ }))
    fireEvent.click(screen.getByRole('columnheader', { name: /id/ }))
    expect(bodyNames()[0]).toBe('ana maria')
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter loaded rows' }), { target: { value: 'zzz' } })
    expect(screen.queryAllByRole('gridcell')).toHaveLength(0)
  })
  it('pins a column to the left edge and moves it first', () => {
    render(<ResultGrid columns={columns} rows={rows} onCopy={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: 'Pin column note' }))
    const headers = screen.getAllByRole('columnheader').slice(1)
    expect(headers[0].textContent).toContain('note')
    expect(headers[0].style.position).toBe('sticky')
    expect(headers[0].style.left).toBe('56px')
    fireEvent.click(screen.getByRole('button', { name: 'Unpin column note' }))
    expect(screen.getAllByRole('columnheader').slice(1)[0].textContent).toContain('id')
  })
})
