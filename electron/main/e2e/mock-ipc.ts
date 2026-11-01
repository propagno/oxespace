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
import { execFile } from 'node:child_process'
import { GitService } from '../services/git.service'
import { defaultSplitShellProfileId, fallbackShellProfiles } from '../services/shell-profile.defaults'
// The one real service the mocks keep: file reads are what the editor and
// preview specs actually assert on, and faking a filesystem would test the fake.
import { FileSystemService } from '../services/file-system.service'
import { checkWorkspaceRoot, normalizeWorkspaceRoot } from '../services/workspace-root'
import { worktreeOrWorkspaceRoot } from '../ipc/file-system.ipc'
import { registerTerminalRestartMock } from './terminal-restart-mock'
import { parseWorktreePorcelain } from '../services/github/parsers'
import { registerOxeQueryMock } from './oxequery-mock'
import { registerOxePodMock } from './oxepod-mock'
import { registerMcpToolsMock } from './mcp-tools-mock'
import { registerDiagnosticsMock } from './diagnostics-mock'
import { registerRemoteMock } from './remote-mock'
import { registerActivityMock } from './activity-mock'
import { registerThreadSectionsMock } from './thread-sections-mock'
import { registerOpenExternalMock } from './open-external-mock'
import { installMcpFixture } from './mcp-fixture'
import { registerApprovalsMock } from './approvals-mock'
import { registerCloseGuardMock } from './close-guard-mock'
import { installE2eAgentStateHook } from './agent-state-hook'
import { loadManifests } from '../services/agent-state/manifest'
import { BUNDLED_MANIFESTS } from '../services/agent-state/bundled-manifests'
import { broadcastAgentState, registerAgentStateIpc } from '../ipc/agent-state.ipc'
import { registerOxePostIpc } from '../ipc/oxepost.ipc'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { ShellProfile, Workspace, WorkspaceLayout, WorkspaceLayoutPreset } from '../../../shared/types/workspace'
import type { GitCompareMode } from '../../../shared/types/git'
import type { PaneAgentResume } from '../../../shared/types/ipc'
import { planSplit } from '../../../shared/workspace-split'
import type { AppAbout, AppConnectivity } from '../../../shared/types/app'
import type { ThreadPendingRefusal, ThreadPendingRequestSummary, ThreadPendingResponseInput, ThreadPendingResponseResult, ThreadProjectCatalog, ThreadSideOpenResult } from '../../../shared/types/thread'
import { version as packageVersion } from '../../../package.json'
import { mainMessage } from '../../../shared/messages'
import { requestOutcome } from '../../../shared/threadRequestOutcome'

export function registerE2eMockIpcHandlers(): void {
  const shellProfiles: ShellProfile[] = fallbackShellProfiles()
  const workspaces: Workspace[] = []
  registerOxeQueryMock()
  registerOxePodMock()
  registerMcpToolsMock()
  registerDiagnosticsMock()
  registerRemoteMock()
  registerActivityMock()
  registerThreadSectionsMock(id => workspaces.some(workspace => workspace.id === id))
  registerOpenExternalMock()
  // Never in a packaged build: the gate is inside, on app.isPackaged (see mcp-fixture.ts).
  installMcpFixture(ipcMain, process.env, app.isPackaged)
  registerApprovalsMock()
  // F26: the real close guard is not installed here, so app.close() never waits; specs ask through this double.
  registerCloseGuardMock(app.isPackaged, (channel, request) => {
    const windows = BrowserWindow.getAllWindows().filter(window => !window.isDestroyed())
    for (const window of windows) window.webContents.send(channel, request)
    return windows.length > 0
  })
  // Never in a packaged build, and only when a spec asks for it: the gate is inside (see agent-state-hook.ts).
  let agentManifests: ReturnType<typeof loadManifests>['manifests'] | undefined
  installE2eAgentStateHook(globalThis, process.env, app.isPackaged, {
    findPane: paneId => workspaces.flatMap(workspace => workspace.panes).find(pane => pane.id === paneId) ?? null,
    manifests: () => (agentManifests ??= loadManifests(BUNDLED_MANIFESTS).manifests),
    emit: broadcastAgentState,
    sendHookStatus: event => { for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.agentHooks.onStatus, event) },
    registerIpc: registerAgentStateIpc
  })
  registerOxePostIpc(id => workspaces.find(workspace => workspace.id === id)?.rootPath)

  ipcMain.handle(IPC_CHANNELS.workspace.list, () => workspaces)
  ipcMain.handle(IPC_CHANNELS.workspace.shellProfiles, () => shellProfiles)
  ipcMain.handle(IPC_CHANNELS.workspace.create, (_event: IpcMainInvokeEvent, input: { rootPath: string; layout?: WorkspaceLayout; layoutPreset?: WorkspaceLayoutPreset; defaultShellProfileId?: string; autoStart?: boolean }) => {
    // The same refusal as the real handler: E2E runs create workspaces on real temporary folders.
    const rootPath = normalizeWorkspaceRoot(input.rootPath)
    const root = checkWorkspaceRoot(rootPath)
    if (!root.ok) return root
    const layout = input.layout ?? presetToLayout(input.layoutPreset ?? 4)
    const workspace: Workspace = {
      id: randomUUID(),
      name: rootPath.replaceAll('\\', '/').split('/').filter(Boolean).at(-1) ?? 'workspace',
      rootPath,
      layout,
      layoutPreset: input.layoutPreset ?? layoutToPreset(layout),
      themeId: 'midnight',
      uiDensity: 'default',
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
    // The real rule (WorkspaceService.splitPane): the next preset, or a refusal; never a layout the grid has no preset for.
    const direction = input.direction === 'horizontal' ? 'horizontal' : 'vertical'
    const plan = planSplit(workspace.layout, workspace.panes, source, direction)
    if (!plan.ok) throw new Error(plan.reason === 'occupied' ? 'Target slot is already occupied' : `Cannot split ${direction}ly: layout limit reached`)
    const { layout: nextLayout, rowIndex: targetRow, columnIndex: targetColumn } = plan
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
  ipcMain.handle(IPC_CHANNELS.workspace.createPane, (_event: IpcMainInvokeEvent, input: { workspaceId: string }) => {
    const workspace = workspaces.find(w => w.id === input.workspaceId)
    if (!workspace) throw new Error('Workspace not found')
    const paneId = randomUUID()
    workspace.panes.push({ ...workspace.panes[0], id: paneId, rowIndex: 0,
      columnIndex: Math.max(...workspace.panes.map(p => p.columnIndex)) + 1, status: 'idle' })
    return { workspace, paneId }
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
  const semanticProjects = new Set<string>()
  const projectSemantic = (rootPath: string) => ({ on: semanticProjects.has(rootPath), status: { enabled: semanticProjects.has(rootPath), workerReady: false, indexing: false, count: 0, lastError: null, mode: 'auto', coverage: { lexicalDocuments: semanticProjects.has(rootPath) ? 12 : 0, lastIndexedAt: null, byCategory: { source: 12, test: 0, config: 0, docs: 0, other: 0 } }, lastQuery: null } })
  ipcMain.handle(IPC_CHANNELS.semantic.projectStatus, (_event: IpcMainInvokeEvent, rootPath: string) => projectSemantic(rootPath))
  ipcMain.handle(IPC_CHANNELS.semantic.setProjectEnabled, (_event: IpcMainInvokeEvent, input: { rootPath: string; enabled: boolean }) => {
    if (input.enabled) semanticProjects.add(input.rootPath); else semanticProjects.delete(input.rootPath)
    return projectSemantic(input.rootPath)
  })
  ipcMain.handle(IPC_CHANNELS.diagnostics.getSnapshot, () => ({
    generatedAt: Date.now(), appVersion: packageVersion, platform: process.platform, arch: process.arch,
    nodeVersion: process.versions.node, electronVersion: process.versions.electron ?? 'unknown', workspaceCount: workspaces.length,
    checks: [
      { id: 'database', label: 'SQLite', tone: 'ok', detail: 'E2E mock' },
      { id: 'mcp', label: 'Internal MCP', tone: 'warning', detail: 'E2E mock' },
      { id: 'sandbox', label: 'Renderer sandbox', tone: 'ok', detail: 'enabled' }
    ]
  }))
  ipcMain.handle(IPC_CHANNELS.diagnostics.exportReport, () => null)
  ipcMain.handle(IPC_CHANNELS.diagnostics.buildIssueReport, () => ({ title: '[Bug] ', diagnosticLines: 2, body: ['## What happened', '', '## Environment', '', '- OXESpace: ' + packageVersion, '- System: E2E mock', ''].join('\n') }))
  ipcMain.handle(IPC_CHANNELS.diagnostics.recordFirstAnswer, () => undefined)
  ipcMain.handle(IPC_CHANNELS.policy.get, () => ({ sources: [], problems: [], locations: [{ layer: 'user', path: 'policy.json' }] }))
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
  // B17: every valid restart is recorded with its resume flag on `globalThis.__oxeTerminalRestarts` for the specs.
  registerTerminalRestartMock(globalThis as unknown as Record<string, unknown>)
  // The mock never keeps a session, so a mounting view is told to start fresh
  // rather than waiting for a replay that will not come.
  ipcMain.handle(IPC_CHANNELS.terminal.attach, () => ({
    running: false, seq: 0, prologue: '', replay: '', truncated: false, altScreen: false
  }))
  ipcMain.handle(IPC_CHANNELS.terminal.detach, () => undefined)
  // B17: a spec shows a pane's resume outcome with `globalThis.__oxeAgentResume = { [paneId]: PaneAgentResume }`.
  ipcMain.handle(IPC_CHANNELS.terminal.status, (_event: IpcMainInvokeEvent, paneId: unknown) => {
    const seeded = (globalThis as { __oxeAgentResume?: Record<string, PaneAgentResume> }).__oxeAgentResume?.[String(paneId)]
    return { running: false, seq: 0, altScreen: false, ...(seeded ? { agentResume: seeded } : {}) }
  })
  ipcMain.handle(IPC_CHANNELS.voice.transcribe, () => ({ text: '', durationMs: 0 }))
  ipcMain.handle(IPC_CHANNELS.voice.getModelStatus, () => ({ size: 'base', ready: false, path: '', engineReady: false }))
  ipcMain.handle(IPC_CHANNELS.voice.ensureModel, () => ({ size: 'base', ready: false, path: '', engineReady: false }))
  ipcMain.handle(IPC_CHANNELS.notifications.notify, () => false)
  // Offline is opted into per run, so a spec can check the offline state without unplugging the runner.
  ipcMain.handle(IPC_CHANNELS.app.connectivity, (): AppConnectivity => process.env.OXESPACE_E2E_OFFLINE === '1'
    ? { state: 'offline', checkedAt: Date.now(), reason: mainMessage('app.connectivity.offline', {}) }
    : { state: 'online', checkedAt: Date.now() })
  ipcMain.handle(IPC_CHANNELS.app.about, (): AppAbout => ({
    // package.json's version: unpackaged, app.getVersion() is Electron's own.
    name: 'OXESpace', version: packageVersion, channel: 'dev', commit: 'e2e0000', builtAt: null,
    versions: { electron: process.versions.electron ?? '', chrome: process.versions.chrome ?? '', node: process.versions.node, v8: process.versions.v8 },
    platform: process.platform, arch: process.arch, osRelease: 'e2e', license: 'MIT', repositoryUrl: 'https://github.com/propagno/oxespace'
  }))
  // Pending requests across conversations, seeded per run with a JSON list of summaries. An answer is accepted once,
  // for the listed generation, exactly as the registry does.
  // A new profile has no conversation projects yet; the real catalog answers an empty one, never nothing.
  ipcMain.handle(IPC_CHANNELS.thread.projects, (): ThreadProjectCatalog => ({ projects: [], unavailable: [] }))
  const pendingRequests: ThreadPendingRequestSummary[] = JSON.parse(process.env.OXESPACE_E2E_PENDING_REQUESTS || '[]')
  ipcMain.handle(IPC_CHANNELS.thread.pendingRequestsAll, () => pendingRequests)
  // B1.2: a side chat answers each message with a fixed reply and its usage, and is gone once closed.
  const sides = new Map<string, string>()
  ipcMain.handle(IPC_CHANNELS.thread.sideOpen, (_event: IpcMainInvokeEvent, id: unknown): ThreadSideOpenResult => {
    if (typeof id !== 'string' || !id) throw new Error('thread.invalidInput')
    if (process.env.OXESPACE_E2E_SIDE_UNAVAILABLE === '1') return { ok: false, message: mainMessage('thread.side.unavailable', {}) }
    const sideId = randomUUID()
    sides.set(sideId, id)
    return { ok: true, side: { sideId, threadId: id, provider: 'claude', readOnly: true } }
  })
  ipcMain.handle(IPC_CHANNELS.thread.sideSend, (event: IpcMainInvokeEvent, sideId: unknown, text: unknown) => {
    if (typeof sideId !== 'string' || !sides.has(sideId) || typeof text !== 'string' || !text.trim()) throw new Error('thread.side.invalidInput')
    event.sender.send(IPC_CHANNELS.thread.onSideEvent, { sideId, event: { type: 'message', id: randomUUID(), role: 'assistant', text: 'E2E side chat reply.' } })
  })
  ipcMain.handle(IPC_CHANNELS.thread.sideClose, (_event: IpcMainInvokeEvent, sideId: unknown) => { if (typeof sideId === 'string') sides.delete(sideId) })
  ipcMain.handle(IPC_CHANNELS.thread.respondPending, (_event: IpcMainInvokeEvent, input: ThreadPendingResponseInput): ThreadPendingResponseResult => {
    const index = pendingRequests.findIndex(request => request.threadId === input.threadId && request.requestId === input.requestId)
    const refuse = (refusal: ThreadPendingRefusal): ThreadPendingResponseResult => ({ ok: false, refusal, message: mainMessage(`thread.request.${refusal}`, {}) })
    if (index < 0) return refuse('notPending')
    if (pendingRequests[index].generation !== input.generation) return refuse('staleGeneration')
    const [request] = pendingRequests.splice(index, 1)
    return { ok: true, threadId: input.threadId, requestId: input.requestId, resolution: requestOutcome(request.kind, input.response).resolution }
  })
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
  const mockFileSystemService = new FileSystemService((workspaceId, requestedRoot) => {
    const root = workspaces.find((workspace) => workspace.id === workspaceId)?.rootPath
    return root ? worktreeOrWorkspaceRoot(root, requestedRoot) : null
  })
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
  // Fixed by default so screenshots do not depend on the branch; a spec that checks branches asks for real git.
  ipcMain.handle(IPC_CHANNELS.git.getBranch, (_event: IpcMainInvokeEvent, input: { rootPath: string }) =>
    process.env.OXESPACE_E2E_REAL_GIT_BRANCH === '1' ? new GitService().getBranch(input.rootPath)
      : { branch: null, detached: false, shortSha: null, error: 'E2E mock mode' })
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
  // Changes panel: real read-only git so the e2e can drive a repository it created.
  const gitService = new GitService()
  ipcMain.handle(IPC_CHANNELS.git.getDiffSummary, (_event: IpcMainInvokeEvent, input: { rootPath: string; base: string; includeUncommitted?: boolean; head?: string; mode?: GitCompareMode }) =>
    gitService.getDiffSummary(input.rootPath, input.base, input.includeUncommitted ?? true, input.head, input.mode))
  ipcMain.handle(IPC_CHANNELS.git.getFileOriginal, (_event: IpcMainInvokeEvent, input: { rootPath: string; base: string; path: string; oldPath?: string; head?: string; mode?: GitCompareMode }) =>
    gitService.getFileOriginal(input.rootPath, input.base, input.path, input.oldPath, input.head, input.mode))
  ipcMain.handle(IPC_CHANNELS.git.getDiff, (_event: IpcMainInvokeEvent, input: { rootPath: string; base: string; includeUncommitted?: boolean; head?: string; mode?: GitCompareMode }) =>
    gitService.buildDiff(input.rootPath, input.base, input.includeUncommitted ?? true, input.head, input.mode))
  ipcMain.handle(IPC_CHANNELS.git.getFileAtRef, (_event: IpcMainInvokeEvent, input: { rootPath: string; ref: string; path: string }) =>
    gitService.getFileAtRef(input.rootPath, input.ref, input.path))
  ipcMain.handle(IPC_CHANNELS.github.resolveWorktreeBase, () => ({ baseRef: 'main', remoteName: null, isRemote: false }))
  ipcMain.handle(IPC_CHANNELS.github.listBranches, (_event: IpcMainInvokeEvent, input: { rootPath: string }) => {
    return new Promise(resolve => execFile('git', ['branch', '--format=%(refname:short)'], { cwd: input.rootPath }, (error, stdout) => {
      resolve(error ? [] : stdout.split(/\r?\n/).map(name => name.trim()).filter(Boolean).map(name => ({ name, current: false, remote: false })))
    }))
  })
  ipcMain.handle(IPC_CHANNELS.github.listWorktrees, (_event: IpcMainInvokeEvent, input: { rootPath: string }) => {
    return new Promise(resolve => execFile('git', ['worktree', 'list', '--porcelain'], { cwd: input.rootPath }, (error, stdout) => {
      resolve(error ? [] : parseWorktreePorcelain(stdout, input.rootPath))
    }))
  })
  ipcMain.handle(IPC_CHANNELS.github.listPullRequests, () => [])
  ipcMain.handle(IPC_CHANNELS.github.getPullRequestStatus, () => null)
  ipcMain.handle(IPC_CHANNELS.github.setPullRequestAutoMerge, () => ({ ok: true, message: 'Auto-merge enabled.' }))
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
    if (channel === IPC_CHANNELS.delegation.status) return { enabled: false, tasks: [] }
    if (channel === IPC_CHANNELS.delegation.preview) return { targetWorkspaceId: 'workspace-1', targetName: 'Workspace', ready: false, reason: 'PROJECT_OPT_IN_REQUIRED', effects: [], checkout: { strategy: 'create', branch: 'feature/preview', baseRef: 'main', baseSha: '0000000000000000000000000000000000000000', path: '/tmp/preview', createBranch: true, reuseExistingWorktree: false, fetchBase: false, resolvedAt: Date.now() } }
    if (channel === IPC_CHANNELS.memory.status) return {
      projectId: 'e2e-project', settings: { enabled: false, automaticCapture: false, automaticContext: false },
      runtime: { mode: 'managed', executable: 'ai-memory', url: 'http://127.0.0.1:49374' },
      health: { status: 'disabled' }, sessions: []
    }
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
