import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { BackgroundJobUpdateEvent } from '../../shared/types/background'
import { useBackgroundStore } from '../../src/store/background.store'

describe('background.store', () => {
  let updateHandler: ((event: BackgroundJobUpdateEvent) => void) | null = null

  beforeEach(() => {
    updateHandler = null
    useBackgroundStore.setState({ jobsByWorkspace: {}, outputByJob: {}, expandedJobId: null })
    window.oxe = {
      ...window.oxe,
      background: {
        list: vi.fn().mockResolvedValue([]),
        start: vi.fn().mockImplementation(async (input) => {
          const job = createJob(input.workspaceId)
          updateHandler?.({ job })
          return job
        }),
        stop: vi.fn(),
        remove: vi.fn(),
        getOutput: vi.fn(),
        onOutput: vi.fn(() => vi.fn()),
        onUpdate: vi.fn((handler) => {
          updateHandler = handler
          return vi.fn()
        })
      }
    }
  })

  test('does not duplicate a job when update event arrives before start resolves', async () => {
    const unsubscribe = useBackgroundStore.getState().subscribe()

    await useBackgroundStore.getState().startJob({
      workspaceId: 'workspace-1',
      workspaceRootPath: 'C:/repo',
      command: 'npm run build',
      confirmed: true
    })

    const jobs = useBackgroundStore.getState().jobsByWorkspace['workspace-1']
    expect(jobs).toHaveLength(1)
    expect(jobs[0].id).toBe('job-1')

    unsubscribe()
  })
})

function createJob(workspaceId: string) {
  return {
    id: 'job-1',
    workspaceId,
    label: 'npm run build',
    command: 'npm run build',
    cwd: 'C:/repo',
    status: 'running' as const,
    exitCode: null,
    startedAtMs: 1,
    finishedAtMs: null
  }
}
