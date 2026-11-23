// Frozen acceptance test for OXE-370 A2 (program 152p1a, phase F1). Written by the planner; the executor must not edit it.
// A custom agent starts from Use in pane when its parent's CLI can; an empty name is refused before IPC, in plain words.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentProfile, AgentReadiness } from '../../../shared/types/agent'
import { AgentConfigModal } from '../../../src/components/Agents/AgentConfigModal'
import { SettingsContent } from '../../../src/components/Settings/SettingsModal'

const claude: AgentProfile = { agentProfileId: 'builtin-agent-claude', name: 'Claude', provider: 'claude', command: 'claude', commandTemplate: '{{task}}', isBuiltin: true }
const custom = { agentProfileId: 'custom-1', name: 'Reviewer', provider: 'custom', command: '', commandTemplate: '', isBuiltin: false, parentProvider: 'claude', systemPrompt: 'Review the change.' } as AgentProfile

function settings(status: AgentReadiness['status']) {
  const use = vi.fn()
  render(<SettingsContent section="providers" agentProfiles={[claude, custom]} agentReadiness={[{ provider: 'claude', command: 'claude', status }]}
    isDiscoveringAgents={false} onClose={vi.fn()} onDiscoverAgents={vi.fn()} onConfigureAgent={vi.fn()} onNewCustomAgent={vi.fn()} onUseProviderInPane={use} />)
  return use
}
afterEach(cleanup)

describe('OXE-370 · custom agents in Settings', () => {
  it('a custom agent offers Use in pane when its parent is ready', async () => {
    const use = settings('ready')
    fireEvent.click(screen.getByTestId('btn-use-agent-custom'))
    await waitFor(() => expect(use).toHaveBeenCalledWith(custom))
  })

  it('a custom agent does not offer Use in pane when its parent is missing', () => {
    settings('missing')
    expect(screen.queryByTestId('btn-use-agent-custom')).toBeNull()
  })

  it('an empty agent name is refused before IPC', async () => {
    const save = vi.fn(async () => undefined)
    render(<AgentConfigModal profile={{ ...custom, agentProfileId: '', name: '' }} readiness={undefined} isDiscovering={false} onSave={save} onDelete={vi.fn()} onHealthCheck={vi.fn()} onClose={vi.fn()} />)
    fireEvent.change(screen.getByTestId('input-agent-name'), { target: { value: '   ' } })
    fireEvent.change(screen.getByTestId('textarea-system-prompt'), { target: { value: 'Review the change.' } })
    fireEvent.submit(document.getElementById('agent-config-form') as HTMLFormElement)
    expect(await screen.findByRole('alert')).toHaveTextContent(/name/i)
    expect(save).not.toHaveBeenCalled()
  })
})
