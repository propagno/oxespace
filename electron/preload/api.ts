import type { IpcRendererEvent } from 'electron'
import packageJson from '../../package.json'
import {
  IPC_CHANNELS,
  type AgentProfile,
  type AgentReadiness,
  type FileSystemFileChangedEvent,
  type FileSystemReadFileResult,
  type FileSystemWatchFileResult,
  type FileSystemWriteFileResult,
  type FileTreeNode,
  type OxeApi,
  type ShellProfile,
  type Task,
  type TaskExecution,
  type TaskVerifyOutputEvent,
  type TerminalDataEvent,
  type TerminalExitEvent,
  type Workspace
} from '../../shared/types/ipc'
import type { GitDiff } from '../../shared/types/git'

export interface PreloadIpc {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
  on(channel: string, listener: (event: IpcRendererEvent, payload: unknown) => void): void
  removeListener(channel: string, listener: (event: IpcRendererEvent, payload: unknown) => void): void
}

export function createOxeApi(ipc: PreloadIpc): OxeApi {
  return {
    app: {
      version: packageJson.version
    },
    workspace: {
      list: () => ipc.invoke(IPC_CHANNELS.workspace.list) as Promise<Workspace[]>,
      create: (input) => ipc.invoke(IPC_CHANNELS.workspace.create, input) as Promise<Workspace>,
      setActive: (id) => ipc.invoke(IPC_CHANNELS.workspace.setActive, id) as Promise<Workspace>,
      delete: (id) => ipc.invoke(IPC_CHANNELS.workspace.delete, id) as Promise<void>,
      closePane: (id) => ipc.invoke(IPC_CHANNELS.workspace.closePane, id) as Promise<void>,
      splitPane: (input) => ipc.invoke(IPC_CHANNELS.workspace.splitPane, input) as Promise<Workspace>,
      updatePaneType: (input) => ipc.invoke(IPC_CHANNELS.workspace.updatePaneType, input) as Promise<Workspace>,
      updatePaneName: (input) => ipc.invoke(IPC_CHANNELS.workspace.updatePaneName, input) as Promise<Workspace>,
      updateEditorState: (input) => ipc.invoke(IPC_CHANNELS.workspace.updateEditorState, input) as Promise<Workspace>,
      updateOxeState: (input) => ipc.invoke(IPC_CHANNELS.workspace.updateOxeState, input) as Promise<Workspace>,
      updateAgentsState: (input) => ipc.invoke(IPC_CHANNELS.workspace.updateAgentsState, input) as Promise<Workspace>,
      updateReviewState: (input) => ipc.invoke(IPC_CHANNELS.workspace.updateReviewState, input) as Promise<Workspace>,
      updateSettings: (input) => ipc.invoke(IPC_CHANNELS.workspace.updateSettings, input) as Promise<Workspace>,
      pickFolder: () => ipc.invoke(IPC_CHANNELS.workspace.pickFolder) as Promise<string | null>,
      shellProfiles: () => ipc.invoke(IPC_CHANNELS.workspace.shellProfiles) as Promise<ShellProfile[]>
    },
    terminal: {
      start: (input) => ipc.invoke(IPC_CHANNELS.terminal.start, input) as Promise<void>,
      write: (input) => ipc.invoke(IPC_CHANNELS.terminal.write, input) as Promise<void>,
      resize: (input) => ipc.invoke(IPC_CHANNELS.terminal.resize, input) as Promise<void>,
      stop: (input) => ipc.invoke(IPC_CHANNELS.terminal.stop, input) as Promise<void>,
      restart: (input) => ipc.invoke(IPC_CHANNELS.terminal.restart, input) as Promise<void>,
      onData: (listener) => subscribe<TerminalDataEvent>(ipc, IPC_CHANNELS.terminal.onData, listener),
      onExit: (listener) => subscribe<TerminalExitEvent>(ipc, IPC_CHANNELS.terminal.onExit, listener)
    },
    agent: {
      list: () => ipc.invoke(IPC_CHANNELS.agent.list) as Promise<AgentProfile[]>,
      create: (input) => ipc.invoke(IPC_CHANNELS.agent.create, input) as Promise<AgentProfile>,
      update: (id, input) => ipc.invoke(IPC_CHANNELS.agent.update, id, input) as Promise<AgentProfile>,
      delete: (id) => ipc.invoke(IPC_CHANNELS.agent.delete, id) as Promise<void>,
      discover: (forceRefresh) => ipc.invoke(IPC_CHANNELS.agent.discover, forceRefresh) as Promise<AgentReadiness[]>,
      getReadiness: () => ipc.invoke(IPC_CHANNELS.agent.getReadiness) as Promise<AgentReadiness[]>
    },
    agentWorkflow: {
      listRuns: (workspaceId) => ipc.invoke(IPC_CHANNELS.agentWorkflow.listRuns, workspaceId) as Promise<import('../../shared/types/ipc').AgentWorkflowRun[]>,
      createRun: (input) => ipc.invoke(IPC_CHANNELS.agentWorkflow.createRun, input) as Promise<import('../../shared/types/ipc').AgentWorkflowRunDetails>,
      getRun: (runId) => ipc.invoke(IPC_CHANNELS.agentWorkflow.getRun, runId) as Promise<import('../../shared/types/ipc').AgentWorkflowRunDetails>,
      updateRoleBindings: (input) => ipc.invoke(IPC_CHANNELS.agentWorkflow.updateRoleBindings, input) as Promise<import('../../shared/types/ipc').WorkspaceAgentRoleBinding[]>,
      getRoleBindings: (workspaceId) => ipc.invoke(IPC_CHANNELS.agentWorkflow.getRoleBindings, workspaceId) as Promise<import('../../shared/types/ipc').WorkspaceAgentRoleBinding[]>,
      prepareStep: (input) => ipc.invoke(IPC_CHANNELS.agentWorkflow.prepareStep, input) as Promise<import('../../shared/types/ipc').AgentWorkflowRunDetails>,
      runStep: (input) => ipc.invoke(IPC_CHANNELS.agentWorkflow.runStep, input) as Promise<import('../../shared/types/ipc').AgentWorkflowRunDetails>,
      completeManualStep: (input) => ipc.invoke(IPC_CHANNELS.agentWorkflow.completeManualStep, input) as Promise<import('../../shared/types/ipc').AgentWorkflowRunDetails>,
      appendArtifact: (input) => ipc.invoke(IPC_CHANNELS.agentWorkflow.appendArtifact, input) as Promise<import('../../shared/types/ipc').AgentWorkflowRunDetails>
    },
    tasks: {
      list: (workspaceId) => ipc.invoke(IPC_CHANNELS.tasks.list, workspaceId) as Promise<Task[]>,
      create: (input) => ipc.invoke(IPC_CHANNELS.tasks.create, input) as Promise<Task>,
      update: (id, input) => ipc.invoke(IPC_CHANNELS.tasks.update, id, input) as Promise<Task>,
      delete: (id) => ipc.invoke(IPC_CHANNELS.tasks.delete, id) as Promise<void>,
      reorder: (input) => ipc.invoke(IPC_CHANNELS.tasks.reorder, input) as Promise<Task[]>,
      run: (input) => ipc.invoke(IPC_CHANNELS.tasks.run, input) as Promise<Task>,
      verify: (input) => ipc.invoke(IPC_CHANNELS.tasks.verify, input) as Promise<Task>,
      executions: (taskId) => ipc.invoke(IPC_CHANNELS.tasks.executions, taskId) as Promise<TaskExecution[]>,
      onVerifyOutput: (listener) => subscribe<TaskVerifyOutputEvent>(ipc, IPC_CHANNELS.tasks.onVerifyOutput, listener)
    },
    fs: {
      listTree: (input) => ipc.invoke(IPC_CHANNELS.fs.listTree, input) as Promise<FileTreeNode[]>,
      readFile: (input) => ipc.invoke(IPC_CHANNELS.fs.readFile, input) as Promise<FileSystemReadFileResult>,
      writeFile: (input) => ipc.invoke(IPC_CHANNELS.fs.writeFile, input) as Promise<FileSystemWriteFileResult>,
      watchFile: (input) => ipc.invoke(IPC_CHANNELS.fs.watchFile, input) as Promise<FileSystemWatchFileResult>,
      unwatchFile: (input) => ipc.invoke(IPC_CHANNELS.fs.unwatchFile, input) as Promise<void>,
      onFileChanged: (listener) => subscribe<FileSystemFileChangedEvent>(ipc, IPC_CHANNELS.fs.onFileChanged, listener)
    },
    oxe: {
      getStatus: (input) => ipc.invoke(IPC_CHANNELS.oxe.getStatus, input) as Promise<import('../../shared/types/ipc').OxeStatus>,
      getStatusJson: (input) => ipc.invoke(IPC_CHANNELS.oxe.getStatusJson, input) as Promise<import('../../shared/types/ipc').OxeStatus>,
      listArtifacts: (input) => ipc.invoke(IPC_CHANNELS.oxe.listArtifacts, input) as Promise<import('../../shared/types/ipc').OxeArtifactSummary[]>,
      listArtifactsRich: (input) => ipc.invoke(IPC_CHANNELS.oxe.listArtifactsRich, input) as Promise<import('../../shared/types/ipc').OxeArtifactSummary[]>,
      getFreshness: (input) => ipc.invoke(IPC_CHANNELS.oxe.getFreshness, input) as Promise<import('../../shared/types/ipc').OxeFreshness>,
      onWorkspaceDrift: (listener) => subscribe<import('../../shared/types/ipc').OxeFreshness & { workspaceId: string }>(ipc, IPC_CHANNELS.oxe.onWorkspaceDrift, listener),
      getGraph: (input) => ipc.invoke(IPC_CHANNELS.oxe.getGraph, input) as Promise<import('../../shared/types/oxe-graph').OxeExecutionGraph>,
      onGraphUpdate: (listener) => subscribe<import('../../shared/types/oxe-graph').OxeExecutionGraph>(ipc, IPC_CHANNELS.oxe.onGraphUpdate, listener)
    },
    git: {
      getDiff: (input) => ipc.invoke(IPC_CHANNELS.git.getDiff, input) as Promise<GitDiff>,
      onDiffUpdate: (listener) => subscribe<GitDiff>(ipc, IPC_CHANNELS.git.onDiffUpdate, listener)
    }
  }
}

function subscribe<TPayload>(
  ipc: PreloadIpc,
  channel: string,
  listener: (event: TPayload) => void
): () => void {
  const wrapped = (_event: IpcRendererEvent, payload: unknown): void => {
    listener(payload as TPayload)
  }

  ipc.on(channel, wrapped)
  return () => ipc.removeListener(channel, wrapped)
}
