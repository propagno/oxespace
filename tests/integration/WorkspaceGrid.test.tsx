import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import type { Workspace } from '../../shared/types/workspace'
import { WorkspaceGrid } from '../../src/components/Grid/WorkspaceGrid'
import { useTerminalStore } from '../../src/store/terminal.store'

vi.mock('../../src/components/Panes/PaneContent', () => ({
  PaneContent: () => <div data-testid="pane-content" />
}))

describe('WorkspaceGrid', () => {
  test('shows the actual PTY session identity and launch path separately from the panel', async () => {
    const previousApi = window.oxe
    const status = vi.fn(async () => ({ running: true, seq: 1, altScreen: false, sessionId: 'pty-session-id', launchDirectory: 'C:/repo/worktree', executable: 'C:/Program Files/PowerShell/pwsh.exe', pid: 1234, startedAt: 1700000000000 }))
    const list = vi.fn(async ({ provider }: { provider: string }) => provider === 'codex' ? [{ provider: 'codex', sessionId: 'native-codex-id', firstMessagePreview: 'Review the authentication flow', modelId: 'gpt-test', requestCount: 2, lastUpdatedMs: 1700000000000 }] : [])
    const writeText = vi.fn(async () => true)
    Object.defineProperty(window, 'oxe', { configurable: true, value: { terminal: { status }, session: { list }, clipboard: { writeText } } })
    try {
      const workspace = createWorkspace('1x1'), user = userEvent.setup()
      render(<WorkspaceGrid workspace={workspace} maximizedPaneId={null} onToggleMaximize={() => undefined} />)
      await user.click(screen.getByLabelText('More pane actions'))
      await user.click(screen.getByRole('menuitem', { name: 'Detalhes' }))
      expect(screen.getByText('pty-session-id')).not.toBeVisible()
      await user.click(screen.getByText('IDs internos e processo do terminal'))
      await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent('pty-session-id'))
      expect(status).toHaveBeenCalledWith('pane-0-0')
      expect(screen.getByRole('dialog')).toHaveTextContent('C:/repo/worktree')
      expect(screen.getByRole('dialog')).toHaveTextContent('pane-0-0')
      expect(screen.getByRole('dialog')).toHaveTextContent('1234')
      await user.click(screen.getByRole('button', { name: 'Encontrar sessões do Codex ou Claude' }))
      await waitFor(() => expect(screen.getByRole('dialog', { name: 'Sessões do Codex e Claude' })).toHaveTextContent('Review the authentication flow'))
      expect(list).toHaveBeenCalledWith({ workspaceId: 'workspace-1', workspaceRootPath: 'C:/repo', provider: 'codex' })
      await user.click(screen.getByRole('button', { name: 'Copiar ID da sessão codex native-codex-id' }))
      expect(writeText).toHaveBeenCalledWith('native-codex-id')
      await user.click(screen.getByRole('button', { name: 'Copiar comando para retomar codex native-codex-id' }))
      expect(writeText).toHaveBeenCalledWith('codex resume native-codex-id')
      await user.keyboard('{Escape}')
    } finally { Object.defineProperty(window, 'oxe', { configurable: true, value: previousApi }) }
  })
  test('renders all panes in a 4x4 workspace and toggles maximize', async () => {
    const user = userEvent.setup()
    const onToggleMaximize = vi.fn()
    const workspace = createWorkspace('4x4')

    render(<WorkspaceGrid workspace={workspace} maximizedPaneId={null} onToggleMaximize={onToggleMaximize} />)

    expect(screen.getAllByTestId('pane-container')).toHaveLength(16)

    await user.click(screen.getAllByLabelText('Maximize pane')[0])
    expect(onToggleMaximize).toHaveBeenCalledWith('pane-0-0')
  })

  test('keeps all panes mounted when maximized so terminals keep scroll state', () => {
    const workspace = createWorkspace('2x2')

    render(<WorkspaceGrid workspace={workspace} maximizedPaneId="pane-0-1" onToggleMaximize={() => undefined} />)

    // Still 4 pane hosts in the DOM — maximize is CSS/layout, not unmount.
    expect(screen.getAllByTestId('pane-container')).toHaveLength(4)
    expect(screen.getByLabelText('Restore pane')).toBeInTheDocument()
    expect(screen.getByTestId('workspace-grid')).toHaveAttribute('data-maximized-pane', 'pane-0-1')
    expect(screen.getByTestId('workspace-grid').className).toContain('workspace-grid--maximized')
  })

  test('does not render editor controls inside terminal panes', () => {
    const workspace = createWorkspace('1x1')

    render(<WorkspaceGrid workspace={workspace} maximizedPaneId={null} onToggleMaximize={() => undefined} />)

    expect(screen.queryByRole('button', { name: 'Open editor in pane' })).not.toBeInTheDocument()
  })

  test('keeps only search + expand visible; secondary actions live in ⋯ menu', async () => {
    const user = userEvent.setup()
    const workspace = createWorkspace('1x1')

    render(<WorkspaceGrid workspace={workspace} maximizedPaneId={null} onToggleMaximize={() => undefined} />)

    expect(screen.getByLabelText('Search in terminal')).toBeInTheDocument()
    expect(screen.getByLabelText('Maximize pane')).toBeInTheDocument()
    expect(screen.getByLabelText('More pane actions')).toBeInTheDocument()

    // Hidden until the kebab is opened.
    expect(screen.queryByRole('menuitem', { name: /Limpar terminal/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /Nova sessão/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /Dividir vertical/i })).not.toBeInTheDocument()

    await user.click(screen.getByLabelText('More pane actions'))

    expect(screen.getByTestId('pane-actions-menu')).toBeInTheDocument()
    expect(screen.queryByText('Não iniciado')).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Detalhes' })).toBeEnabled()
    expect(screen.getByRole('menuitem', { name: /Limpar terminal/i })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: /Nova sessão/i })).toBeEnabled()
    expect(screen.getByRole('menuitem', { name: /Dividir vertical/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Dividir horizontal/i })).toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: 'Detalhes' }))
    expect(screen.queryByTestId('pane-actions-menu')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Detalhes do terminal' })).toHaveTextContent('Não iniciado')
    act(() => useTerminalStore.getState().setStatus('pane-0-0', 'running'))
    expect(screen.getByRole('dialog', { name: 'Detalhes do terminal' })).toHaveTextContent('Em execução')
    act(() => useTerminalStore.getState().setStatus('pane-0-0', 'error', 'Session ended unexpectedly'))
    expect(screen.getByRole('dialog', { name: 'Detalhes do terminal' })).toHaveTextContent('Session ended unexpectedly')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    act(() => useTerminalStore.getState().removePane('pane-0-0'))
  })
})

function createWorkspace(layout: Workspace['layout']): Workspace {
  const [rows, columns] = layout.split('x').map(Number)
  return {
    id: 'workspace-1',
    name: 'repo',
    rootPath: 'C:/repo',
    layout,
    layoutPreset: rows * columns === 16 ? 16 : rows * columns === 4 ? 4 : 1,
    themeId: 'midnight',
    uiDensity: 'compact',
    defaultShellProfileId: 'builtin-claude',
    autoStart: false,
    isActive: true,
    panes: Array.from({ length: rows * columns }, (_, index) => {
      const rowIndex = Math.floor(index / columns)
      const columnIndex = index % columns
      return {
        id: `pane-${rowIndex}-${columnIndex}`,
        workspaceId: 'workspace-1',
        type: 'terminal',
        rowIndex,
        columnIndex,
        shellProfileId: 'builtin-claude',
        status: 'idle'
      }
    })
  }
}
