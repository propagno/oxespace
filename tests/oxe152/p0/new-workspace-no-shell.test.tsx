// Frozen acceptance test for 1.5.2 P0 (Jira OXE-367; A7). Written by the planner; the executor must not edit it.
// With no neutral shell profile and every slot taken by an agent, `shellProfile!.id` threw a TypeError and no workspace
// could be made. The safe fallback: the first shell profile there is, else none (main then picks its default).
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { ShellProfile } from '../../../shared/types/workspace'
import { NewWorkspaceModal } from '../../../src/components/Workspace/NewWorkspaceModal'

afterEach(cleanup)

async function createAllAgents(shellProfiles: ShellProfile[]): Promise<ReturnType<typeof vi.fn>> {
  const user = userEvent.setup()
  const onLaunch = vi.fn(async () => undefined)
  render(<NewWorkspaceModal agentProfiles={[{ agentProfileId: 'p-codex', name: 'Codex', provider: 'codex', command: 'codex', commandTemplate: 'codex', isBuiltin: true }]}
    shellProfiles={shellProfiles} onLaunch={onLaunch} onPickFolder={async () => null} onClose={() => undefined} />)
  await user.type(screen.getByTestId('wizard-dir-input'), '/work/api')
  for (let i = 0; i < 4; i++) await user.click(screen.getByTestId('agent-inc-p-codex'))
  await user.click(screen.getByTestId('wizard-launch-btn'))
  expect(screen.queryByText(/Cannot read properties|is null/i), 'no TypeError on screen').toBeNull()
  expect(onLaunch, 'the workspace is created').toHaveBeenCalledTimes(1)
  return onLaunch
}

describe('OXE-367 · New workspace without a neutral shell', () => {
  test('a workspace of agents only is created when there is no shell profile at all', async () => {
    const input = (await createAllAgents([])).mock.calls[0][0]
    expect(input.defaultShellProfileId).toBeUndefined()
    expect(input.agentBindings).toHaveLength(4)
  })

  test('a workspace of agents only falls back to the shell profile that exists', async () => {
    const input = (await createAllAgents([{ id: 'builtin-claude', name: 'Claude', executable: 'claude', args: [], isBuiltin: true }])).mock.calls[0][0]
    expect(input.defaultShellProfileId).toBe('builtin-claude')
  })
})
