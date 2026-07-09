import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import type { AgentProfile, AgentReadiness } from '../../shared/types/agent'
import { AgentConfigModal } from '../../src/components/Agents/AgentConfigModal'
import { SettingsModal } from '../../src/components/Settings/SettingsModal'

const profiles: AgentProfile[] = [
  {
    agentProfileId: 'builtin-agent-claude',
    name: 'Claude',
    provider: 'claude',
    command: 'claude',
    commandTemplate: '{{task}}',
    isBuiltin: true
  },
  {
    agentProfileId: 'builtin-agent-copilot',
    name: 'Copilot',
    provider: 'copilot',
    command: 'copilot',
    commandTemplate: '{{task}}',
    isBuiltin: true
  }
]

const readiness: AgentReadiness[] = [
  { provider: 'claude', command: 'claude', status: 'ready', version: 'claude 2.1.132' },
  { provider: 'copilot', command: 'copilot', status: 'missing' }
]

describe('Settings agents UI', () => {
  test('renders Agent Settings modal with AI Providers and official profiles', async () => {
    const user = userEvent.setup()
    const onDiscoverAgents = vi.fn()
    const onClose = vi.fn()
    const onConfigureAgent = vi.fn()
    const onNewCustomAgent = vi.fn()

    render(
      <SettingsModal
        agentProfiles={profiles}
        agentReadiness={readiness}
        isDiscoveringAgents={false}
        onClose={onClose}
        onDiscoverAgents={onDiscoverAgents}
        onConfigureAgent={onConfigureAgent}
        onNewCustomAgent={onNewCustomAgent}
      />
    )

    expect(screen.getByRole('dialog', { name: 'Agent Settings' })).toBeInTheDocument()
    expect(screen.getByTestId('settings-modal')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /AI Providers/i })).toBeInTheDocument()
    expect(screen.getByText('Claude')).toBeInTheDocument()
    expect(screen.getByText('Ready')).toBeInTheDocument()
    expect(screen.getByText('claude 2.1.132')).toBeInTheDocument()
    // Missing CLIs are collapsed by default
    expect(screen.queryByText('Copilot')).not.toBeInTheDocument()
    expect(screen.getByTestId('btn-toggle-missing-providers')).toHaveTextContent(/1 not installed/i)
    expect(screen.getByRole('button', { name: /Health check/i })).toBeInTheDocument()
    expect(screen.getByTestId('providers-summary')).toHaveTextContent(/1 ready/i)

    // Already has readiness — do not auto-probe again on open
    expect(onDiscoverAgents).not.toHaveBeenCalled()

    await user.click(screen.getByTestId('btn-discover-agents'))
    expect(onDiscoverAgents).toHaveBeenCalledTimes(1)

    await user.click(screen.getByTestId('btn-configure-agent-claude'))
    expect(onConfigureAgent).toHaveBeenCalledWith(profiles[0])

    await user.click(screen.getByTestId('btn-toggle-missing-providers'))
    expect(screen.getByText('Copilot')).toBeInTheDocument()
    expect(screen.getByText('Not installed')).toBeInTheDocument()
    expect(screen.getByTestId('btn-configure-agent-copilot')).toHaveTextContent(/Fix path/i)

    await user.click(screen.getByTestId('btn-new-custom-agent'))
    expect(onNewCustomAgent).toHaveBeenCalled()

    await user.click(screen.getByLabelText('Close'))
    expect(onClose).toHaveBeenCalled()
  })

  test('auto-runs health check when readiness is unknown', () => {
    const onDiscoverAgents = vi.fn()

    render(
      <SettingsModal
        agentProfiles={profiles}
        agentReadiness={[]}
        isDiscoveringAgents={false}
        onClose={vi.fn()}
        onDiscoverAgents={onDiscoverAgents}
        onConfigureAgent={vi.fn()}
        onNewCustomAgent={vi.fn()}
      />
    )

    expect(onDiscoverAgents).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('providers-summary')).toHaveTextContent(/Not checked yet|Detecting/i)
  })

  test('Escape closes the modal', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    render(
      <SettingsModal
        agentProfiles={profiles}
        agentReadiness={readiness}
        isDiscoveringAgents={false}
        onClose={onClose}
        onDiscoverAgents={vi.fn()}
        onConfigureAgent={vi.fn()}
        onNewCustomAgent={vi.fn()}
      />
    )

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })

  test('navigates between settings sections', async () => {
    const user = userEvent.setup()

    render(
      <SettingsModal
        agentProfiles={profiles}
        agentReadiness={readiness}
        isDiscoveringAgents={false}
        onClose={vi.fn()}
        onDiscoverAgents={vi.fn()}
        onConfigureAgent={vi.fn()}
        onNewCustomAgent={vi.fn()}
      />
    )

    await user.click(screen.getByRole('button', { name: /^Terminal$/i }))
    expect(screen.getByRole('heading', { name: 'Terminal' })).toBeInTheDocument()
    expect(screen.getByText(/terminal preview/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^Notifications$/i }))
    expect(screen.getByRole('heading', { name: 'Notifications' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: /Notify when an agent needs you/i })).toBeInTheDocument()
    expect(screen.getByTestId('btn-test-notification')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^Updates$/i }))
    expect(screen.getByRole('heading', { name: 'Updates' })).toBeInTheDocument()
    expect(screen.getByTestId('settings-app-update')).toBeInTheDocument()
    // Default store is disabled/dev until packaged bootstrap — honest UX
    expect(screen.getByTestId('app-update-pill')).toHaveTextContent(/Dev build/i)
    expect(screen.getByTestId('btn-check-app-updates')).toBeDisabled()
    expect(screen.getByTestId('btn-check-app-updates')).toHaveTextContent(/Unavailable in dev/i)
    expect(screen.getByTestId('settings-rtk-update')).toBeInTheDocument()
    expect(screen.getByTestId('btn-update-rtk')).toBeInTheDocument()
    expect(screen.getByTestId('settings-bundled-tools')).toBeInTheDocument()
  })

  test('built-in modal allows command edits without delete or secret fields', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(undefined)

    render(
      <AgentConfigModal
        profile={profiles[0]}
        readiness={readiness[0]}
        isDiscovering={false}
        onSave={onSave}
        onDelete={vi.fn()}
        onHealthCheck={vi.fn()}
        onClose={vi.fn()}
      />
    )

    expect(screen.queryByTestId('btn-delete-agent')).not.toBeInTheDocument()
    expect(screen.queryByText(/api key|token/i)).not.toBeInTheDocument()

    const commandInput = screen.getByTestId('input-agent-command')
    expect(commandInput).not.toBeDisabled()

    await user.clear(commandInput)
    await user.type(commandInput, 'claude-custom')
    await user.click(screen.getByTestId('btn-save-agent'))

    expect(onSave).toHaveBeenCalledWith('builtin-agent-claude', {
      name: 'Claude',
      command: 'claude-custom'
    })
  })
})
