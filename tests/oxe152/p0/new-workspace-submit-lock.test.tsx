// Frozen acceptance test for 1.5.2 P0 (Jira OXE-367; A14). Written by the planner; the executor must not edit it.
// Closing the dialog while the workspace was being created left a "ghost" creation behind.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { NewWorkspaceModal } from '../../../src/components/Workspace/NewWorkspaceModal'

afterEach(cleanup)

async function submit(onLaunch: () => Promise<void>): Promise<{ onClose: ReturnType<typeof vi.fn>; user: ReturnType<typeof userEvent.setup> }> {
  const user = userEvent.setup()
  const onClose = vi.fn()
  render(<NewWorkspaceModal agentProfiles={[]} shellProfiles={[{ id: 'sh-1', name: 'Bash', executable: 'bash', args: [], isBuiltin: true }]}
    onLaunch={onLaunch} onPickFolder={async () => null} onClose={onClose} />)
  await user.type(screen.getByTestId('wizard-dir-input'), '/work/api')
  await user.click(screen.getByTestId('wizard-launch-btn'))
  return { onClose, user }
}

describe('OXE-367 · closing while a workspace is being created', () => {
  test('Cancel and Escape do not close the dialog during the submit', async () => {
    const { onClose, user } = await submit(() => new Promise<void>(() => undefined))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose, 'Cancel during the submit').not.toHaveBeenCalled()
    await user.keyboard('{Escape}')
    expect(onClose, 'Escape during the submit').not.toHaveBeenCalled()
  })

  test('after a failed submit the dialog can be closed again', async () => {
    const { onClose, user } = await submit(async () => { throw new Error('disk is full') })
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
