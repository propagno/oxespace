import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentProfile } from '../../../shared/types/agent'
import type { TerminalStatusResult } from '../../../shared/types/ipc'
import type { Workspace, WorkspacePane } from '../../../shared/types/workspace'
import { changeLanguage } from '../../../src/i18n'
import { useAgentResumeStore } from '../../../src/store/agent-resume.store'
import { useTerminalStore } from '../../../src/store/terminal.store'
import { useWorkspaceStore } from '../../../src/store/workspace.store'
import { useToasts } from '../../../src/ui/Toast'

vi.mock('../../../src/hooks/useGitBranch', () => ({ useGitBranch: () => ({ branch: 'main', detached: false, shortSha: null, error: null }) }))
vi.mock('../../../src/components/Panes/PaneContent', () => ({ PaneContent: () => null }))
vi.mock('../../../src/components/Panes/PaneBranchBadge', () => ({ PaneBranchBadge: () => null }))
const { PaneContainer } = await import('../../../src/components/Grid/PaneContainer')

const AGY_SESSION_ID = '2d6935d8-25b4-4917-a0cd-b4f8cdd54ab4'
const CLAUDE_SESSION_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'
const CODEX_SESSION_ID = '019a5c1e-7b2d-7c3e-9f00-112233445566'

function makeAgentProfile(provider: 'antigravity' | 'claude' | 'codex'): AgentProfile {
  const names = { antigravity: 'Antigravity', claude: 'Claude', codex: 'Codex' } as const
  const commands = { antigravity: 'agy', claude: 'claude', codex: 'codex' } as const
  return {
    agentProfileId: `builtin-agent-${provider}`,
    name: names[provider],
    provider,
    command: commands[provider],
    isBuiltin: true
  } as AgentProfile
}

function makeWorkspace(paneOverrides: Partial<WorkspacePane> = {}): { workspace: Workspace; pane: WorkspacePane } {
  const pane: WorkspacePane = {
    id: 'pane-oxe467',
    workspaceId: 'ws-oxe467',
    type: 'terminal',
    rowIndex: 0,
    columnIndex: 0,
    status: 'running',
    agentProfileId: 'builtin-agent-antigravity',
    agentName: 'Antigravity',
    displayName: 'Agent Pane',
    shellProfileId: null,
    rootPath: null,
    createdAt: null,
    ...paneOverrides
  } as WorkspacePane
  const workspace = {
    id: 'ws-oxe467',
    name: 'oxespace',
    rootPath: 'C:/repo/oxespace',
    defaultShellProfileId: 'builtin-powershell',
    panes: [pane],
    shellProfiles: []
  } as unknown as Workspace
  return { workspace, pane }
}

function installOxeApi(statusImpl: (paneId: string) => Promise<TerminalStatusResult>) {
  const writeText = vi.fn(async () => true)
  const status = vi.fn(statusImpl)
  ;(window as unknown as { oxe: unknown }).oxe = {
    terminal: { status, onActivity: () => () => undefined },
    clipboard: { writeText },
    agentHooks: { status: async () => [] }
  }
  return { status, writeText }
}

async function openDetailsDialog(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  await user.click(screen.getByRole('button', { name: /More pane actions|Mais ações do painel/i }))
  await user.click(await screen.findByRole('menuitem', { name: /^Details$|^Detalhes$/i }))
  return await screen.findByRole('dialog', { name: /Terminal details|Detalhes do terminal/i })
}

beforeEach(async () => {
  await changeLanguage('en')
  vi.stubGlobal('ResizeObserver', class { observe() { /* noop */ } unobserve() { /* noop */ } disconnect() { /* noop */ } })
  useAgentResumeStore.getState().reset()
  useToasts.setState({ items: [] })
  useTerminalStore.setState({
    panes: {
      'pane-oxe467': {
        status: 'running',
        error: null,
        lastActivityAt: Date.now(),
        lastOutput: null,
        lastIntent: null,
        lastIntentAt: null,
        isWorking: false,
        hasUnread: false,
        shellCommand: null
      }
    }
  } as never)
})

afterEach(async () => {
  cleanup()
  vi.unstubAllGlobals()
  delete (window as unknown as { oxe?: unknown }).oxe
  await changeLanguage('en')
})

describe('OXE-467 · OxeCode Terminal details modal cleanup & provider session ID display', () => {
  it('renders captured Antigravity session ID with 1-click copy and omits the removed Find button and manual lookup note', async () => {
    const user = userEvent.setup()
    const { workspace, pane } = makeWorkspace()
    useWorkspaceStore.setState({ workspaces: [workspace], activeWorkspaceId: workspace.id, shellProfiles: [] })
    const { writeText } = installOxeApi(async () => ({
      running: true,
      seq: 1,
      altScreen: true,
      sessionId: 'pty-internal-1',
      agentSession: {
        agent: 'antigravity',
        sessionId: AGY_SESSION_ID,
        source: 'discovered',
        resumeCommand: `agy --resume ${AGY_SESSION_ID}`
      }
    }))

    render(
      <PaneContainer
        pane={pane}
        workspace={workspace}
        agentProfile={makeAgentProfile('antigravity')}
        autoStart={false}
        isMaximized={false}
        onToggleMaximize={() => undefined}
      />
    )

    const dialog = await openDetailsDialog(user)
    const idEl = await within(dialog).findByTestId('terminal-provider-session-id')
    expect(idEl).toHaveTextContent(AGY_SESSION_ID)
    expect(within(dialog).getByTestId('terminal-provider-session-source')).toHaveTextContent('Detected automatically from local sessions')

    // Removed manual Find button & explanatory helper paragraph must NOT exist.
    expect(within(dialog).queryByRole('button', { name: /Find Codex or Claude sessions/i })).toBeNull()
    expect(dialog.textContent).not.toMatch(/Find Codex or Claude sessions/i)
    expect(dialog.textContent).not.toMatch(/The terminal does not report which Codex or Claude conversation is open/i)

    // 1-click copy writes the exact native session UUID and shows confirmation.
    const copyBtn = within(dialog).getByTestId('terminal-provider-session-copy')
    await user.click(copyBtn)
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(AGY_SESSION_ID))
    expect(copyBtn).toHaveTextContent('Copied')
    expect(useToasts.getState().items.map(item => item.title)).toContain('Provider session ID copied')
  })

  it('renders captured Claude and Codex native session IDs with copy support', async () => {
    const user = userEvent.setup()
    for (const [provider, sessionId, source, sourceText] of [
      ['claude', CLAUDE_SESSION_ID, 'launch', 'Set when OXESpace started the agent'],
      ['codex', CODEX_SESSION_ID, 'hook', 'Reported by the agent’s status hook']
    ] as const) {
      const { workspace, pane } = makeWorkspace({ agentProfileId: `builtin-agent-${provider}`, agentName: provider })
      useWorkspaceStore.setState({ workspaces: [workspace], activeWorkspaceId: workspace.id, shellProfiles: [] })
      const { writeText } = installOxeApi(async () => ({
        running: true,
        seq: 1,
        altScreen: false,
        sessionId: 'pty-internal-2',
        agentSession: {
          agent: provider,
          sessionId,
          source,
          resumeCommand: provider === 'claude' ? `claude --resume ${sessionId}` : `codex resume ${sessionId} --no-alt-screen`
        }
      }))

      render(
        <PaneContainer
          pane={pane}
          workspace={workspace}
          agentProfile={makeAgentProfile(provider)}
          autoStart={false}
          isMaximized={false}
          onToggleMaximize={() => undefined}
        />
      )

      const dialog = await openDetailsDialog(user)
      expect(await within(dialog).findByTestId('terminal-provider-session-id')).toHaveTextContent(sessionId)
      expect(within(dialog).getByTestId('terminal-provider-session-source')).toHaveTextContent(sourceText)
      await user.click(within(dialog).getByTestId('terminal-provider-session-copy'))
      await waitFor(() => expect(writeText).toHaveBeenCalledWith(sessionId))
      cleanup()
    }
  })

  it('shows Detecting… while reading and Not reported yet when no session exists yet, cleanly translated in pt-BR', async () => {
    await changeLanguage('pt-BR')
    const { workspace, pane } = makeWorkspace()
    useWorkspaceStore.setState({ workspaces: [workspace], activeWorkspaceId: workspace.id, shellProfiles: [] })

    let resolveStatus!: (value: TerminalStatusResult) => void
    installOxeApi(() => new Promise<TerminalStatusResult>(resolve => { resolveStatus = resolve }))

    render(
      <PaneContainer
        pane={pane}
        workspace={workspace}
        agentProfile={makeAgentProfile('antigravity')}
        autoStart={false}
        isMaximized={false}
        onToggleMaximize={() => undefined}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /Mais ações do painel/i }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /^Detalhes$/i }))
    const dialog = await screen.findByRole('dialog', { name: /Detalhes do terminal/i })

    expect(within(dialog).getByTestId('terminal-provider-session-status')).toHaveTextContent('Detectando…')
    expect(within(dialog).queryByRole('button', { name: /Procurar sessões/i })).toBeNull()
    expect(dialog.textContent).not.toMatch(/O terminal não informa qual conversa do Codex ou do Claude está aberta/i)

    resolveStatus({
      running: true,
      seq: 1,
      altScreen: false,
      agentSession: { source: 'notFound', message: { code: 'agents.session.notFound', params: {} } }
    })

    await waitFor(() => {
      expect(within(dialog).getByTestId('terminal-provider-session-status')).toHaveTextContent('Ainda não informado')
    })
    expect(within(dialog).queryByTestId('terminal-provider-session-copy')).toBeNull()
  })
})
