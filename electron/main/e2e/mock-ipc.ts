/**
 * IPC handlers that stand in for every native subsystem during E2E runs.
 *
 * This module exists so the mocks are NOT in the production main bundle. They
 * used to live in index.ts, which meant ~475 lines of test doubles were
 * compiled into out/main/index.js and shipped, guarded only by a runtime env
 * check. index.ts now reaches them through a dynamic import inside that same
 * guard, so rollup emits them as a separate chunk that a normal launch never
 * loads or parses.
 *
 * Everything here is deliberately in-memory: no SQLite, no PTY, no gh. That is
 * what lets the E2E suite run on a machine with no native modules built, and
 * what makes the perf benchmark measure the renderer rather than the shell.
 */
import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { randomUUID } from 'node:crypto'
import { defaultSplitShellProfileId, fallbackShellProfiles } from '../services/shell-profile.defaults'
// The one real service the mocks keep: file reads are what the editor and
// preview specs actually assert on, and faking a filesystem would test the fake.
import { FileSystemService } from '../services/file-system.service'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { ShellProfile, Workspace, WorkspaceLayout, WorkspaceLayoutPreset } from '../../../shared/types/workspace'

export function registerE2eMockIpcHandlers(): void {
  const shellProfiles: ShellProfile[] = fallbackShellProfiles()
  const workspaces: Workspace[] = []

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
      reviewPanelVisible: false,
      reviewPanelExpanded: false,
      reviewPanelWidthPercent: 40,
      githubPanelVisible: false,
      githubPanelExpanded: false,
      githubPanelWidthPercent: 40,
      githubActiveTab: 'status',
      backgroundPanelVisible: false,
      backgroundPanelExpanded: false,
      backgroundPanelWidthPercent: 28,
      worktreePanelVisible: false,
      worktreePanelExpanded: false,
      worktreePanelWidthPercent: 36,
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
      const before = workspace.panes.length
      workspace.panes = workspace.panes.filter((pane) => pane.id !== paneId)
      if (workspace.panes.length !== before) return workspace
    }
    return null
  })
  ipcMain.handle(IPC_CHANNELS.workspace.splitPane, (_event: IpcMainInvokeEvent, input: { paneId: string; direction?: 'vertical' | 'horizontal' }) => {
    const workspace = workspaces.find((item) => item.panes.some((pane) => pane.id === input.paneId))
    if (!workspace) throw new Error(`Pane ${input.paneId} not found`)
    const source = workspace.panes.find((pane) => pane.id === input.paneId)
    if (!source) throw new Error(`Pane ${input.paneId} not found`)
    const [rows, columns] = workspace.layout.split('x').map(Number)
    const targetRow = input.direction === 'horizontal' ? source.rowIndex + 1 : source.rowIndex
    const targetColumn = input.direction === 'horizontal' ? source.columnIndex : source.columnIndex + 1
    const nextLayout = input.direction === 'horizontal'
      ? `${Math.max(rows, targetRow + 1)}x${columns}` as WorkspaceLayout
      : `${rows}x${Math.max(columns, targetColumn + 1)}` as WorkspaceLayout
    workspace.layout = nextLayout
    workspace.layoutPreset = layoutToPreset(nextLayout)
    workspace.panes.push({
      id: randomUUID(),
      workspaceId: workspace.id,
      type: 'terminal',
      rowIndex: targetRow,
      columnIndex: targetColumn,
      shellProfileId: defaultSplitShellProfileId(),
      status: 'idle',
      agentProfileId: null,
      agentName: null,
      displayName: null,
      createdAt: null,
      rootPath: null
    })
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
  ipcMain.handle(IPC_CHANNELS.workspace.updateBackgroundState, (_event: IpcMainInvokeEvent, input: { workspaceId: string; backgroundPanelVisible?: boolean; backgroundPanelExpanded?: boolean; backgroundPanelWidthPercent?: number }) => {
    const workspace = workspaces.find((item) => item.id === input.workspaceId)
    if (!workspace) throw new Error(`Workspace ${input.workspaceId} not found`)
    workspace.backgroundPanelVisible = input.backgroundPanelVisible ?? workspace.backgroundPanelVisible
    workspace.backgroundPanelExpanded = input.backgroundPanelExpanded ?? workspace.backgroundPanelExpanded
    workspace.backgroundPanelWidthPercent = input.backgroundPanelWidthPercent ?? workspace.backgroundPanelWidthPercent
    return workspace
  })
  ipcMain.handle(IPC_CHANNELS.workspace.updateWorktreeState, (_event: IpcMainInvokeEvent, input: { workspaceId: string; worktreePanelVisible?: boolean; worktreePanelExpanded?: boolean; worktreePanelWidthPercent?: number }) => {
    const workspace = workspaces.find((item) => item.id === input.workspaceId)
    if (!workspace) throw new Error(`Workspace ${input.workspaceId} not found`)
    workspace.worktreePanelVisible = input.worktreePanelVisible ?? workspace.worktreePanelVisible
    workspace.worktreePanelExpanded = input.worktreePanelExpanded ?? workspace.worktreePanelExpanded
    workspace.worktreePanelWidthPercent = input.worktreePanelWidthPercent ?? workspace.worktreePanelWidthPercent
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
  ipcMain.handle(IPC_CHANNELS.workspace.setPaneAgent, (_event: IpcMainInvokeEvent, input: { paneId: string; agentProfileId: string | null }) => {
    for (const workspace of workspaces) {
      const pane = workspace.panes.find((item) => item.id === input.paneId)
      if (!pane) continue
      pane.agentProfileId = input.agentProfileId
      pane.agentName = input.agentProfileId === 'agent-copilot' ? 'Copilot' : input.agentProfileId === 'agent-claude' ? 'Claude' : null
      return workspace
    }
    throw new Error(`Pane ${input.paneId} not found`)
  })
  ipcMain.handle(IPC_CHANNELS.workspace.pickFolder, () => null)
  ipcMain.handle(IPC_CHANNELS.semantic.getStatus, () => ({ enabled: true, workerReady: false, indexing: false, count: 0, lastError: null, mode: 'auto', coverage: { lexicalDocuments: 0, lastIndexedAt: null, byCategory: { source: 0, test: 0, config: 0, docs: 0, other: 0 } }, lastQuery: null }))
  ipcMain.handle(IPC_CHANNELS.semantic.setEnabled, (_event: IpcMainInvokeEvent, input: { enabled: boolean }) => ({ enabled: input?.enabled ?? true, workerReady: false, indexing: false, count: 0, lastError: null, mode: 'auto', coverage: { lexicalDocuments: 0, lastIndexedAt: null, byCategory: { source: 0, test: 0, config: 0, docs: 0, other: 0 } }, lastQuery: null }))
  ipcMain.handle(IPC_CHANNELS.semantic.setMode, (_event: IpcMainInvokeEvent, input: { mode?: string }) => ({ enabled: true, workerReady: false, indexing: false, count: 0, lastError: null, mode: input?.mode ?? 'auto', coverage: { lexicalDocuments: 0, lastIndexedAt: null, byCategory: { source: 0, test: 0, config: 0, docs: 0, other: 0 } }, lastQuery: null }))
  ipcMain.handle(IPC_CHANNELS.semantic.getLogs, () => [])
  ipcMain.handle(IPC_CHANNELS.diagnostics.getSnapshot, () => ({
    generatedAt: Date.now(), appVersion: app.getVersion(), platform: process.platform, arch: process.arch,
    nodeVersion: process.versions.node, electronVersion: process.versions.electron ?? 'unknown', workspaceCount: workspaces.length,
    checks: [
      { id: 'database', label: 'SQLite', tone: 'ok', detail: 'E2E mock' },
      { id: 'mcp', label: 'Internal MCP', tone: 'warning', detail: 'E2E mock' },
      { id: 'sandbox', label: 'Renderer sandbox', tone: 'ok', detail: 'enabled' }
    ]
  }))
  ipcMain.handle(IPC_CHANNELS.diagnostics.exportReport, () => null)
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
  // The mock never keeps a session, so a mounting view is told to start fresh
  // rather than waiting for a replay that will not come.
  ipcMain.handle(IPC_CHANNELS.terminal.attach, () => ({
    running: false, seq: 0, prologue: '', replay: '', truncated: false, altScreen: false
  }))
  ipcMain.handle(IPC_CHANNELS.terminal.detach, () => undefined)
  ipcMain.handle(IPC_CHANNELS.terminal.status, () => ({ running: false, seq: 0, altScreen: false }))
  ipcMain.handle(IPC_CHANNELS.voice.transcribe, () => ({ text: '', durationMs: 0 }))
  ipcMain.handle(IPC_CHANNELS.voice.getModelStatus, () => ({ size: 'base', ready: false, path: '', engineReady: false }))
  ipcMain.handle(IPC_CHANNELS.voice.ensureModel, () => ({ size: 'base', ready: false, path: '', engineReady: false }))
  ipcMain.handle(IPC_CHANNELS.notifications.notify, () => false)
  ipcMain.handle(IPC_CHANNELS.oxe.detect, () => ({ installed: false, version: null }))
  ipcMain.handle(IPC_CHANNELS.oxe.status, () => ({ installed: false, version: null, isOxeProject: false, status: null, error: null }))
  ipcMain.handle(IPC_CHANNELS.oxe.openDashboard, () => ({ ok: false, error: null }))
  ipcMain.handle(IPC_CHANNELS.agent.list, () => [])
  ipcMain.handle(IPC_CHANNELS.agent.discover, () => [])
  ipcMain.handle(IPC_CHANNELS.agent.getReadiness, () => [])
  ipcMain.handle(IPC_CHANNELS.agent.create, () => undefined)
  ipcMain.handle(IPC_CHANNELS.agent.update, () => undefined)
  ipcMain.handle(IPC_CHANNELS.agent.delete, () => undefined)
  ipcMain.handle(IPC_CHANNELS.tasks.list, () => [])
  ipcMain.handle(IPC_CHANNELS.tasks.create, () => undefined)
  ipcMain.handle(IPC_CHANNELS.tasks.update, () => undefined)
  ipcMain.handle(IPC_CHANNELS.tasks.delete, () => undefined)
  ipcMain.handle(IPC_CHANNELS.tasks.reorder, () => [])
  ipcMain.handle(IPC_CHANNELS.tasks.run, () => undefined)
  ipcMain.handle(IPC_CHANNELS.tasks.verify, () => undefined)
  ipcMain.handle(IPC_CHANNELS.tasks.executions, () => [])
  // The file system service needs no native module, so e2e gets the real one —
  // that is what makes the editor, file browser and rich previews testable.
  const mockFileSystemService = new FileSystemService(
    (workspaceId) => workspaces.find((workspace) => workspace.id === workspaceId)?.rootPath ?? null
  )
  ipcMain.handle(IPC_CHANNELS.fs.listTree, (_event: IpcMainInvokeEvent, input: unknown) =>
    mockFileSystemService.listTree(input as Parameters<FileSystemService['listTree']>[0])
  )
  ipcMain.handle(IPC_CHANNELS.fs.readFile, (_event: IpcMainInvokeEvent, input: unknown) =>
    mockFileSystemService.readFile(input as Parameters<FileSystemService['readFile']>[0])
  )
  ipcMain.handle(IPC_CHANNELS.fs.readBinary, (_event: IpcMainInvokeEvent, input: unknown) =>
    mockFileSystemService.readBinary(input as Parameters<FileSystemService['readBinary']>[0])
  )
  ipcMain.handle(IPC_CHANNELS.fs.writeFile, (_event: IpcMainInvokeEvent, input: unknown) =>
    mockFileSystemService.writeFile(input as Parameters<FileSystemService['writeFile']>[0])
  )
  ipcMain.handle(IPC_CHANNELS.fs.watchFile, (event: IpcMainInvokeEvent, input: unknown) =>
    mockFileSystemService.watchFile(input as Parameters<FileSystemService['watchFile']>[0], (payload) => {
      event.sender.send(IPC_CHANNELS.fs.onFileChanged, payload)
    })
  )
  ipcMain.handle(IPC_CHANNELS.fs.unwatchFile, (_event: IpcMainInvokeEvent, input: { watchId: string }) => {
    mockFileSystemService.unwatchFile(input.watchId)
  })
  ipcMain.handle(IPC_CHANNELS.linear.getStatus, () => ({
    connected: false, encrypted: false, viewerName: null, viewerEmail: null, organization: null, error: null
  }))
  ipcMain.handle(IPC_CHANNELS.linear.setApiKey, () => {
    throw new Error('Linear is not available in E2E mock mode')
  })
  ipcMain.handle(IPC_CHANNELS.linear.clearApiKey, () => undefined)
  ipcMain.handle(IPC_CHANNELS.linear.listTeams, () => [])
  ipcMain.handle(IPC_CHANNELS.linear.listIssues, () => [])
  ipcMain.handle(IPC_CHANNELS.linear.getIssue, () => {
    throw new Error('Linear is not available in E2E mock mode')
  })
  ipcMain.handle(IPC_CHANNELS.linear.createWorktreeFromIssue, () => {
    throw new Error('Linear is not available in E2E mock mode')
  })
  ipcMain.handle(IPC_CHANNELS.git.getBranch, () => ({ branch: null, detached: false, shortSha: null, error: 'E2E mock mode' }))
  ipcMain.handle(IPC_CHANNELS.search.run, () => ({ files: [], totalMatches: 0, totalFiles: 0, truncated: false, elapsedMs: 0 }))
  ipcMain.handle(IPC_CHANNELS.search.listFiles, () => ({ files: [], truncated: false }))
  ipcMain.handle(IPC_CHANNELS.search.cancel, () => undefined)
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
    changes: [],
    workspaceId: input.workspaceId,
    rootPath: input.rootPath
  }))
  ipcMain.handle(IPC_CHANNELS.github.stageFile, () => ({ ok: true, message: 'E2E mock staged' }))
  ipcMain.handle(IPC_CHANNELS.github.unstageFile, () => ({ ok: true, message: 'E2E mock unstaged' }))
  ipcMain.handle(IPC_CHANNELS.github.listBranches, () => [])
  ipcMain.handle(IPC_CHANNELS.github.listPullRequests, () => [])
  ipcMain.handle(IPC_CHANNELS.github.listCommits, () => [])
  ipcMain.handle(IPC_CHANNELS.github.listReleases, () => [])
  ipcMain.handle(IPC_CHANNELS.github.listWorkflows, () => [])
  ipcMain.handle(IPC_CHANNELS.github.listWorkflowRuns, () => [])
  ipcMain.handle(IPC_CHANNELS.github.getWorkflowRunDetails, (_event: IpcMainInvokeEvent, input: { runId: number }) => ({
    databaseId: input.runId,
    name: 'E2E mock workflow',
    displayTitle: 'E2E mock workflow',
    status: 'completed',
    conclusion: 'success',
    event: 'workflow_dispatch',
    branch: 'main',
    actor: null,
    url: null,
    createdAt: new Date().toISOString(),
    jobs: []
  }))
  ipcMain.handle(IPC_CHANNELS.github.listCheckpoints, () => [])
  ipcMain.handle(IPC_CHANNELS.github.listConnectedRepositories, () => [])
  ipcMain.handle(IPC_CHANNELS.github.fetch, () => ({ ok: true, message: 'E2E mock mode' }))
  ipcMain.handle(IPC_CHANNELS.github.pullFfOnly, () => ({ ok: true, message: 'E2E mock mode' }))
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
  const integrationGroups: Array<import('../../../shared/types/integration').IntegrationGroup> = []
  const integrationHandoffs: Record<string, import('../../../shared/types/integration').IntegrationHandoff[]> = {}
  ipcMain.handle(IPC_CHANNELS.integration.listGroups, () => integrationGroups)
  ipcMain.handle(IPC_CHANNELS.integration.createGroup, (_event: IpcMainInvokeEvent, input: { name: string; goal: string; description?: string | null; activeWorkspaceId?: string | null }) => {
    const now = Date.now()
    const group: import('../../../shared/types/integration').IntegrationGroup = {
      id: randomUUID(),
      name: input.name,
      goal: input.goal,
      description: input.description ?? null,
      status: 'active',
      activeWorkspaceId: input.activeWorkspaceId ?? null,
      createdAt: now,
      updatedAt: now,
      members: []
    }
    integrationGroups.unshift(group)
    return group
  })
  ipcMain.handle(IPC_CHANNELS.integration.addMember, (_event: IpcMainInvokeEvent, input: { groupId: string; workspaceId: string; role: import('../../../shared/types/integration').IntegrationRole; alias?: string | null; paneId?: string | null; rootPath?: string | null }) => {
    const group = integrationGroups.find((item) => item.id === input.groupId)
    if (!group) throw new Error('Integration group not found')
    const workspace = workspaces.find((item) => item.id === input.workspaceId)
    if (!workspace) throw new Error('Workspace not found')
    group.members.push({
      id: randomUUID(),
      groupId: group.id,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      workspaceRootPath: workspace.rootPath,
      paneId: input.paneId ?? null,
      rootPath: input.rootPath ?? workspace.rootPath,
      role: input.role,
      alias: input.alias ?? input.role.toUpperCase(),
      branch: 'main',
      activeProvider: null,
      activeSessionId: null,
      lastIntent: null,
      lastResult: null,
      blockers: null,
      updatedAt: Date.now()
    })
    return group
  })
  ipcMain.handle(IPC_CHANNELS.integration.updateGroup, () => integrationGroups[0])
  ipcMain.handle(IPC_CHANNELS.integration.deleteGroup, () => undefined)
  ipcMain.handle(IPC_CHANNELS.integration.updateMember, () => integrationGroups[0])
  ipcMain.handle(IPC_CHANNELS.integration.removeMember, () => integrationGroups[0])
  ipcMain.handle(IPC_CHANNELS.integration.attachSession, () => ({ id: randomUUID(), updatedAt: Date.now() }))
  ipcMain.handle(IPC_CHANNELS.integration.listHandoffs, (_event: IpcMainInvokeEvent, groupId: string) => integrationHandoffs[groupId] ?? [])
  ipcMain.handle(IPC_CHANNELS.integration.createHandoff, (_event: IpcMainInvokeEvent, input: { groupId: string; fromMemberId: string; toMemberId: string; title: string; content: string; status?: 'draft' | 'sent' | 'saved' }) => {
    const handoff = { id: randomUUID(), groupId: input.groupId, fromMemberId: input.fromMemberId, toMemberId: input.toMemberId, title: input.title, content: input.content, status: input.status ?? 'draft', createdAt: Date.now() }
    integrationHandoffs[input.groupId] = [handoff, ...(integrationHandoffs[input.groupId] ?? [])]
    return handoff
  })
  ipcMain.handle(IPC_CHANNELS.integration.buildContext, (_event: IpcMainInvokeEvent, input: { groupId: string }) => {
    const group = integrationGroups.find((item) => item.id === input.groupId)
    return { groupId: input.groupId, text: group ? `# Integration context: ${group.name}\n\nGoal: ${group.goal}` : '' }
  })

  // ── Catch-all safety net (E2E) ──────────────────────────────────────────────
  // Any IPC channel NOT explicitly mocked above gets a safe, shaped empty default
  // so an unstubbed feature (Worktrees, Background jobs, Scripts, Web Preview, …)
  // can't crash the app under test by invoking a handler that doesn't exist.
  // Shapes satisfy the common consumers: lists do .map(), outputs read .lines,
  // statuses read props. ipcMain.handle throws on a duplicate channel, so the
  // try/catch lets the explicit mocks above win and only fills the gaps.
  const channelDefault = (channel: string): unknown => {
    if (/get-output/i.test(channel)) return { jobId: '', startSequence: 0, lines: [] }
    if (/(^|:|-)list|executions|get-ready|profiles|branches|worktrees|releases|commits|workflows|checkpoints|repositories|groups|handoffs|logs/i.test(channel)) return []
    if (/status|usage|credits|summary|detect|get-state|getStatus/i.test(channel)) return {}
    if (/manifest|build-pane/i.test(channel)) return ''
    return null
  }
  const flattenChannels = (obj: Record<string, unknown>): string[] =>
    Object.values(obj).flatMap((v) => (typeof v === 'string' ? [v] : flattenChannels(v as Record<string, unknown>)))
  for (const channel of flattenChannels(IPC_CHANNELS as unknown as Record<string, unknown>)) {
    try {
      ipcMain.handle(channel, () => channelDefault(channel))
    } catch {
      // Already registered by an explicit mock above — keep that one.
    }
  }
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
