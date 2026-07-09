import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import type { AgentProfile } from '../../shared/types/agent'
import type { ShellProfile } from '../../shared/types/workspace'
import { NewWorkspaceModal } from '../../src/components/Workspace/NewWorkspaceModal'
import {
  buildAgentSlots,
  distributeEvenly,
  distributeOneEach,
  fillFirst,
  getCopilotCommand
} from '../../src/components/Workspace/fleetUtils'

const mockAgents: AgentProfile[] = [
  { agentProfileId: 'p-claude',   name: 'Claude',   provider: 'claude',   command: 'claude',   commandTemplate: 'claude', isBuiltin: true  },
  { agentProfileId: 'p-codex',    name: 'Codex',    provider: 'codex',    command: 'codex',    commandTemplate: 'codex',  isBuiltin: true  },
  { agentProfileId: 'p-antigravity', name: 'Antigravity', provider: 'antigravity', command: 'agy', commandTemplate: 'agy', isBuiltin: true  },
  { agentProfileId: 'p-opencode', name: 'OpenCode', provider: 'custom',   command: 'opencode', commandTemplate: 'opencode', isBuiltin: false },
  { agentProfileId: 'p-cursor',   name: 'Cursor',   provider: 'cursor',   command: 'cursor',   commandTemplate: 'cursor', isBuiltin: true  }
]

const mockShellProfiles: ShellProfile[] = [
  { id: 'sh-1', name: 'PowerShell', executable: 'pwsh', args: [], isBuiltin: true }
]

function renderModal(overrides?: Partial<Parameters<typeof NewWorkspaceModal>[0]>) {
  const onLaunch = vi.fn().mockResolvedValue(undefined)
  const onPickFolder = vi.fn().mockResolvedValue(null)
  const onClose = vi.fn()
  render(
    <NewWorkspaceModal
      agentProfiles={mockAgents}
      shellProfiles={mockShellProfiles}
      onLaunch={onLaunch}
      onPickFolder={onPickFolder}
      onClose={onClose}
      {...overrides}
    />
  )
  return { onLaunch, onPickFolder, onClose }
}

// Onda 3 redesigned this modal from a 2-step wizard into a single-page form.
// All the steps fit on one screen now: folder picker → layout cards → agent
// chips → Create button. There is no "Configure Agents" advance button and no
// step indicator anymore.
describe('NewWorkspaceModal (single-page)', () => {
  test('renders title and Cancel button closes', async () => {
    const user = userEvent.setup()
    const { onClose } = renderModal()

    expect(screen.getByRole('heading', { name: /Create new workspace/i })).toBeInTheDocument()
    await user.click(screen.getByText('Cancel'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  test('Create button is disabled without a folder and enables once typed', async () => {
    const user = userEvent.setup()
    renderModal()

    const launchBtn = screen.getByTestId('wizard-launch-btn')
    expect(launchBtn).toBeDisabled()

    await user.type(screen.getByTestId('wizard-dir-input'), 'C:/projects/repo')
    expect(launchBtn).not.toBeDisabled()
  })

  test('Browse delegates to onPickFolder and fills the input', async () => {
    const user = userEvent.setup()
    const onPickFolder = vi.fn().mockResolvedValue('C:/selected/path')
    renderModal({ onPickFolder })

    await user.click(screen.getByText('Browse'))
    expect(onPickFolder).toHaveBeenCalled()
    expect(screen.getByTestId('wizard-dir-input')).toHaveValue('C:/selected/path')
    expect(screen.getByTestId('wizard-launch-btn')).not.toBeDisabled()
  })

  test('agent chip + and − increment/decrement count and the chip toggles selected state', async () => {
    const user = userEvent.setup()
    renderModal()
    await user.type(screen.getByTestId('wizard-dir-input'), 'C:/repo')

    // Steppers are always visible (count starts at 0).
    expect(screen.getByTestId('agent-count-p-claude')).toHaveTextContent('0')

    await user.click(screen.getByLabelText('Add Claude'))
    expect(screen.getByTestId('agent-count-p-claude')).toHaveTextContent('1')

    await user.click(screen.getByTestId('agent-inc-p-claude'))
    expect(screen.getByTestId('agent-count-p-claude')).toHaveTextContent('2')

    // Decrement back to 0 — steppers stay, count returns to zero.
    await user.click(screen.getByTestId('agent-dec-p-claude'))
    await user.click(screen.getByTestId('agent-dec-p-claude'))
    expect(screen.getByTestId('agent-count-p-claude')).toHaveTextContent('0')
  })

  test('chip is disabled when all slots are filled', async () => {
    const user = userEvent.setup()
    renderModal()
    await user.type(screen.getByTestId('wizard-dir-input'), 'C:/repo')
    await user.click(screen.getByTestId('wizard-layout-card-2'))

    await user.click(screen.getByLabelText('Add Claude'))
    await user.click(screen.getByLabelText('Add another Claude'))
    expect(screen.getByTestId('agent-count-p-claude')).toHaveTextContent('2')

    // Slot total now equals layout (2) — other agents can't be added.
    expect(screen.getByLabelText('Add Codex')).toBeDisabled()
  })

  test('Create dispatches onLaunch with correct agentSlots', async () => {
    const user = userEvent.setup()
    const onLaunch = vi.fn().mockResolvedValue(undefined)
    renderModal({ onLaunch })

    await user.type(screen.getByTestId('wizard-dir-input'), 'C:/repo')
    await user.click(screen.getByTestId('wizard-layout-card-4'))
    await user.click(screen.getByLabelText('Add Claude'))
    await user.click(screen.getByTestId('agent-inc-p-claude'))
    await user.click(screen.getByLabelText('Add Antigravity'))

    await user.click(screen.getByTestId('wizard-launch-btn'))

    expect(onLaunch).toHaveBeenCalledWith(expect.objectContaining({
      rootPath: 'C:/repo',
      layoutPreset: 4,
      agentSlots: expect.arrayContaining(['claude', 'agy'])
    }))
  })

  test('Clear selection wipes agent counts', async () => {
    const user = userEvent.setup()
    renderModal()
    await user.type(screen.getByTestId('wizard-dir-input'), 'C:/repo')

    await user.click(screen.getByLabelText('Add Claude'))
    await user.click(screen.getByLabelText('Add Antigravity'))
    expect(screen.getByText(/2\/4 slots filled/i)).toBeInTheDocument()

    await user.click(screen.getByText('Clear selection'))
    expect(screen.getByTestId('agent-count-p-claude')).toHaveTextContent('0')
  })

  test('PowerShell can be combined with an agent in the same workspace', async () => {
    const user = userEvent.setup()
    const onLaunch = vi.fn().mockResolvedValue(undefined)
    const grok: AgentProfile = { agentProfileId: 'p-grok', name: 'Grok CLI', provider: 'grok', command: 'grok', commandTemplate: 'grok', isBuiltin: true }
    renderModal({ onLaunch, agentProfiles: [...mockAgents, grok] })

    await user.type(screen.getByTestId('wizard-dir-input'), 'C:/repo')
    await user.click(screen.getByTestId('wizard-layout-card-2'))
    await user.click(screen.getByLabelText('Add Grok CLI'))
    await user.click(screen.getByLabelText('Add PowerShell'))
    await user.click(screen.getByTestId('wizard-launch-btn'))

    expect(onLaunch).toHaveBeenCalledWith(expect.objectContaining({
      agentSlots: ['grok', ''],
      agentBindings: [
        { paneIndex: 0, agentProfileId: 'p-grok', agentName: 'Grok CLI' },
        { paneIndex: 1, shellProfileId: 'sh-1' }
      ]
    }))
  })
})

describe('fleetUtils — unit tests', () => {
  test('getCopilotCommand returns command for gh-copilot provider', () => {
    const profiles: AgentProfile[] = [
      { agentProfileId: 'a', name: 'Claude', provider: 'claude', command: 'claude', commandTemplate: 'claude', isBuiltin: true },
      { agentProfileId: 'b', name: 'Copilot', provider: 'gh-copilot', command: 'gh-copilot', commandTemplate: 'gh-copilot', isBuiltin: true }
    ]
    expect(getCopilotCommand(profiles)).toBe('gh-copilot')
  })

  test('getCopilotCommand returns empty string when no copilot', () => {
    expect(getCopilotCommand(mockAgents)).toBe('')
  })

  test('buildAgentSlots always returns array of length totalSlots', () => {
    const counts = [{ agentProfileId: 'p-claude', command: 'claude', count: 2 }]
    expect(buildAgentSlots(counts, 4, '')).toHaveLength(4)
    expect(buildAgentSlots(counts, 4, '')).toEqual(['claude', 'claude', '', ''])
    expect(buildAgentSlots([], 3, 'copilot')).toEqual(['copilot', 'copilot', 'copilot'])
  })

  test('buildAgentSlots truncates to totalSlots', () => {
    const counts = [{ agentProfileId: 'p-claude', command: 'claude', count: 10 }]
    expect(buildAgentSlots(counts, 3, '')).toHaveLength(3)
    expect(buildAgentSlots(counts, 3, '')).toEqual(['claude', 'claude', 'claude'])
  })

  test('distributeEvenly: sum === totalSlots', () => {
    const result = distributeEvenly(mockAgents, 6)
    const sum = result.reduce((a, c) => a + c.count, 0)
    expect(sum).toBe(6)
    expect(result).toHaveLength(5)
  })

  test('distributeEvenly: remainder goes to first agents', () => {
    const result = distributeEvenly(mockAgents.slice(0, 3), 7)
    expect(result[0].count).toBe(3)
    expect(result[1].count).toBe(2)
    expect(result[2].count).toBe(2)
  })

  test('distributeOneEach: one per agent up to totalSlots', () => {
    const result = distributeOneEach(mockAgents, 3)
    expect(result[0].count).toBe(1)
    expect(result[1].count).toBe(1)
    expect(result[2].count).toBe(1)
    expect(result[3].count).toBe(0)
    expect(result[4].count).toBe(0)
    const sum = result.reduce((a, c) => a + c.count, 0)
    expect(sum).toBe(3)
  })

  test('fillFirst: all slots to first agent', () => {
    const result = fillFirst(mockAgents, 6)
    expect(result[0].count).toBe(6)
    expect(result[1].count).toBe(0)
    expect(result[2].count).toBe(0)
  })

  test('fillFirst: returns correct agentProfileId and command', () => {
    const result = fillFirst(mockAgents, 4)
    expect(result[0].agentProfileId).toBe('p-claude')
    expect(result[0].command).toBe('claude')
  })
})
