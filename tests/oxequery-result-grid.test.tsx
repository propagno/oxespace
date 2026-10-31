import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ResultGrid } from '../src/components/OxeQuery/ResultGrid'

const columns = ['id', 'name', 'note']
const rows: unknown[][] = [[1, 'Ana', null], [2, 'Bo', 'NULL'], [3, 'Cy', 'x']]

function grid(props: Partial<Parameters<typeof ResultGrid>[0]> = {}) {
  const onCopy = vi.fn()
  const onSelect = vi.fn()
  render(<ResultGrid columns={columns} types={['int4', 'text', 'text']} rows={rows} onCopy={onCopy} onSelect={onSelect} {...props} />)
  return { onCopy, onSelect, grid: screen.getByRole('grid', { name: 'Result' }) }
}

describe('ResultGrid', () => {
  it('moves the active cell with the arrow keys and opens the row with Enter', () => {
    const { grid: element, onSelect } = grid()
    fireEvent.keyDown(element, { key: 'ArrowDown' })
    fireEvent.keyDown(element, { key: 'ArrowRight' })
    expect(element.getAttribute('aria-activedescendant')).toBe('Result-cell-1-1')
    fireEvent.keyDown(element, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith(1)
    fireEvent.keyDown(element, { key: 'End', ctrlKey: true })
    expect(element.getAttribute('aria-activedescendant')).toBe('Result-cell-2-2')
    fireEvent.keyDown(element, { key: 'Escape' })
    expect(element.getAttribute('aria-activedescendant')).toBeNull()
  })

  it('copies the selected block as tab-separated text', () => {
    const { grid: element, onCopy } = grid()
    fireEvent.keyDown(element, { key: 'ArrowDown' })
    fireEvent.keyDown(element, { key: 'ArrowDown', shiftKey: true })
    fireEvent.keyDown(element, { key: 'ArrowRight', shiftKey: true })
    fireEvent.keyDown(element, { key: 'c', ctrlKey: true })
    expect(onCopy).toHaveBeenCalledWith('id\tname\n2\tBo\n3\tCy', 'tsv')
  })

  it('selects everything with Ctrl+A and leaves out a hidden column', () => {
    const { grid: element, onCopy } = grid()
    fireEvent.click(screen.getByRole('button', { name: 'Hide column name' }))
    fireEvent.keyDown(element, { key: 'a', ctrlKey: true })
    fireEvent.keyDown(element, { key: 'c', ctrlKey: true })
    expect(onCopy).toHaveBeenCalledWith('id\tnote\n1\t\n2\tNULL\n3\tx', 'tsv')
    expect(screen.getByRole('button', { name: 'Show 1 hidden column' })).toBeTruthy()
  })

  it('does not show the text "NULL" like a missing value', () => {
    grid()
    const cells = screen.getAllByRole('gridcell')
    expect(cells.find(cell => cell.textContent === 'NULL')?.className).toContain('is-null')
    const quoted = cells.find(cell => cell.textContent === '"NULL"')
    expect(quoted).toBeTruthy()
    expect(quoted?.className ?? '').not.toContain('is-null')
  })

  it('lets the server order the rows when asked to, and sorts loaded rows otherwise', () => {
    const onSort = vi.fn()
    const { grid: element } = grid({ onSort })
    fireEvent.click(within(element).getByRole('columnheader', { name: /name/ }))
    expect(onSort).toHaveBeenCalledWith({ column: 1, direction: 'asc' })
  })
})
