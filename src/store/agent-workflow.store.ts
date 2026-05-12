import { create } from 'zustand'
import type {
  AgentRole,
  AgentWorkflowRun,
  AgentWorkflowRunDetails,
  AppendAgentWorkflowArtifactInput,
  CompleteManualAgentWorkflowStepInput,
  CreateAgentWorkflowRunInput,
  PrepareAgentWorkflowStepInput,
  RunAgentWorkflowStepInput,
  UpdateWorkspaceAgentRoleBindingsInput,
  WorkspaceAgentRoleBinding
} from '../../shared/types/agent-workflow'

interface AgentWorkflowState {
  runsByWorkspace: Record<string, AgentWorkflowRun[]>
  detailsByRun: Record<string, AgentWorkflowRunDetails>
  bindingsByWorkspace: Record<string, WorkspaceAgentRoleBinding[]>
  activeRunIdByWorkspace: Record<string, string | null>
  isLoading: boolean
  error: string | null
  loadRuns: (workspaceId: string) => Promise<void>
  loadRun: (runId: string) => Promise<AgentWorkflowRunDetails>
  createRun: (input: CreateAgentWorkflowRunInput) => Promise<AgentWorkflowRunDetails>
  loadRoleBindings: (workspaceId: string) => Promise<WorkspaceAgentRoleBinding[]>
  updateRoleBindings: (input: UpdateWorkspaceAgentRoleBindingsInput) => Promise<WorkspaceAgentRoleBinding[]>
  prepareStep: (input: PrepareAgentWorkflowStepInput) => Promise<AgentWorkflowRunDetails>
  runStep: (input: RunAgentWorkflowStepInput) => Promise<AgentWorkflowRunDetails>
  completeManualStep: (input: CompleteManualAgentWorkflowStepInput) => Promise<AgentWorkflowRunDetails>
  appendArtifact: (input: AppendAgentWorkflowArtifactInput) => Promise<AgentWorkflowRunDetails>
  setActiveRun: (workspaceId: string, runId: string | null) => void
  createTaskRun: (task: { id: string; workspaceId: string; title: string; description: string; context: string; allowedFiles: string[] }) => Promise<AgentWorkflowRunDetails>
  clearError: () => void
}

export const useAgentWorkflowStore = create<AgentWorkflowState>((set, get) => ({
  runsByWorkspace: {},
  detailsByRun: {},
  bindingsByWorkspace: {},
  activeRunIdByWorkspace: {},
  isLoading: false,
  error: null,

  loadRuns: async (workspaceId) => {
    set({ isLoading: true, error: null })
    try {
      const runs = await window.oxe.agentWorkflow.listRuns(workspaceId)
      set((state) => ({
        runsByWorkspace: { ...state.runsByWorkspace, [workspaceId]: runs },
        activeRunIdByWorkspace: {
          ...state.activeRunIdByWorkspace,
          [workspaceId]: state.activeRunIdByWorkspace[workspaceId] ?? runs[0]?.id ?? null
        },
        isLoading: false
      }))
    } catch (error) {
      set({ isLoading: false, error: toMessage(error) })
    }
  },

  loadRun: async (runId) => {
    const details = await window.oxe.agentWorkflow.getRun(runId)
    setRunDetails(set, details)
    return details
  },

  createRun: async (input) => {
    const details = await window.oxe.agentWorkflow.createRun(input)
    setRunDetails(set, details)
    set((state) => ({
      runsByWorkspace: {
        ...state.runsByWorkspace,
        [details.run.workspaceId]: [details.run, ...(state.runsByWorkspace[details.run.workspaceId] ?? []).filter((run) => run.id !== details.run.id)]
      },
      activeRunIdByWorkspace: { ...state.activeRunIdByWorkspace, [details.run.workspaceId]: details.run.id },
      error: null
    }))
    return details
  },

  loadRoleBindings: async (workspaceId) => {
    const bindings = await window.oxe.agentWorkflow.getRoleBindings(workspaceId)
    set((state) => ({ bindingsByWorkspace: { ...state.bindingsByWorkspace, [workspaceId]: bindings }, error: null }))
    return bindings
  },

  updateRoleBindings: async (input) => {
    const bindings = await window.oxe.agentWorkflow.updateRoleBindings(input)
    set((state) => ({ bindingsByWorkspace: { ...state.bindingsByWorkspace, [input.workspaceId]: bindings }, error: null }))
    return bindings
  },

  prepareStep: async (input) => {
    const details = await window.oxe.agentWorkflow.prepareStep(input)
    setRunDetails(set, details)
    return details
  },

  runStep: async (input) => {
    const details = await window.oxe.agentWorkflow.runStep(input)
    setRunDetails(set, details)
    return details
  },

  completeManualStep: async (input) => {
    const details = await window.oxe.agentWorkflow.completeManualStep(input)
    setRunDetails(set, details)
    return details
  },

  appendArtifact: async (input) => {
    const details = await window.oxe.agentWorkflow.appendArtifact(input)
    setRunDetails(set, details)
    return details
  },

  setActiveRun: (workspaceId, runId) => {
    set((state) => ({ activeRunIdByWorkspace: { ...state.activeRunIdByWorkspace, [workspaceId]: runId } }))
  },

  createTaskRun: async (task) => {
    return get().createRun({
      workspaceId: task.workspaceId,
      title: task.title,
      sourceType: 'task',
      sourceId: task.id,
      initialPrompt: [
        `# Task: ${task.title}`,
        '',
        '## Description',
        task.description,
        '',
        '## Context',
        task.context,
        '',
        '## Allowed Files',
        task.allowedFiles.join('\n')
      ].join('\n')
    })
  },

  clearError: () => set({ error: null })
}))

export function getRoleLabel(role: AgentRole): string {
  const labels: Record<AgentRole, string> = {
    rubber_duck: 'Duck',
    planner: 'Plan',
    executor: 'Execute',
    reviewer: 'Review',
    verifier: 'Verify',
    publisher: 'Publish'
  }
  return labels[role]
}

function setRunDetails(
  set: (partial: AgentWorkflowState | Partial<AgentWorkflowState> | ((state: AgentWorkflowState) => AgentWorkflowState | Partial<AgentWorkflowState>)) => void,
  details: AgentWorkflowRunDetails
): void {
  set((state) => ({
    detailsByRun: { ...state.detailsByRun, [details.run.id]: details },
    runsByWorkspace: {
      ...state.runsByWorkspace,
      [details.run.workspaceId]: [
        details.run,
        ...(state.runsByWorkspace[details.run.workspaceId] ?? []).filter((run) => run.id !== details.run.id)
      ].sort((a, b) => b.updatedAt - a.updatedAt)
    },
    activeRunIdByWorkspace: { ...state.activeRunIdByWorkspace, [details.run.workspaceId]: details.run.id },
    error: null
  }))
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected agent workflow error'
}
