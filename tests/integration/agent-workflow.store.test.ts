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
        approvePlan: vi.fn().mockResolvedValue({
          ...details,
          run: { ...details.run, status: 'planned' },
          artifacts: [{ id: 'artifact-1', runId: 'run-1', stepId: null, kind: 'approved_plan', title: 'Approved plan', content: 'Approved', createdAt: 2 }]
        }),
        rejectPlan: vi.fn().mockResolvedValue(details),
        requestPlanChanges: vi.fn().mockResolvedValue(details),
        sendApprovedExecution: vi.fn().mockResolvedValue(details),
        recordExecutionEvidence: vi.fn().mockResolvedValue(details),
        advanceRun: vi.fn().mockResolvedValue(details),
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

  test('approves the canonical plan through the required IPC handler', async () => {
    const { result } = renderHook(() => useAgentWorkflowStore())

    await act(async () => {
      await result.current.approvePlan({ runId: 'run-1', planContent: 'Approved' })
    })

    expect(window.oxe.agentWorkflow.approvePlan).toHaveBeenCalledWith({ runId: 'run-1', planContent: 'Approved' })
    expect(result.current.detailsByRun['run-1']?.run.status).toBe('planned')
    expect(result.current.detailsByRun['run-1']?.artifacts[0]?.kind).toBe('approved_plan')
  })

  test('normalizes missing handler errors instead of falling back silently', async () => {
    vi.mocked(window.oxe.agentWorkflow.approvePlan).mockRejectedValueOnce(new Error("Error invoking remote method 'agent-workflow:approve-plan': Error: No handler registered for 'agent-workflow:approve-plan'"))
    const { result } = renderHook(() => useAgentWorkflowStore())

    await expect(result.current.approvePlan({ runId: 'run-1', planContent: 'Approved' })).rejects.toThrow('OXESpace precisa reiniciar')
    expect(window.oxe.agentWorkflow.appendArtifact).not.toHaveBeenCalled()
  })
})
