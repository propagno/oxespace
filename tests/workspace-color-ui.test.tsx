import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceGroup } from '../src/components/Sidebar/WorkspaceGroup'
import { ThreadHeader } from '../src/components/Threads/ThreadHeader'
import { useWorkspaceStore } from '../src/store/workspace.store'
import { workspaceColorIndex } from '../shared/workspace-color'

afterEach(cleanup)

const workspace = (color: number | null) => ({ id: 'ws-cajui', name: 'cajui-api', rootPath: 'C:/projects/cajui-api', color, panes: [] }) as never

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

  it('offers the eight colors and Automatic in the workspace menu and saves through updateSettings', () => {
    render(<WorkspaceGroup workspace={workspace(2)} isActive={false} onSelect={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByTestId('ws-group-settings-btn'))
    const group = screen.getByRole('radiogroup', { name: 'Workspace color' })
    expect(group.querySelectorAll('[role="radio"]')).toHaveLength(9)
    expect(screen.getByRole('radio', { name: 'Color 2' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('radio', { name: 'Color 6' }))
    expect(updateSettings).toHaveBeenCalledWith({ workspaceId: 'ws-cajui', color: 6 })
  })

  it('Automatic clears the stored color', () => {
    render(<WorkspaceGroup workspace={workspace(5)} isActive={false} onSelect={vi.fn()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByTestId('ws-group-settings-btn'))
    fireEvent.click(screen.getByRole('radio', { name: 'Automatic color' }))
    expect(updateSettings).toHaveBeenCalledWith({ workspaceId: 'ws-cajui', color: null })
  })

  it('marks the conversation header with the workspace color, and nothing without a workspace', () => {
    const props = { pending: false, running: false, onTogglePanel: vi.fn(), onCommand: vi.fn(), onDelegate: vi.fn(), onPin: vi.fn() }
    const { container, rerender } = render(<ThreadHeader {...props} workspace={workspace(7)} />)
    expect(container.querySelector('header.thread-heading')).toHaveAttribute('data-ws', '7')
    rerender(<ThreadHeader {...props} />)
    expect(container.querySelector('header.thread-heading')).not.toHaveAttribute('data-ws')
  })
})
