import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import axe from 'axe-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceGroup } from '../src/components/Sidebar/WorkspaceGroup'
import { ThreadHeader } from '../src/components/Threads/ThreadHeader'
import { useWorkspaceStore } from '../src/store/workspace.store'
import { workspaceColorIndex } from '../shared/workspace-color'

afterEach(cleanup)

const workspace = (color: number | null) => ({ id: 'ws-cajui', name: 'cajui-api', rootPath: 'C:/projects/cajui-api', color, panes: [] }) as never

/** Opens the workspace menu and, from its 'Workspace color…' item, the picker dialog. */
async function openPicker(): Promise<HTMLElement> {
  fireEvent.click(screen.getByTestId('ws-group-settings-btn'))
  const menu = screen.getByRole('menu')
  // CR-07: no radiogroup inside role=menu.
  expect(within(menu).queryByRole('radiogroup')).toBeNull()
  fireEvent.click(within(menu).getByRole('menuitem', { name: 'Workspace color…' }))
  expect(screen.queryByRole('menu')).toBeNull()
  return screen.findByRole('dialog')
}

describe('A8 · workspace color in the renderer', () => {
  const updateSettings = vi.fn(async () => {})
  beforeEach(() => {
    updateSettings.mockClear()
    useWorkspaceStore.setState({ updateSettings } as never)
  })

  it('marks the workspace card with the chosen color, or the derived one', () => {
    const { rerender } = render(<WorkspaceGroup workspace={workspace(3)} isActive={false} onSelect={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByTestId('sidebar-workspace-item')).toHaveAttribute('data-ws', '3')
    rerender(<WorkspaceGroup workspace={workspace(null)} isActive={false} onSelect={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByTestId('sidebar-workspace-item')).toHaveAttribute('data-ws', String(workspaceColorIndex({ id: 'ws-cajui', color: null })))
  })

  it('opens the picker from a menu item, names the eight swatches by the palette, and saves through updateSettings', async () => {
    render(<WorkspaceGroup workspace={workspace(2)} isActive={false} onSelect={vi.fn()} onClose={vi.fn()} />)
    const dialog = await openPicker()
    const group = within(dialog).getByRole('radiogroup', { name: 'Workspace color' })
    expect(group.querySelectorAll('[role="radio"]')).toHaveLength(9)
    for (const name of ['Caatinga', 'Sertão', 'Açude', 'Juazeiro', 'Xique-xique', 'Barro', 'Fim de tarde', 'Pedra']) {
      expect(within(group).getByRole('radio', { name })).toBeInTheDocument()
    }
    expect(within(group).getByRole('radio', { name: 'Sertão' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(within(group).getByRole('radio', { name: 'Barro' }))
    expect(updateSettings).toHaveBeenCalledWith({ workspaceId: 'ws-cajui', color: 6 })
  })

  it('Automatic clears the stored color', async () => {
    render(<WorkspaceGroup workspace={workspace(5)} isActive={false} onSelect={vi.fn()} onClose={vi.fn()} />)
    const dialog = await openPicker()
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Automatic color' }))
    expect(updateSettings).toHaveBeenCalledWith({ workspaceId: 'ws-cajui', color: null })
  })

  it('the open picker has no axe violations (wcag2a/aa)', async () => {
    render(<WorkspaceGroup workspace={workspace(4)} isActive={false} onSelect={vi.fn()} onClose={vi.fn()} />)
    const dialog = await openPicker()
    // jsdom does not lay out or paint, so contrast is measured in the visual and axe CI runs instead.
    const results = await axe.run(dialog, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] }, rules: { 'color-contrast': { enabled: false } } })
    expect(results.violations.map(violation => `${violation.id}: ${violation.help}`)).toEqual([])
  })

  it('marks the conversation header with the workspace color and shows the workspace chip, and nothing without a workspace', () => {
    const props = { pending: false, running: false, onTogglePanel: vi.fn(), onCommand: vi.fn(), onDelegate: vi.fn(), onPin: vi.fn() }
    const { container, rerender } = render(<ThreadHeader {...props} workspace={workspace(7)} />)
    const header = container.querySelector('header.thread-heading')
    expect(header).toHaveAttribute('data-ws', '7')
    expect(header?.querySelector('.thread-heading-context')).toHaveTextContent('cajui-api')
    rerender(<ThreadHeader {...props} />)
    expect(container.querySelector('header.thread-heading')).not.toHaveAttribute('data-ws')
  })
})
