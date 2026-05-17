import { app, BrowserWindow, clipboard, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import log from 'electron-log/main.js'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from './db/index'
import { registerAgentIpc } from './ipc/agent.ipc'
import { registerAgentWorkflowIpc } from './ipc/agent-workflow.ipc'
import { registerFileSystemIpc } from './ipc/file-system.ipc'
import { registerOxeIpc } from './ipc/oxe.ipc'
import { registerOxeGraphIpc } from './ipc/oxe-graph.ipc'
import { registerGitIpc } from './ipc/git.ipc'
import { registerGitHubIpc } from './ipc/github.ipc'
import { registerUsageIpc } from './ipc/usage.ipc'
import { registerBackgroundIpc } from './ipc/background.ipc'
import { registerTaskIpc } from './ipc/task.ipc'
import { registerTerminalIpc } from './ipc/terminal.ipc'
import { registerWorkspaceIpc } from './ipc/workspace.ipc'
import { BackgroundManager } from './services/background.service'
import { TerminalManager } from './services/terminal.service'
import { IPC_CHANNELS } from '../../shared/types/ipc'
import type { AgentWorkflowRunDetails } from '../../shared/types/agent-workflow'
import type { ShellProfile, Workspace, WorkspaceLayout, WorkspaceLayoutPreset } from '../../shared/types/workspace'

log.initialize()

const isDev = !app.isPackaged
let ipcRegistered = false

function registerIpcHandlers(): void {
  if (ipcRegistered) return
  if (process.env.OXESPACE_E2E_MOCK_NATIVE === '1') {
    registerE2eMockIpcHandlers()
    ipcRegistered = true
    return
  }

  let db: ReturnType<typeof openDatabase>
  try {
    db = openDatabase()
  } catch (error) {
    log.error('Native startup failed', error)
    registerNativeFailureIpcHandlers(toMessage(error))
    ipcRegistered = true
    return
  }

  const terminalManager = new TerminalManager(db, {
    emitData: (event) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(IPC_CHANNELS.terminal.onData, event)
      }
    },
    emitExit: (event) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(IPC_CHANNELS.terminal.onExit, event)
      }
    }
  })
  registerWorkspaceIpc(db, terminalManager)
  registerTerminalIpc(terminalManager)
  registerAgentIpc(db)
  registerAgentWorkflowIpc(db, { terminalWrite: (input) => terminalManager.write(input) })
  registerTaskIpc(db, terminalManager)
  registerOxeIpc()
  registerOxeGraphIpc()
  registerGitIpc()
  registerGitHubIpc(db)
  registerUsageIpc()
  const backgroundManager = new BackgroundManager(db, {
    emitOutput: (event) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(IPC_CHANNELS.background.onOutput, event)
      }
    },
    emitUpdate: (event) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(IPC_CHANNELS.background.onUpdate, event)
      }
    }
  })
  registerBackgroundIpc(backgroundManager)
  ipcMain.handle(IPC_CHANNELS.clipboard.saveImageToTemp, async () => {
    const image = clipboard.readImage()
    if (image.isEmpty()) return null
    const filePath = join(tmpdir(), `oxe-paste-${randomUUID()}.png`)
    await writeFile(filePath, image.toPNG())
    return filePath
  })
  const fileSystemService = registerFileSystemIpc()
  app.once('before-quit', () => {
    fileSystemService.closeAll()
    terminalManager.stopAll()
  })
  ipcRegistered = true
}

function registerNativeFailureIpcHandlers(message: string): void {
  const shellProfiles: ShellProfile[] = [
    { id: 'builtin-claude', name: 'claude', executable: 'claude', args: [], isBuiltin: true },
    { id: 'builtin-copilot', name: 'copilot', executable: 'copilot', args: [], isBuiltin: true }
  ]
  const fail = (): never => {
    throw new Error(`Native runtime unavailable: ${message}`)
  }

  ipcMain.handle(IPC_CHANNELS.workspace.list, () => [])
  ipcMain.handle(IPC_CHANNELS.workspace.shellProfiles, () => shellProfiles)
  ipcMain.handle(IPC_CHANNELS.workspace.create, fail)
  ipcMain.handle(IPC_CHANNELS.workspace.setActive, fail)
  ipcMain.handle(IPC_CHANNELS.workspace.delete, fail)
  ipcMain.handle(IPC_CHANNELS.workspace.closePane, fail)
  ipcMain.handle(IPC_CHANNELS.workspace.splitPane, fail)
  ipcMain.handle(IPC_CHANNELS.workspace.updatePaneType, fail)
  ipcMain.handle(IPC_CHANNELS.workspace.updateEditorState, fail)
  ipcMain.handle(IPC_CHANNELS.workspace.updateOxeState, fail)
  ipcMain.handle(IPC_CHANNELS.workspace.updateAgentsState, fail)
  ipcMain.handle(IPC_CHANNELS.workspace.updateReviewState, fail)
  ipcMain.handle(IPC_CHANNELS.workspace.updateGitHubState, fail)
  ipcMain.handle(IPC_CHANNELS.workspace.updateSettings, fail)
  ipcMain.handle(IPC_CHANNELS.workspace.pickFolder, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
    return result.canceled ? null : result.filePaths[0] ?? null
  })
  ipcMain.handle(IPC_CHANNELS.terminal.start, fail)
  ipcMain.handle(IPC_CHANNELS.terminal.write, fail)
  ipcMain.handle(IPC_CHANNELS.terminal.resize, fail)
  ipcMain.handle(IPC_CHANNELS.terminal.stop, fail)
  ipcMain.handle(IPC_CHANNELS.terminal.restart, fail)
  ipcMain.handle(IPC_CHANNELS.agent.list, () => [])
  ipcMain.handle(IPC_CHANNELS.agent.discover, () => [])
  ipcMain.handle(IPC_CHANNELS.agent.getReadiness, () => [])
  ipcMain.handle(IPC_CHANNELS.agent.create, fail)
  ipcMain.handle(IPC_CHANNELS.agent.update, fail)
  ipcMain.handle(IPC_CHANNELS.agent.delete, fail)
  ipcMain.handle(IPC_CHANNELS.agentWorkflow.listRuns, () => [])
  ipcMain.handle(IPC_CHANNELS.agentWorkflow.createRun, fail)
  ipcMain.handle(IPC_CHANNELS.agentWorkflow.getRun, fail)
  ipcMain.handle(IPC_CHANNELS.agentWorkflow.updateRoleBindings, fail)
  ipcMain.handle(IPC_CHANNELS.agentWorkflow.getRoleBindings, () => [])
  ipcMain.handle(IPC_CHANNELS.agentWorkflow.prepareStep, fail)
  ipcMain.handle(IPC_CHANNELS.agentWorkflow.runStep, fail)
  ipcMain.handle(IPC_CHANNELS.agentWorkflow.approvePlan, fail)
  ipcMain.handle(IPC_CHANNELS.agentWorkflow.rejectPlan, fail)
  ipcMain.handle(IPC_CHANNELS.agentWorkflow.requestPlanChanges, fail)
  ipcMain.handle(IPC_CHANNELS.agentWorkflow.sendApprovedExecution, fail)
  ipcMain.handle(IPC_CHANNELS.agentWorkflow.recordExecutionEvidence, fail)
  ipcMain.handle(IPC_CHANNELS.agentWorkflow.advanceRun, fail)
  ipcMain.handle(IPC_CHANNELS.agentWorkflow.completeManualStep, fail)
  ipcMain.handle(IPC_CHANNELS.agentWorkflow.appendArtifact, fail)
  ipcMain.handle(IPC_CHANNELS.tasks.list, () => [])
  ipcMain.handle(IPC_CHANNELS.tasks.create, fail)
  ipcMain.handle(IPC_CHANNELS.tasks.update, fail)
  ipcMain.handle(IPC_CHANNELS.tasks.delete, fail)
  ipcMain.handle(IPC_CHANNELS.tasks.reorder, fail)
  ipcMain.handle(IPC_CHANNELS.tasks.run, fail)
  ipcMain.handle(IPC_CHANNELS.tasks.verify, fail)
  ipcMain.handle(IPC_CHANNELS.tasks.executions, () => [])
  ipcMain.handle(IPC_CHANNELS.fs.listTree, fail)
  ipcMain.handle(IPC_CHANNELS.fs.readFile, fail)
  ipcMain.handle(IPC_CHANNELS.fs.writeFile, fail)
  ipcMain.handle(IPC_CHANNELS.fs.watchFile, fail)
  ipcMain.handle(IPC_CHANNELS.fs.unwatchFile, fail)
  ipcMain.handle(IPC_CHANNELS.oxe.getStatus, fail)
  ipcMain.handle(IPC_CHANNELS.oxe.listArtifacts, fail)
  for (const channel of Object.values(IPC_CHANNELS.github)) {
    ipcMain.handle(channel, fail)
  }
}

function registerE2eMockIpcHandlers(): void {
  const shellProfiles: ShellProfile[] = [
    { id: 'builtin-claude', name: 'claude', executable: 'claude', args: [], isBuiltin: true },
    { id: 'builtin-copilot', name: 'copilot', executable: 'copilot', args: [], isBuiltin: true }
  ]
  const workspaces: Workspace[] = []
  const workflowDetails = new Map<string, AgentWorkflowRunDetails>()

  ipcMain.handle(IPC_CHANNELS.workspace.list, () => workspaces)
  ipcMain.handle(IPC_CHANNELS.workspace.shellProfiles, () => shellProfiles)
  ipcMain.handle(IPC_CHANNELS.workspace.create, (_event: IpcMainInvokeEvent, input: { rootPath: string; layout?: WorkspaceLayout; layoutPreset?: WorkspaceLayoutPreset; defaultShellProfileId?: string; autoStart?: boolean }) => {
    const layout = input.layout ?? presetToLayout(input.layoutPreset ?? 4)
    const workspace: Workspace = {
      id: randomUUID(),
      name: input.rootPath.replaceAll('\\', '/').split('/').filter(Boolean).at(-1) ?? 'workspace',
      rootPath: input.rootPath,
      layout,
      layoutPreset: input.layoutPreset ?? layoutToPreset(layout),
      themeId: 'midnight',
      uiDensity: 'compact',
      defaultShellProfileId: input.defaultShellProfileId ?? 'builtin-claude',
      autoStart: input.autoStart !== false,
      isActive: true,
      editorVisible: false,
      editorExpanded: false,
      editorWidthPercent: 40,
      oxePanelVisible: false,
      oxePanelExpanded: false,
      oxePanelWidthPercent: 40,
      agentsPanelVisible: false,
      agentsPanelExpanded: false,
      agentsPanelWidthPercent: 36,
      reviewPanelVisible: false,
      reviewPanelExpanded: false,
      reviewPanelWidthPercent: 40,
      githubPanelVisible: false,
      githubPanelExpanded: false,
      githubPanelWidthPercent: 40,
      githubActiveTab: 'status',
      panes: []
    }
    workspace.panes = createMockPanes(workspace.id, layout)

    for (const item of workspaces) item.isActive = false
    workspaces.unshift(workspace)
    return workspace
  })
  ipcMain.handle(IPC_CHANNELS.workspace.setActive, (_event: IpcMainInvokeEvent, id: string) => {
    const workspace = workspaces.find((item) => item.id === id)
    if (!workspace) throw new Error(`Workspace ${id} not found`)
    for (const item of workspaces) item.isActive = item.id === id
    return workspace
  })
  ipcMain.handle(IPC_CHANNELS.workspace.delete, (_event: IpcMainInvokeEvent, id: string) => {
    const index = workspaces.findIndex((item) => item.id === id)
    if (index >= 0) workspaces.splice(index, 1)
  })
  ipcMain.handle(IPC_CHANNELS.workspace.closePane, (_event: IpcMainInvokeEvent, paneId: string) => {
    for (const workspace of workspaces) {
      workspace.panes = workspace.panes.filter((pane) => pane.id !== paneId)
    }
  })
  ipcMain.handle(IPC_CHANNELS.workspace.splitPane, (_event: IpcMainInvokeEvent, input: { paneId: string }) => {
    const workspace = workspaces.find((item) => item.panes.some((pane) => pane.id === input.paneId))
    if (!workspace) throw new Error(`Pane ${input.paneId} not found`)
    return workspace
  })
  ipcMain.handle(IPC_CHANNELS.workspace.updatePaneType, (_event: IpcMainInvokeEvent, input: { paneId: string; type: Workspace['panes'][number]['type'] }) => {
    for (const workspace of workspaces) {
      const pane = workspace.panes.find((item) => item.id === input.paneId)
      if (pane) {
        pane.type = input.type
        pane.status = 'idle'
        return workspace
      }
    }
    throw new Error(`Pane ${input.paneId} not found`)
  })
  ipcMain.handle(IPC_CHANNELS.workspace.updateEditorState, (_event: IpcMainInvokeEvent, input: { workspaceId: string; editorVisible?: boolean; editorExpanded?: boolean; editorWidthPercent?: number }) => {
    const workspace = workspaces.find((item) => item.id === input.workspaceId)
    if (!workspace) throw new Error(`Workspace ${input.workspaceId} not found`)
    workspace.editorVisible = input.editorVisible ?? workspace.editorVisible
    workspace.editorExpanded = input.editorExpanded ?? workspace.editorExpanded
    workspace.editorWidthPercent = input.editorWidthPercent ?? workspace.editorWidthPercent
    return workspace
  })
  ipcMain.handle(IPC_CHANNELS.workspace.updateOxeState, (_event: IpcMainInvokeEvent, input: { workspaceId: string; oxePanelVisible?: boolean; oxePanelExpanded?: boolean; oxePanelWidthPercent?: number }) => {
    const workspace = workspaces.find((item) => item.id === input.workspaceId)
    if (!workspace) throw new Error(`Workspace ${input.workspaceId} not found`)
    workspace.oxePanelVisible = input.oxePanelVisible ?? workspace.oxePanelVisible
    workspace.oxePanelExpanded = input.oxePanelExpanded ?? workspace.oxePanelExpanded
    workspace.oxePanelWidthPercent = input.oxePanelWidthPercent ?? workspace.oxePanelWidthPercent
    return workspace
  })
  ipcMain.handle(IPC_CHANNELS.workspace.updateAgentsState, (_event: IpcMainInvokeEvent, input: { workspaceId: string; agentsPanelVisible?: boolean; agentsPanelExpanded?: boolean; agentsPanelWidthPercent?: number }) => {
    const workspace = workspaces.find((item) => item.id === input.workspaceId)
    if (!workspace) throw new Error(`Workspace ${input.workspaceId} not found`)
    workspace.agentsPanelVisible = input.agentsPanelVisible ?? workspace.agentsPanelVisible
    workspace.agentsPanelExpanded = input.agentsPanelExpanded ?? workspace.agentsPanelExpanded
    workspace.agentsPanelWidthPercent = input.agentsPanelWidthPercent ?? workspace.agentsPanelWidthPercent
    return workspace
  })
  ipcMain.handle(IPC_CHANNELS.workspace.updateReviewState, (_event: IpcMainInvokeEvent, input: { workspaceId: string; reviewPanelVisible?: boolean; reviewPanelExpanded?: boolean; reviewPanelWidthPercent?: number }) => {
    const workspace = workspaces.find((item) => item.id === input.workspaceId)
    if (!workspace) throw new Error(`Workspace ${input.workspaceId} not found`)
    workspace.reviewPanelVisible = input.reviewPanelVisible ?? workspace.reviewPanelVisible
    workspace.reviewPanelExpanded = input.reviewPanelExpanded ?? workspace.reviewPanelExpanded
    workspace.reviewPanelWidthPercent = input.reviewPanelWidthPercent ?? workspace.reviewPanelWidthPercent
    return workspace
  })
  ipcMain.handle(IPC_CHANNELS.workspace.updateGitHubState, (_event: IpcMainInvokeEvent, input: { workspaceId: string; githubPanelVisible?: boolean; githubPanelExpanded?: boolean; githubPanelWidthPercent?: number; githubActiveTab?: Workspace['githubActiveTab'] }) => {
    const workspace = workspaces.find((item) => item.id === input.workspaceId)
    if (!workspace) throw new Error(`Workspace ${input.workspaceId} not found`)
    workspace.githubPanelVisible = input.githubPanelVisible ?? workspace.githubPanelVisible
    workspace.githubPanelExpanded = input.githubPanelExpanded ?? workspace.githubPanelExpanded
    workspace.githubPanelWidthPercent = input.githubPanelWidthPercent ?? workspace.githubPanelWidthPercent
    workspace.githubActiveTab = input.githubActiveTab ?? workspace.githubActiveTab
    return workspace
  })
  ipcMain.handle(IPC_CHANNELS.workspace.updateSettings, (_event: IpcMainInvokeEvent, input: { workspaceId: string; themeId?: Workspace['themeId']; uiDensity?: Workspace['uiDensity']; defaultShellProfileId?: string; layoutPreset?: WorkspaceLayoutPreset }) => {
    const workspace = workspaces.find((item) => item.id === input.workspaceId)
    if (!workspace) throw new Error(`Workspace ${input.workspaceId} not found`)
    workspace.themeId = input.themeId ?? workspace.themeId
    workspace.uiDensity = input.uiDensity ?? workspace.uiDensity
    workspace.defaultShellProfileId = input.defaultShellProfileId ?? workspace.defaultShellProfileId
    if (input.layoutPreset) {
      workspace.layoutPreset = input.layoutPreset
      workspace.layout = presetToLayout(input.layoutPreset)
      workspace.panes = createMockPanes(workspace.id, workspace.layout)
    }
    return workspace
  })
  ipcMain.handle(IPC_CHANNELS.workspace.pickFolder, () => null)
  ipcMain.handle(IPC_CHANNELS.terminal.start, (_event: IpcMainInvokeEvent, input: { paneId: string }) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IPC_CHANNELS.terminal.onData, { paneId: input.paneId, data: 'PS> ' })
    }
  })
  ipcMain.handle(IPC_CHANNELS.terminal.write, (_event: IpcMainInvokeEvent, input: { paneId: string; data: string }) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IPC_CHANNELS.terminal.onData, { paneId: input.paneId, data: input.data })
    }
  })
  ipcMain.handle(IPC_CHANNELS.terminal.resize, () => undefined)
  ipcMain.handle(IPC_CHANNELS.terminal.stop, () => undefined)
  ipcMain.handle(IPC_CHANNELS.terminal.restart, () => undefined)
  ipcMain.handle(IPC_CHANNELS.agent.list, () => [])
  ipcMain.handle(IPC_CHANNELS.agent.discover, () => [])
  ipcMain.handle(IPC_CHANNELS.agent.getReadiness, () => [])
  ipcMain.handle(IPC_CHANNELS.agent.create, () => undefined)
  ipcMain.handle(IPC_CHANNELS.agent.update, () => undefined)
  ipcMain.handle(IPC_CHANNELS.agent.delete, () => undefined)
  ipcMain.handle(IPC_CHANNELS.agentWorkflow.listRuns, (_event: IpcMainInvokeEvent, workspaceId: string) => {
    return [...workflowDetails.values()]
      .map((details) => details.run)
      .filter((run) => run.workspaceId === workspaceId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  })
  ipcMain.handle(IPC_CHANNELS.agentWorkflow.createRun, (_event: IpcMainInvokeEvent, input: { workspaceId: string; title: string; sourceType?: 'manual' | 'task' | 'oxe'; sourceId?: string | null; initialPrompt?: string }) => {
    const now = Date.now()
    const runId = randomUUID()
    const details: AgentWorkflowRunDetails = {
      run: {
        id: runId,
        workspaceId: input.workspaceId,
        sourceType: input.sourceType ?? 'manual',
        sourceId: input.sourceId ?? null,
        title: input.title,
        status: 'draft',
        createdAt: now,
        updatedAt: now
      },
      steps: ['rubber_duck', 'planner', 'executor', 'reviewer', 'verifier', 'publisher'].map((role) => ({
        id: randomUUID(),
        runId,
        role: role as AgentWorkflowRunDetails['steps'][number]['role'],
        agentProfileId: null,
        shellProfileId: null,
        status: 'pending',
        prompt: '',
        output: '',
        error: null,
        startedAt: null,
        completedAt: null
      })),
      artifacts: input.initialPrompt ? [{
        id: randomUUID(),
        runId,
        stepId: null,
        kind: 'clarification',
        title: 'Initial input',
        content: input.initialPrompt,
        createdAt: now
      }] : []
    }
    workflowDetails.set(runId, details)
    return details
  })
  ipcMain.handle(IPC_CHANNELS.agentWorkflow.getRun, (_event: IpcMainInvokeEvent, runId: string) => {
    const details = workflowDetails.get(runId)
    if (!details) throw new Error(`Workflow run not found: ${runId}`)
    return details
  })
  ipcMain.handle(IPC_CHANNELS.agentWorkflow.updateRoleBindings, () => [])
  ipcMain.handle(IPC_CHANNELS.agentWorkflow.getRoleBindings, () => [])
  ipcMain.handle(IPC_CHANNELS.agentWorkflow.prepareStep, (_event: IpcMainInvokeEvent, input: { runId: string; role: AgentWorkflowRunDetails['steps'][number]['role'] }) => {
    const details = getMockWorkflow(workflowDetails, input.runId)
    const step = details.steps.find((item) => item.role === input.role)
    if (!step) throw new Error(`Workflow step not found: ${input.role}`)
    const prompt = `# ${input.role} step for ${details.run.title}\n\n${details.artifacts.map((artifact) => `## ${artifact.title}\n${artifact.content}`).join('\n\n')}`.trim()
    step.status = 'prepared'
    step.prompt = prompt
    details.run.status = input.role === 'executor' ? 'executing' : input.role === 'verifier' ? 'verifying' : 'planned'
    details.run.updatedAt = Date.now()
    return details
  })
  ipcMain.handle(IPC_CHANNELS.agentWorkflow.runStep, (_event: IpcMainInvokeEvent, input: { stepId: string; paneId: string }) => {
    const { details, step } = getMockWorkflowStep(workflowDetails, input.stepId)
    step.status = 'sent_to_terminal'
    step.startedAt = Date.now()
    details.artifacts.push({ id: randomUUID(), runId: details.run.id, stepId: step.id, kind: 'execution_prompt', title: 'Prompt sent', content: step.prompt, createdAt: Date.now() })
    return details
  })
  ipcMain.handle(IPC_CHANNELS.agentWorkflow.approvePlan, (_event: IpcMainInvokeEvent, input: { runId: string; planContent: string }) => {
    const details = getMockWorkflow(workflowDetails, input.runId)
    const step = details.steps.find((item) => item.role === 'planner')
    if (step) {
      step.status = 'approved'
      step.output = input.planContent
      step.completedAt = Date.now()
    }
    details.artifacts.push({ id: randomUUID(), runId: details.run.id, stepId: step?.id ?? null, kind: 'approved_plan', title: 'Approved plan', content: input.planContent, createdAt: Date.now() })
    details.run.status = 'planned'
    details.run.updatedAt = Date.now()
    return details
  })
  ipcMain.handle(IPC_CHANNELS.agentWorkflow.rejectPlan, (_event: IpcMainInvokeEvent, input: { runId: string; reason: string }) => {
    const details = getMockWorkflow(workflowDetails, input.runId)
    details.run.status = 'blocked'
    details.artifacts.push({ id: randomUUID(), runId: details.run.id, stepId: null, kind: 'rejection', title: 'Plan rejected', content: input.reason, createdAt: Date.now() })
    return details
  })
  ipcMain.handle(IPC_CHANNELS.agentWorkflow.requestPlanChanges, (_event: IpcMainInvokeEvent, input: { runId: string; feedback: string }) => {
    const details = getMockWorkflow(workflowDetails, input.runId)
    details.artifacts.push({ id: randomUUID(), runId: details.run.id, stepId: null, kind: 'plan_feedback', title: 'Requested plan changes', content: input.feedback, createdAt: Date.now() })
    details.run.updatedAt = Date.now()
    return details
  })
  ipcMain.handle(IPC_CHANNELS.agentWorkflow.sendApprovedExecution, (_event: IpcMainInvokeEvent, input: { stepId: string; paneId: string }) => {
    const { details, step } = getMockWorkflowStep(workflowDetails, input.stepId)
    const approved = [...details.artifacts].reverse().find((artifact) => artifact.kind === 'approved_plan')
    if (!approved) throw new Error('Approve a plan before execution')
    const prompt = `# Execute approved plan\n\n${approved.content}`
    step.status = 'sent_to_terminal'
    step.prompt = prompt
    step.startedAt = Date.now()
    details.artifacts.push({ id: randomUUID(), runId: details.run.id, stepId: step.id, kind: 'execution_prompt', title: 'Approved execution prompt', content: prompt, createdAt: Date.now() })
    details.run.status = 'executing'
    details.run.updatedAt = Date.now()
    return details
  })
  ipcMain.handle(IPC_CHANNELS.agentWorkflow.recordExecutionEvidence, (_event: IpcMainInvokeEvent, input: { stepId: string; output: string }) => {
    const { details, step } = getMockWorkflowStep(workflowDetails, input.stepId)
    step.status = 'completed'
    step.output = input.output
    step.completedAt = Date.now()
    const kind = step.role === 'verifier' ? 'verification_report' : step.role === 'reviewer' ? 'review_findings' : 'execution_evidence'
    details.artifacts.push({ id: randomUUID(), runId: details.run.id, stepId: step.id, kind, title: `${step.role} evidence`, content: input.output, createdAt: Date.now() })
    details.run.status = step.role === 'verifier' ? 'done' : step.role === 'executor' ? 'verifying' : details.run.status
    details.run.updatedAt = Date.now()
    return details
  })
  ipcMain.handle(IPC_CHANNELS.agentWorkflow.advanceRun, (_event: IpcMainInvokeEvent, input: { runId: string; targetStatus: AgentWorkflowRunDetails['run']['status']; overrideReason?: string }) => {
    const details = getMockWorkflow(workflowDetails, input.runId)
    if (input.overrideReason) details.artifacts.push({ id: randomUUID(), runId: details.run.id, stepId: null, kind: 'verification_report', title: 'Verification override', content: input.overrideReason, createdAt: Date.now() })
    details.run.status = input.targetStatus
    details.run.updatedAt = Date.now()
    return details
  })
  ipcMain.handle(IPC_CHANNELS.agentWorkflow.completeManualStep, (_event: IpcMainInvokeEvent, input: { stepId: string; output: string }) => {
    const { details, step } = getMockWorkflowStep(workflowDetails, input.stepId)
    step.status = 'completed'
    step.output = input.output
    return details
  })
  ipcMain.handle(IPC_CHANNELS.agentWorkflow.appendArtifact, (_event: IpcMainInvokeEvent, input: { runId: string; stepId?: string | null; kind: AgentWorkflowRunDetails['artifacts'][number]['kind']; title: string; content: string }) => {
    const details = getMockWorkflow(workflowDetails, input.runId)
    details.artifacts.push({ id: randomUUID(), runId: details.run.id, stepId: input.stepId ?? null, kind: input.kind, title: input.title, content: input.content, createdAt: Date.now() })
    details.run.updatedAt = Date.now()
    return details
  })
  ipcMain.handle(IPC_CHANNELS.tasks.list, () => [])
  ipcMain.handle(IPC_CHANNELS.tasks.create, () => undefined)
  ipcMain.handle(IPC_CHANNELS.tasks.update, () => undefined)
  ipcMain.handle(IPC_CHANNELS.tasks.delete, () => undefined)
  ipcMain.handle(IPC_CHANNELS.tasks.reorder, () => [])
  ipcMain.handle(IPC_CHANNELS.tasks.run, () => undefined)
  ipcMain.handle(IPC_CHANNELS.tasks.verify, () => undefined)
  ipcMain.handle(IPC_CHANNELS.tasks.executions, () => [])
  ipcMain.handle(IPC_CHANNELS.fs.listTree, () => [])
  ipcMain.handle(IPC_CHANNELS.fs.readFile, () => {
    throw new Error('File system API is not available in E2E mock mode')
  })
  ipcMain.handle(IPC_CHANNELS.fs.writeFile, () => {
    throw new Error('File system API is not available in E2E mock mode')
  })
  ipcMain.handle(IPC_CHANNELS.fs.watchFile, () => {
    throw new Error('File system API is not available in E2E mock mode')
  })
  ipcMain.handle(IPC_CHANNELS.fs.unwatchFile, () => undefined)
  ipcMain.handle(IPC_CHANNELS.oxe.getStatus, (_event: IpcMainInvokeEvent, input: { workspaceId: string; rootPath: string }) => ({
    workspaceId: input.workspaceId,
    rootPath: input.rootPath,
    isOxeProject: false,
    engine: { available: false, version: null, command: 'oxe-cc', message: 'E2E mock mode' },
    state: null,
    artifacts: [],
    warnings: [],
    updatedAt: new Date().toISOString()
  }))
  ipcMain.handle(IPC_CHANNELS.oxe.listArtifacts, () => [])
  ipcMain.handle(IPC_CHANNELS.github.getCliStatus, () => ({ available: false, authenticated: false, user: null, host: null, message: 'E2E mock mode' }))
  ipcMain.handle(IPC_CHANNELS.github.getWorkspaceStatus, (_event: IpcMainInvokeEvent, input: { workspaceId: string; rootPath: string }) => ({
    cli: { available: false, authenticated: false, user: null, host: null, message: 'E2E mock mode' },
    repository: { owner: null, name: null, fullName: null, url: null, isPrivate: null, defaultBranch: null, remoteName: null, remoteUrl: null, detected: false },
    isGitRepository: false,
    branch: null,
    lastCommit: null,
    lastCommitRelative: null,
    lastPushRelative: null,
    staged: 0,
    modified: 0,
    untracked: 0,
    ahead: 0,
    behind: 0,
    hasUncommittedChanges: false,
    workspaceId: input.workspaceId,
    rootPath: input.rootPath
  }))
  ipcMain.handle(IPC_CHANNELS.github.listBranches, () => [])
  ipcMain.handle(IPC_CHANNELS.github.listPullRequests, () => [])
  ipcMain.handle(IPC_CHANNELS.github.listCommits, () => [])
  ipcMain.handle(IPC_CHANNELS.github.listReleases, () => [])
  ipcMain.handle(IPC_CHANNELS.github.listWorkflows, () => [])
  ipcMain.handle(IPC_CHANNELS.github.listWorkflowRuns, () => [])
  ipcMain.handle(IPC_CHANNELS.github.listCheckpoints, () => [])
  ipcMain.handle(IPC_CHANNELS.github.listConnectedRepositories, () => [])
  ipcMain.handle(IPC_CHANNELS.github.fetch, () => ({ ok: true, message: 'E2E mock mode' }))
  ipcMain.handle(IPC_CHANNELS.github.stageAll, () => ({ ok: true, message: 'E2E mock mode' }))
  ipcMain.handle(IPC_CHANNELS.github.commit, () => ({ ok: true, message: 'E2E mock mode' }))
  ipcMain.handle(IPC_CHANNELS.github.push, () => ({ ok: true, message: 'E2E mock mode' }))
  ipcMain.handle(IPC_CHANNELS.github.commitAndPush, () => ({ ok: true, message: 'E2E mock mode' }))
  ipcMain.handle(IPC_CHANNELS.github.createBranch, () => ({ ok: true, message: 'E2E mock mode' }))
  ipcMain.handle(IPC_CHANNELS.github.checkoutBranch, () => ({ ok: true, message: 'E2E mock mode' }))
  ipcMain.handle(IPC_CHANNELS.github.createPullRequest, () => ({ ok: true, message: 'E2E mock mode' }))
  ipcMain.handle(IPC_CHANNELS.github.createRelease, () => ({ ok: true, message: 'E2E mock mode' }))
  ipcMain.handle(IPC_CHANNELS.github.runWorkflow, () => ({ ok: true, message: 'E2E mock mode' }))
  ipcMain.handle(IPC_CHANNELS.github.createCheckpoint, (_event: IpcMainInvokeEvent, input: { workspaceId: string; name: string; description?: string }) => ({
    id: randomUUID(),
    workspaceId: input.workspaceId,
    name: input.name,
    description: input.description ?? null,
    branch: null,
    baseCommit: null,
    patch: '',
    untrackedFiles: [],
    createdAt: Date.now()
  }))
  ipcMain.handle(IPC_CHANNELS.github.restoreCheckpoint, () => ({ ok: true, message: 'E2E mock mode' }))
  ipcMain.handle(IPC_CHANNELS.github.deleteCheckpoint, () => ({ ok: true, message: 'E2E mock mode' }))
  ipcMain.handle(IPC_CHANNELS.github.connectRepository, (_event: IpcMainInvokeEvent, input: { workspaceId: string; fullName: string; url?: string | null }) => ({
    id: randomUUID(),
    workspaceId: input.workspaceId,
    fullName: input.fullName,
    url: input.url ?? null,
    createdAt: Date.now()
  }))
}

function getMockWorkflow(workflows: Map<string, AgentWorkflowRunDetails>, runId: string): AgentWorkflowRunDetails {
  const details = workflows.get(runId)
  if (!details) throw new Error(`Workflow run not found: ${runId}`)
  return details
}

function getMockWorkflowStep(workflows: Map<string, AgentWorkflowRunDetails>, stepId: string): { details: AgentWorkflowRunDetails; step: AgentWorkflowRunDetails['steps'][number] } {
  for (const details of workflows.values()) {
    const step = details.steps.find((item) => item.id === stepId)
    if (step) return { details, step }
  }
  throw new Error(`Workflow step not found: ${stepId}`)
}

function createMockPanes(workspaceId: string, layout: WorkspaceLayout): Workspace['panes'] {
  const [rows, columns] = layout.split('x').map(Number)
  return Array.from({ length: rows * columns }, (_, index) => {
    const rowIndex = Math.floor(index / columns)
    const columnIndex = index % columns
    return {
      id: randomUUID(),
      workspaceId,
      type: 'terminal',
      rowIndex,
      columnIndex,
      shellProfileId: 'builtin-claude',
      status: 'idle',
      agentProfileId: null,
      agentName: null,
      displayName: null,
      createdAt: null,
      modelOverride: null,
      rootPath: null
    }
  })
}

function presetToLayout(preset: WorkspaceLayoutPreset): WorkspaceLayout {
  const layouts: Record<WorkspaceLayoutPreset, WorkspaceLayout> = {
    1: '1x1',
    2: '1x2',
    4: '2x2',
    6: '2x3',
    8: '2x4',
    10: '2x5',
    12: '3x4',
    14: '2x7',
    16: '4x4'
  }
  return layouts[preset]
}

function layoutToPreset(layout: WorkspaceLayout): WorkspaceLayoutPreset {
  const preset = Object.entries({
    1: '1x1',
    2: '1x2',
    4: '2x2',
    6: '2x3',
    8: '2x4',
    10: '2x5',
    12: '3x4',
    14: '2x7',
    16: '4x4'
  }).find(([, value]) => value === layout)?.[0]
  return (Number(preset ?? 4) as WorkspaceLayoutPreset)
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown native startup error'
}

function createMainWindow(): BrowserWindow {
  const iconPath = isDev
    ? join(process.cwd(), 'resources', 'icon.ico')
    : join(process.resourcesPath, 'icon.ico')

  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'OXESpace',
    icon: iconPath,
    backgroundColor: '#0d0f14',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

const gotLock = process.env.OXESPACE_DISABLE_SINGLE_INSTANCE === '1' || app.requestSingleInstanceLock()

if (!gotLock) {
  app.quit()
} else {
  app.whenReady().then(() => {
    registerIpcHandlers()
    createMainWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow()
      }
    })
  })

  app.on('second-instance', () => {
    const [window] = BrowserWindow.getAllWindows()
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.focus()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}
