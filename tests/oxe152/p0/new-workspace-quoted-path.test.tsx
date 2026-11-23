// Frozen acceptance test for 1.5.2 P0 (Jira OXE-367; A15). Written by the planner; the executor must not edit it.
// Main strips a pasted path's surrounding quotes (normalizeWorkspaceRoot); the dialog compared before that, so it
// offered to create a workspace that is already open.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Workspace } from '../../../shared/types/workspace'
import { NewWorkspaceModal } from '../../../src/components/Workspace/NewWorkspaceModal'

afterEach(cleanup)

async function opensExisting(root: string, pasted: string, platform: string): Promise<void> {
  const onLaunch = vi.fn(async () => undefined)
  const onOpenExisting = vi.fn(async () => undefined)
  render(<NewWorkspaceModal agentProfiles={[]} shellProfiles={[{ id: 'sh-1', name: 'Bash', executable: 'bash', args: [], isBuiltin: true }]} platform={platform}
    existingWorkspaces={[{ id: 'ws-1', name: 'api', rootPath: root, panes: [] } as unknown as Workspace]}
    onOpenExisting={onOpenExisting} onLaunch={onLaunch} onPickFolder={async () => null} onClose={() => undefined} />)
  fireEvent.change(screen.getByTestId('wizard-dir-input'), { target: { value: pasted } })
  await userEvent.click(screen.getByTestId('wizard-launch-btn'))
  expect(onLaunch, 'no second workspace').not.toHaveBeenCalled()
  expect(onOpenExisting).toHaveBeenCalledWith('ws-1')
}

describe('OXE-367 · a pasted path with quotes', () => {
  test('a Windows path in double quotes opens the workspace already there', async () => { await opensExisting('C:\\work\\api', '"C:\\work\\api"', 'win32') })
  test('a path in single quotes with spaces around opens the workspace already there', async () => { await opensExisting('/work/api', "  '/work/api'  ", 'linux') })
})
