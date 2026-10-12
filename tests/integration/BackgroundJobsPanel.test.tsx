import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { BackgroundJobsPanel } from '../../src/components/Background/BackgroundJobsPanel'
import { useBackgroundStore } from '../../src/store/background.store'

describe('Background activity', () => {
  beforeEach(() => {
    useBackgroundStore.setState({ jobsByWorkspace: { 'workspace-1': [] }, outputByJob: {}, expandedJobId: null })
    window.oxe = {
      background: { list: vi.fn().mockResolvedValue([]) },
      delegation: {
        status: vi.fn().mockResolvedValue({ tasks: [{
          id: 'task-1', objective: 'Review the release', state: 'running',
          branch: 'feat/release', agentProfileId: 'codex', updatedAt: Date.now(),
          lastReport: 'Checking tests.'
        }], nextCursor: null }),
        onChanged: vi.fn(() => vi.fn())
      }
    } as never
  })

  test('separates local jobs from delegated agent work', async () => {
    const user = userEvent.setup()
    render(<BackgroundJobsPanel workspaceId="workspace-1" />)
    expect(screen.getByText('No jobs')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Delegated work' }))
    expect(await screen.findByText('Review the release')).toBeVisible()
    expect(screen.getByText('Checking tests.')).toBeVisible()
    expect(screen.queryByText('No jobs')).not.toBeInTheDocument()
  })
})
