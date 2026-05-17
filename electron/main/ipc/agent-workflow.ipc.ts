import { ipcMain } from 'electron'
import type { AppDatabase } from '../db/index'
import { AgentWorkflowService } from '../services/agent-workflow.service'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import {
  parseAdvanceAgentWorkflowRunInput,
  parseAppendAgentWorkflowArtifactInput,
  parseApproveAgentWorkflowPlanInput,
  parseCompleteManualAgentWorkflowStepInput,
  parseCreateAgentWorkflowRunInput,
  parseId,
  parsePrepareAgentWorkflowStepInput,
  parseRecordAgentWorkflowExecutionEvidenceInput,
  parseRejectAgentWorkflowPlanInput,
  parseRequestAgentWorkflowPlanChangesInput,
  parseRunAgentWorkflowStepInput,
  parseSendApprovedAgentWorkflowExecutionInput,
  parseUpdateWorkspaceAgentRoleBindingsInput
} from './validation'

interface AgentWorkflowIpcOptions {
  terminalWrite?: (input: { paneId: string; data: string }) => void | Promise<void>
}

export function registerAgentWorkflowIpc(db: AppDatabase, options: AgentWorkflowIpcOptions = {}): AgentWorkflowService {
  const service = new AgentWorkflowService(db, options)

  ipcMain.handle(IPC_CHANNELS.agentWorkflow.listRuns, (_event, workspaceId: unknown) => service.listRuns(parseId(workspaceId, 'workspaceId')))
  ipcMain.handle(IPC_CHANNELS.agentWorkflow.createRun, (_event, input: unknown) => service.createRun(parseCreateAgentWorkflowRunInput(input)))
  ipcMain.handle(IPC_CHANNELS.agentWorkflow.getRun, (_event, runId: unknown) => service.getRun(parseId(runId, 'runId')))
  ipcMain.handle(IPC_CHANNELS.agentWorkflow.updateRoleBindings, (_event, input: unknown) => service.updateRoleBindings(parseUpdateWorkspaceAgentRoleBindingsInput(input)))
  ipcMain.handle(IPC_CHANNELS.agentWorkflow.getRoleBindings, (_event, workspaceId: unknown) => service.getRoleBindings(parseId(workspaceId, 'workspaceId')))
  ipcMain.handle(IPC_CHANNELS.agentWorkflow.prepareStep, (_event, input: unknown) => service.prepareStep(parsePrepareAgentWorkflowStepInput(input)))
  ipcMain.handle(IPC_CHANNELS.agentWorkflow.runStep, (_event, input: unknown) => service.runStep(parseRunAgentWorkflowStepInput(input)))
  ipcMain.handle(IPC_CHANNELS.agentWorkflow.approvePlan, (_event, input: unknown) => service.approvePlan(parseApproveAgentWorkflowPlanInput(input)))
  ipcMain.handle(IPC_CHANNELS.agentWorkflow.rejectPlan, (_event, input: unknown) => service.rejectPlan(parseRejectAgentWorkflowPlanInput(input)))
  ipcMain.handle(IPC_CHANNELS.agentWorkflow.requestPlanChanges, (_event, input: unknown) => service.requestPlanChanges(parseRequestAgentWorkflowPlanChangesInput(input)))
  ipcMain.handle(IPC_CHANNELS.agentWorkflow.sendApprovedExecution, (_event, input: unknown) => service.sendApprovedExecution(parseSendApprovedAgentWorkflowExecutionInput(input)))
  ipcMain.handle(IPC_CHANNELS.agentWorkflow.recordExecutionEvidence, (_event, input: unknown) => service.recordExecutionEvidence(parseRecordAgentWorkflowExecutionEvidenceInput(input)))
  ipcMain.handle(IPC_CHANNELS.agentWorkflow.advanceRun, (_event, input: unknown) => service.advanceRun(parseAdvanceAgentWorkflowRunInput(input)))
  ipcMain.handle(IPC_CHANNELS.agentWorkflow.completeManualStep, (_event, input: unknown) => service.completeManualStep(parseCompleteManualAgentWorkflowStepInput(input)))
  ipcMain.handle(IPC_CHANNELS.agentWorkflow.appendArtifact, (_event, input: unknown) => service.appendArtifact(parseAppendAgentWorkflowArtifactInput(input)))

  return service
}
