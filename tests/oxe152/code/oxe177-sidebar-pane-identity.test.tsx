// Acceptance test for 1.5.2 OxeCode (Jira OXE-177, CA-1 to CA-3).
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { PaneSessionRow } from '../../../src/components/Sidebar/PaneSessionRow'
import { useTerminalStore } from '../../../src/store/terminal.store'
import type { Workspace, WorkspacePane } from '../../../shared/types/workspace'

const baseWorkspace = {
  id: 'ws-177',
  name: 'oxespace',
  rootPath: '/tmp/oxespace',
  panes: [],
  layout: { type: 'leaf', paneId: 'pane-1' },
  activePaneId: 'pane-1'
} as unknown as Workspace

function makePane(overrides: Partial<WorkspacePane> = {}): WorkspacePane {
  return {
    id: 'pane-1',
    type: 'terminal',
    shellProfileId: 'builtin-pwsh',
    ...overrides
  } as WorkspacePane
}

afterEach(() => {
  cleanup()
  useTerminalStore.setState({ panes: {}, pendingCommands: {}, activePaneId: null })
})

describe('OXE-177 · Sidebar terminal row uses resolvePaneIdentity', () => {
  test('agent terminal row uses resolvePaneIdentity with provider icon and task instead of terminal N', () => {
    const pane = makePane({ id: 'pane-claude', shellProfileId: 'builtin-pwsh' })
    useTerminalStore.getState().setStatus('pane-claude', 'running')
    useTerminalStore.getState().setAgentState('pane-claude', 'working', 'hook', 'claude')
    useTerminalStore.getState().setLastIntent('pane-claude', 'fix sidebar identity')

    const { container } = render(
      <PaneSessionRow
        pane={pane}
        paneIndex={0}
        workspace={baseWorkspace}
        isActive={false}
        agentProfiles={[]}
        onClick={vi.fn()}
        onActivatePane={vi.fn()}
      />
    )

    expect(screen.getByText('Claude · fix sidebar identity')).toBeInTheDocument()
    expect(screen.queryByText('terminal 1')).toBeNull()
    expect(container.querySelector('.agent-provider-icon')).not.toBeNull()

    cleanup()
    const launcherPane = makePane({ id: 'pane-launcher', shellProfileId: 'builtin-claude' })
    render(
      <PaneSessionRow
        pane={launcherPane}
        paneIndex={1}
        workspace={baseWorkspace}
        isActive={false}
        agentProfiles={[]}
        onClick={vi.fn()}
        onActivatePane={vi.fn()}
      />
    )
    expect(screen.getByText('Claude')).toBeInTheDocument()
    expect(screen.queryByText('terminal 2')).toBeNull()
  })

  test('plain terminal row without running agent keeps its existing pane name', () => {
    const plainPane = makePane({ id: 'pane-plain', shellProfileId: 'builtin-pwsh' })
    const { container } = render(
      <PaneSessionRow
        pane={plainPane}
        paneIndex={0}
        workspace={baseWorkspace}
        isActive={false}
        agentProfiles={[]}
        onClick={vi.fn()}
        onActivatePane={vi.fn()}
      />
    )

    expect(screen.getByText('Terminal 1')).toBeInTheDocument()
    expect(container.querySelector('.agent-provider-icon')).toBeNull()

    cleanup()
    const renamedPane = makePane({ id: 'pane-renamed', shellProfileId: 'builtin-claude', displayName: 'API server' })
    render(
      <PaneSessionRow
        pane={renamedPane}
        paneIndex={1}
        workspace={baseWorkspace}
        isActive={false}
        agentProfiles={[]}
        onClick={vi.fn()}
        onActivatePane={vi.fn()}
      />
    )
    expect(screen.getByText('API server')).toBeInTheDocument()
  })

  test('agent sidebar row accessible name matches visible text and status words', () => {
    const pane = makePane({ id: 'pane-a11y', shellProfileId: 'builtin-pwsh' })
    useTerminalStore.getState().setStatus('pane-a11y', 'running')
    useTerminalStore.getState().setAgentState('pane-a11y', 'working', 'hook', 'codex')
    useTerminalStore.getState().setLastIntent('pane-a11y', 'run unit tests')

    render(
      <PaneSessionRow
        pane={pane}
        paneIndex={0}
        workspace={baseWorkspace}
        isActive={false}
        agentProfiles={[]}
        onClick={vi.fn()}
        onActivatePane={vi.fn()}
      />
    )

    const row = screen.getByRole('button')
    const accessibleName = row.textContent?.trim() ?? ''
    expect(accessibleName).toContain('Codex · run unit tests')
    expect(accessibleName).toMatch(/Codex · run unit tests,/)
  })
})
