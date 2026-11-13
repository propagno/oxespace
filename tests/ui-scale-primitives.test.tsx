import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DockPanel, PaneHeader, SidebarFilter, SidebarGroup, SidebarHeader, SidebarRow, SidebarSection } from '../src/ui'

afterEach(cleanup)

/** OXE-48: the primitives the 1.5.2 redesign (BRD-01..07) builds on, and the scale they read. */
describe('sidebar anatomy', () => {
  it('a header names the sidebar and keeps its actions and collapse in order', () => {
    render(<SidebarHeader title="Workspaces" actions={<button type="button">New workspace</button>} collapse={<button type="button">Collapse</button>} />)
    expect(screen.getByText('Workspaces')).toBeInTheDocument()
    const buttons = screen.getAllByRole('button').map(button => button.textContent)
    expect(buttons).toEqual(['New workspace', 'Collapse'])
  })

  it('the filter is a search field that forwards its props', () => {
    const change = vi.fn()
    render(<SidebarFilter aria-label="Filter workspaces" placeholder="Filter" hint="/" onChange={change} />)
    const input = screen.getByRole('searchbox', { name: 'Filter workspaces' })
    fireEvent.change(input, { target: { value: 'pix' } })
    expect(change).toHaveBeenCalled()
    expect(screen.getByText('/')).toBeInTheDocument()
  })

  it('rows select by click and by Enter or Space, and say which one is current', () => {
    const select = vi.fn()
    render(<>
      <SidebarSection label="Projects" />
      <SidebarGroup title="pix-api" meta="4" onSelect={select} />
      <SidebarRow title="Add a Pix refund endpoint" meta="9m" detail="Asks to run a migration" selected onSelect={select} />
    </>)
    const row = screen.getByRole('button', { name: /Add a Pix refund endpoint/ })
    expect(row).toHaveAttribute('aria-current', 'true')
    expect(screen.getByText('Asks to run a migration')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /pix-api/ }))
    fireEvent.keyDown(row, { key: 'Enter' })
    fireEvent.keyDown(row, { key: ' ' })
    expect(select).toHaveBeenCalledTimes(3)
  })

  it('a row without onSelect is not a button', () => {
    render(<SidebarRow title="dev server" />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('pane header', () => {
  it('shows the branch only when it is known', () => {
    const { rerender } = render(<PaneHeader title="api" branch="oxe/t142" meta="44m" />)
    expect(screen.getByText('oxe/t142')).toBeInTheDocument()
    rerender(<PaneHeader title="api" branch={null} meta="44m" />)
    expect(screen.queryByText(/branch/i)).toBeNull()
    expect(screen.getByText('api')).toBeInTheDocument()
  })
})

describe('dock panel', () => {
  it('is a named region with the header in a fixed order and an optional toolbar and footer', () => {
    render(<DockPanel title="Changes" count="3 files" actions={<button type="button">Review all</button>} close={<button type="button">Close</button>} toolbar={<span>filter</span>} footer={<span>footer</span>}>body</DockPanel>)
    const region = screen.getByRole('region', { name: 'Changes' })
    expect(region).toHaveTextContent('Changes3 filesReview allClosefilterbodyfooter')
    expect(screen.getByRole('heading', { name: 'Changes' })).toBeInTheDocument()
  })
})

describe('the primitives read the 1.5.2 scale', () => {
  const css = (name: string): string => readFileSync(join(__dirname, '..', 'src', 'ui', name), 'utf8')
  it('tabs sit in a --bar-md bar with a 12px label; buttons are 12px at sm and md, 13px at lg', () => {
    expect(css('Display.module.css')).toMatch(/\.tab \{[^}]*height: var\(--bar-md\)[^}]*font-size: var\(--text-xs\)/)
    const button = css('Button.module.css')
    expect(button).toMatch(/\.button \{[^}]*font-size: var\(--text-xs\)/)
    expect(button).toMatch(/\.lg \{[^}]*font-size: var\(--text-sm\)/)
  })
  it('sidebar rows are --row-1 and its bars --bar-lg; the pane header is --bar-md', () => {
    const sidebar = css('Sidebar.module.css')
    expect(sidebar).toMatch(/\.row \{[^}]*min-height: var\(--row-1\)/)
    expect(sidebar).toMatch(/\.header \{[^}]*height: var\(--bar-lg\)/)
    expect(css('PaneHeader.module.css')).toMatch(/\.header \{[^}]*height: var\(--bar-md\)/)
  })
})
