import { render, screen, within } from '@testing-library/react'
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
  { agentProfileId: 'p-gemini',   name: 'Gemini',   provider: 'gemini',   command: 'gemini',   commandTemplate: 'gemini', isBuiltin: true  },
  { agentProfileId: 'p-opencode', name: 'OpenCode', provider: 'custom',   command: 'opencode', commandTemplate: 'opencode', isBuiltin: false },
  { agentProfileId: 'p-cursor',   name: 'Cursor',   provider: 'cursor',   command: 'cursor',   commandTemplate: 'cursor', isBuiltin: true  }
]

const mockShellProfiles: ShellProfile[] = [
  { id: 'sh-1', name: 'PowerShell', executable: 'pwsh', args: [], isBuiltin: true }
]

function renderWizard(overrides?: Partial<Parameters<typeof NewWorkspaceModal>[0]>) {
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

describe('NewWorkspaceModal wizard', () => {
  test('A1: renders modal with 2 step dots; CANCEL closes modal', async () => {
    const user = userEvent.setup()
    const { onClose } = renderWizard()

    const dots = screen.getAllByLabelText(/Step \d/)
    expect(dots).toHaveLength(2)

    await user.click(screen.getByText('Cancel'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  test('A6: CONFIGURE AGENTS disabled without rootPath; enabled with rootPath; advances to step 2', async () => {
    const user = userEvent.setup()
    renderWizard()

    const configBtn = screen.getByTestId('wizard-configure-agents-btn')
    expect(configBtn).toBeDisabled()

    const dirInput = screen.getByTestId('wizard-dir-input')
    await user.type(dirInput, 'C:/projects/repo')
    expect(configBtn).not.toBeDisabled()

    await user.click(configBtn)
    expect(screen.getByTestId('wizard-launch-btn')).toBeInTheDocument()
  })

  test('A7: title shows correct N terminal sessions', async () => {
    const user = userEvent.setup()
    renderWizard()

    await user.click(screen.getByTestId('wizard-layout-card-6'))
    const dirInput = screen.getByTestId('wizard-dir-input')
    await user.type(dirInput, 'C:/repo')
    await user.click(screen.getByTestId('wizard-configure-agents-btn'))

    expect(screen.getByText(/6 terminal sessions/i)).toBeInTheDocument()
  })

  test('A8: counter − does not go below 0; + increments', async () => {
    const user = userEvent.setup()
    renderWizard()

    const dirInput = screen.getByTestId('wizard-dir-input')
    await user.type(dirInput, 'C:/repo')
    await user.click(screen.getByTestId('wizard-configure-agents-btn'))

    const decBtn = screen.getByTestId('agent-dec-p-claude')
    const countEl = screen.getByTestId('agent-count-p-claude')
    const incBtn = screen.getByTestId('agent-inc-p-claude')

    expect(countEl).toHaveTextContent('0')
    expect(decBtn).toBeDisabled()

    await user.click(incBtn)
    expect(countEl).toHaveTextContent('1')

    await user.click(decBtn)
    expect(countEl).toHaveTextContent('0')
    expect(decBtn).toBeDisabled()
  })

  test('A9: SELECT ALL fills first agent; FILL EVENLY distributes; 1 EACH = 1 per agent; CLEAR zeros', async () => {
    const user = userEvent.setup()
    renderWizard()

    const dirInput = screen.getByTestId('wizard-dir-input')
    await user.type(dirInput, 'C:/repo')
    await user.click(screen.getByTestId('wizard-layout-card-6'))
    await user.click(screen.getByTestId('wizard-configure-agents-btn'))

    const fleetCount = screen.getByTestId('fleet-count')

    await user.click(screen.getByText('Select All'))
    expect(fleetCount).toHaveTextContent('6')

    await user.click(screen.getByText('Clear'))
    expect(fleetCount).toHaveTextContent('0')

    await user.click(screen.getByText('Fill Evenly'))
    expect(fleetCount).toHaveTextContent('6')

    await user.click(screen.getByText('Clear'))
    await user.click(screen.getByText('1 Each'))
    expect(fleetCount).toHaveTextContent('5')
  })

  test('A10: fleet count updates; shows "No agents selected" when 0', async () => {
    const user = userEvent.setup()
    renderWizard()

    const dirInput = screen.getByTestId('wizard-dir-input')
    await user.type(dirInput, 'C:/repo')
    await user.click(screen.getByTestId('wizard-configure-agents-btn'))

    expect(screen.getByTestId('fleet-status')).toHaveTextContent('No agents selected')

    await user.click(screen.getByTestId('agent-inc-p-claude'))
    expect(screen.getByTestId('fleet-count')).toHaveTextContent('1')
    expect(screen.getByTestId('fleet-status')).not.toHaveTextContent('No agents selected')
  })

  test('A13: BACK from step 2 preserves rootPath and layout selection', async () => {
    const user = userEvent.setup()
    renderWizard()

    const dirInput = screen.getByTestId('wizard-dir-input')
    await user.type(dirInput, 'C:/my/project')
    await user.click(screen.getByTestId('wizard-layout-card-8'))
    await user.click(screen.getByTestId('wizard-configure-agents-btn'))

    await user.click(screen.getByTestId('wizard-back-btn'))

    expect(screen.getByTestId('wizard-dir-input')).toHaveValue('C:/my/project')
    expect(screen.getByTestId('wizard-layout-card-8')).toHaveClass('active')
  })

  test('Browse folder fills rootPath and enables CONFIGURE AGENTS', async () => {
    const user = userEvent.setup()
    const onPickFolder = vi.fn().mockResolvedValue('C:/selected/path')
    renderWizard({ onPickFolder })

    await user.click(screen.getByText('Browse'))
    expect(onPickFolder).toHaveBeenCalled()
    expect(screen.getByTestId('wizard-dir-input')).toHaveValue('C:/selected/path')
    expect(screen.getByTestId('wizard-configure-agents-btn')).not.toBeDisabled()
  })

  test('terminal GO input updates rootPath', async () => {
    const user = userEvent.setup()
    renderWizard()

    const termInput = screen.getByTestId('wizard-terminal-input')
    await user.type(termInput, 'C:/terminal/path')
    await user.click(screen.getByText('GO'))

    expect(screen.getByTestId('wizard-dir-input')).toHaveValue('C:/terminal/path')
    expect(screen.getByTestId('wizard-configure-agents-btn')).not.toBeDisabled()
  })

  test('LAUNCH calls onLaunch with correct agentSlots', async () => {
    const user = userEvent.setup()
    const onLaunch = vi.fn().mockResolvedValue(undefined)
    renderWizard({ onLaunch })

    const dirInput = screen.getByTestId('wizard-dir-input')
    await user.type(dirInput, 'C:/repo')
    await user.click(screen.getByTestId('wizard-layout-card-4'))
    await user.click(screen.getByTestId('wizard-configure-agents-btn'))

    await user.click(screen.getByTestId('agent-inc-p-claude'))
    await user.click(screen.getByTestId('agent-inc-p-claude'))
    await user.click(screen.getByTestId('agent-inc-p-gemini'))

    await user.click(screen.getByTestId('wizard-launch-btn'))

    expect(onLaunch).toHaveBeenCalledWith(expect.objectContaining({
      rootPath: 'C:/repo',
      layoutPreset: 4,
      agentSlots: expect.arrayContaining(['claude', 'gemini'])
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
