import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { AgentWorkflowRunDetails, WorkspaceAgentRoleBinding } from '../../shared/types/agent-workflow'
import { useAgentWorkflowStore } from '../../src/store/agent-workflow.store'

const details: AgentWorkflowRunDetails = {
  run: {
    id: 'run-1',
    workspaceId: 'workspace-1',
    sourceType: 'manual',
    sourceId: null,
    title: 'Run',
    status: 'draft',
    createdAt: 1,
    updatedAt: 1
  },
  steps: [],
  artifacts: []
}

const bindings: WorkspaceAgentRoleBinding[] = [
  { workspaceId: 'workspace-1', role: 'rubber_duck', agentProfileId: 'builtin-agent-claude', shellProfileId: 'builtin-claude', enabled: true }
]

describe('agent-workflow.store', () => {
  beforeEach(() => {
    useAgentWorkflowStore.setState({
      runsByWorkspace: {},
      detailsByRun: {},
      bindingsByWorkspace: {},
      activeRunIdByWorkspace: {},
      isLoading: false,
      error: null
    })
    window.oxe = {
      agentWorkflow: {
        listRuns: vi.fn().mockResolvedValue([details.run]),
        createRun: vi.fn().mockResolvedValue(details),
        getRun: vi.fn().mockResolvedValue(details),
        updateRoleBindings: vi.fn().mockResolvedValue(bindings),
        getRoleBindings: vi.fn().mockResolvedValue(bindings),
        prepareStep: vi.fn().mockResolvedValue(details),
        runStep: vi.fn().mockResolvedValue(details),
        completeManualStep: vi.fn().mockResolvedValue(details),
        appendArtifact: vi.fn().mockResolvedValue(details)
      }
    } as never
  })

  test('loads runs and selects the first run', async () => {
    const { result } = renderHook(() => useAgentWorkflowStore())

    await act(async () => {
      await result.current.loadRuns('workspace-1')
    })

    expect(result.current.runsByWorkspace['workspace-1']).toEqual([details.run])
    expect(result.current.activeRunIdByWorkspace['workspace-1']).toBe('run-1')
  })

  test('creates a task-backed run and persists role bindings', async () => {
    const { result } = renderHook(() => useAgentWorkflowStore())

    await act(async () => {
      await result.current.createTaskRun({ id: 'task-1', workspaceId: 'workspace-1', title: 'Task', description: 'Desc', context: 'Ctx', allowedFiles: ['a.ts'] })
      await result.current.updateRoleBindings({ workspaceId: 'workspace-1', bindings: [{ role: 'rubber_duck', agentProfileId: 'builtin-agent-claude' }] })
    })

    expect(window.oxe.agentWorkflow.createRun).toHaveBeenCalledWith(expect.objectContaining({ sourceType: 'task', sourceId: 'task-1' }))
    expect(result.current.detailsByRun['run-1']).toEqual(details)
    expect(result.current.bindingsByWorkspace['workspace-1']).toEqual(bindings)
  })
})
