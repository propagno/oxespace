// Frozen acceptance test for 1.5.2 P0 (Jira OXE-367; A11). Written by the planner; the executor must not edit it.
// Reducing the layout left the selection above it ("6/4") and sent more slots than panes.
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { NewWorkspaceModal } from '../../../src/components/Workspace/NewWorkspaceModal'

afterEach(cleanup)

async function chooseSixThenFour(agents: number, shells: number): Promise<void> {
  const user = userEvent.setup()
  const onLaunch = vi.fn(async () => undefined)
  render(<NewWorkspaceModal agentProfiles={[{ agentProfileId: 'p-codex', name: 'Codex', provider: 'codex', command: 'codex', commandTemplate: 'codex', isBuiltin: true }]}
    shellProfiles={[{ id: 'sh-1', name: 'Bash', executable: 'bash', args: [], isBuiltin: true }]}
    onLaunch={onLaunch} onPickFolder={async () => null} onClose={() => undefined} />)
  await user.type(screen.getByTestId('wizard-dir-input'), '/work/api')
  await user.click(screen.getByTestId('wizard-layout-card-6'))
  for (let i = 0; i < agents; i++) await user.click(screen.getByTestId('agent-inc-p-codex'))
  for (let i = 0; i < shells; i++) await user.click(screen.getByRole('button', { name: 'Add another Bash' }))
  await user.click(screen.getByTestId('wizard-layout-card-4'))
  const count = (id: string): number => Number(screen.getByTestId(id).textContent)
  expect(count('agent-count-p-codex') + count('agent-count-shell'), 'the chips never add up to more than the layout').toBe(4)
  expect(screen.getByTestId('wizard-agent-counter').textContent, 'the counter never reads 6/4').not.toMatch(/6\D+4/)
  await user.click(screen.getByTestId('wizard-launch-btn'))
  const input = onLaunch.mock.calls[0]![0] as { agentSlots: string[]; agentBindings: Array<{ paneIndex: number }> }
  expect(input.agentSlots).toHaveLength(4)
  expect(input.agentBindings.map(binding => binding.paneIndex).sort()).toEqual([0, 1, 2, 3])
}

describe('OXE-367 · a smaller layout', () => {
  test('six agents reduced to a layout of four become four', async () => { await chooseSixThenFour(6, 0) })
  test('agents and shells reduced to a layout of four become four', async () => { await chooseSixThenFour(1, 5) })
})
