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
  test('renders settings as a modal with AI Providers section and official profiles', async () => {
    const user = userEvent.setup()
    const onDiscoverAgents = vi.fn()
    const onClose = vi.fn()

    render(
      <SettingsModal
        agentProfiles={profiles}
        agentReadiness={readiness}
        isDiscoveringAgents={false}
        onClose={onClose}
        onDiscoverAgents={onDiscoverAgents}
      />
    )

    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /AI Providers/i })).toBeInTheDocument()
    expect(screen.getByText('Claude')).toBeInTheDocument()
    expect(screen.getByText('Copilot')).toBeInTheDocument()
    expect(screen.getByText('claude')).toBeInTheDocument()
    expect(screen.getByText('copilot')).toBeInTheDocument()

    await user.click(screen.getByTestId('btn-discover-agents'))
    expect(onDiscoverAgents).toHaveBeenCalled()

    await user.click(screen.getByLabelText('Close'))
    expect(onClose).toHaveBeenCalled()
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
