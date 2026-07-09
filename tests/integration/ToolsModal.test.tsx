import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { ToolsModal } from '../../src/components/Workspace/ToolsModal'
import { useUIStore } from '../../src/store/ui.store'

const inactive = {
  github: false,
  editor: false,
  review: false,
  background: false,
  worktree: false,
  scripts: false,
  webPreview: false,
  integration: false,
  oxe: false
}

const noopHandlers = {
  onOpenCommandPalette: () => undefined,
  onOpenWorkspaceSettings: () => undefined,
  onOpenAgentSettings: () => undefined,
  onToggleEditor: () => undefined,
  onToggleGitHub: () => undefined,
  onToggleReview: () => undefined,
  onToggleBackground: () => undefined,
  onToggleWorktree: () => undefined,
  onToggleScripts: () => undefined,
  onToggleWebPreview: () => undefined,
  onOpenIntegration: () => undefined,
  onOpenHistory: () => undefined,
  onOpenMcp: () => undefined,
  onOpenSkills: () => undefined,
  onOpenSemanticLogs: () => undefined,
  onToggleOxe: () => undefined
}

describe('ToolsModal', () => {
  test('renders tool groups and runs an action then closes', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onToggleEditor = vi.fn()

    render(
      <ToolsModal
        active={inactive}
        onClose={onClose}
        {...noopHandlers}
        onToggleEditor={onToggleEditor}
      />
    )

    expect(screen.getByTestId('tools-modal')).toBeInTheDocument()
    expect(screen.getByTestId('tools-agent-settings')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Open Agent Settings/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /Editor/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /OXE/i })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Search tools…')).toBeInTheDocument()

    await user.click(screen.getByRole('menuitem', { name: /Editor/i }))
    expect(onToggleEditor).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  test('featured Agent Settings opens settings and closes the hub', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onOpenAgentSettings = vi.fn()

    render(
      <ToolsModal
        active={inactive}
        onClose={onClose}
        {...noopHandlers}
        onOpenAgentSettings={onOpenAgentSettings}
      />
    )

    await user.click(screen.getByTestId('tools-agent-settings'))
    expect(onOpenAgentSettings).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  test('filters tools by search query', async () => {
    const user = userEvent.setup()

    render(
      <ToolsModal
        active={inactive}
        onClose={() => undefined}
        {...noopHandlers}
      />
    )

    await user.type(screen.getByPlaceholderText('Search tools…'), 'mcp')
    expect(screen.getByRole('menuitem', { name: /MCP Servers/i })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /GitHub/i })).not.toBeInTheDocument()
  })

  test('Escape closes the modal', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    render(
      <ToolsModal
        active={{ ...inactive, github: true }}
        onClose={onClose}
        {...noopHandlers}
      />
    )

    expect(screen.getByRole('menuitem', { name: /GitHub/i })).toHaveAttribute('aria-pressed', 'true')
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  test('terminal commands stay disabled without an active pane', () => {
    useUIStore.setState({ activePaneId: null })
    render(
      <ToolsModal
        active={inactive}
        onClose={() => undefined}
        {...noopHandlers}
      />
    )

    expect(screen.getByRole('menuitem', { name: /Terminal Commands/i })).toBeDisabled()
  })
})
