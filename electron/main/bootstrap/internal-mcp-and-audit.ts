import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { registerDiagnosticsIpc } from '../ipc/diagnostics.ipc'
import { registerOxeContextIpc } from '../ipc/oxe-context.ipc'
import { registerPolicyIpc } from '../ipc/policy.ipc'
import { agentMcpArguments } from '../services/agent-launch.service'
import { approvalCenter } from '../services/approvals'
import { policyStore } from '../services/policy'
import { mainMessage } from '../../../shared/messages'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { CoreServicesContext } from './core-services'
import type { WorkspaceServicesContext } from './workspace-services'

export interface InternalMcpAndAuditOptions {
  core: CoreServicesContext
  workspace: WorkspaceServicesContext
  delegationService: InstanceType<CoreServicesContext['DelegationService']>
  previousDbVersion: number
}

export async function bootstrapInternalMcpAndAudit({ core, workspace, delegationService, previousDbVersion }: InternalMcpAndAuditOptions) {
  const { db, executions, androidAccess, agentState, terminalManager, taskService } = core
  const {
    createInternalMcpHandle,
    registerMcpInternalIpc,
    registerDataExportIpc,
    registerHttpAuditIpc,
    registerAgentActivityIpc,
    AgentActivity,
    HttpAuditHistory,
    productionHostsFor,
    gitService,
    agentSearch,
    gitHubService,
    backgroundManager,
    oxeQuery,
    threadManager,
    sharedAgentActivity,
    skillService,
    mcpManager,
    creditsService,
    contextUsageService,
    fileSystemService,
    internalMcpWorkspaceServ,
    internalMcpGithub,
    internalMcpGit,
    delegationAgents,
    launcher
  } = workspace

  // B10: outside the main entry, but awaited here, so the approval channels exist before the window can ask.
  const approvals = await import('../services/approvals/wiring')
  approvals.wireApprovals({
    db,
    workspaces: () => internalMcpWorkspaceServ.list(),
    profiles: () => delegationAgents.list(),
    oxeQuery: () => oxeQuery.agent,
    paneProcess: paneId => terminalManager.foregroundProcess(paneId)
  })

  const internalMcp = createInternalMcpHandle({
    threads: threadManager.manager,
    delegation: delegationService,
    executions,
    delegationAgents: () => delegationAgents.list().filter(p => ['claude', 'codex'].includes(p.parentProvider ?? p.provider)).map(p => {
      try { launcher.resolve(p.agentProfileId); return { agentProfileId: p.agentProfileId, name: p.name, supported: true } }
      catch (e) { return { agentProfileId: p.agentProfileId, name: p.name, supported: false, reason: String(e) } }
    }),
    oxeQuery: () => oxeQuery.agent,
    oxeQueryError: () => oxeQuery.error,
    git: gitService,
    app: {
      github: gitHubService,
      tasks: taskService,
      skills: skillService,
      terminal: terminalManager,
      mcpServers: mcpManager,
      search: agentSearch,
      contextUsage: contextUsageService,
      credits: creditsService,
      notify: approvals.showAgentNotice,
      agents: {
        state: agentState,
        terminal: terminalManager,
        profiles: () => delegationAgents.list(),
        resolve: id => launcher.resolve(id),
        mcpArgs: provider => agentMcpArguments(provider, join(app.getPath('userData'), 'bin', 'oxespace-mcp.cjs')),
        createPane: workspaceId => internalMcpWorkspaceServ.createPane(workspaceId),
        setPaneAgent: (paneId, profileId, name) => internalMcpWorkspaceServ.setPaneAgent(paneId, profileId, name),
        closePane: paneId => internalMcpWorkspaceServ.closePane(paneId),
        workspaceChanged: workspace => { for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.workspace.onChanged, workspace) }
      }
    },
    db,
    mcpManager,
    workspaceServ: internalMcpWorkspaceServ,
    github: internalMcpGithub,
    background: backgroundManager,
    fileSystem: fileSystemService,
    androidAccess: () => androidAccess,
    openAndroidPanel: request => { for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.android.openPanel, request) },
    askAndroidScreenshot: async ({ serial, owner }) => {
      const [{ brokerDraft }, { requesterFor }] = await Promise.all([import('../services/approvals/drafts'), import('../services/approvals/requester')])
      const outcome = await approvalCenter.ask(brokerDraft({
        kind: 'mcp-confirm',
        requester: requesterFor(owner),
        level: 'medium',
        risk: 'read',
        title: mainMessage('approvals.title.agent', {}),
        summary: mainMessage('approvals.summary.mcpConfirm', { tool: 'oxespace_device_screenshot', action: 'screenshot', target: serial }),
        target: serial,
        notes: [],
        text: serial
      }))
      return outcome.intent === 'allow' || outcome.intent === 'allow-session'
    }
  })
  registerMcpInternalIpc(internalMcp)

  // A63 / N9: the Worktrees panel. The window and the oxespace_remove_worktree tool share its guarded removal; the
  // merged state follows A60 (the pull request provider first, git as the fallback); each Remove a person makes is audited.
  const worktreeOwnersCache: { current: import('../services/github/worktrees-panel').WorktreeOwner[] } = { current: [] }
  {
    const [{ WorktreesPanel, setAppWorktreesPanel }, { registerWorktreesPanelIpc }, { PersonActionAudit }, { GhExec }, { createPullRequestProvider }] = await Promise.all([
      import('../services/github/worktrees-panel'), import('../ipc/worktrees-panel.ipc'), import('../services/person-action-audit'),
      import('../services/github/gh-exec'), import('../ipc/pull-request.ipc')
    ])
    const panelGh = new GhExec()
    const prProvider = createPullRequestProvider(panelGh)
    const worktreesPanel = new WorktreesPanel({
      gh: panelGh,
      owners: () => worktreeOwnersCache.current,
      provider: {
        merged: async ({ rootPath, branch }) => {
          const baseRef = (await gitHubService.resolveWorktreeBase({ workspaceId: '', rootPath })).baseRef
          const base = baseRef.replace(/^(refs\/remotes\/)?origin\//, '') || 'main'
          return prProvider.merged({ rootPath, branch, base })
        }
      },
      removeWorktree: input => gitHubService.removeWorktree(input),
      // A live pane or conversation execution inside the worktree keeps it from being removed (HML 704-6).
      busy: path => executions.liveWithin(path) > 0 ? 'pane' : null,
      audit: new PersonActionAudit(db)
    })
    setAppWorktreesPanel(worktreesPanel)
    registerWorktreesPanelIpc(worktreesPanel)
  }

  // R0b: Settings › Data and the notice band; the first-run export itself starts in the deferred init below.
  const runDataExport = registerDataExportIpc({
    db,
    userData: app.getPath('userData'),
    workspaceRoots: () => internalMcpWorkspaceServ.list().map(workspace => workspace.rootPath),
    previousDbVersion
  })
  registerDiagnosticsIpc(db, internalMcp, { terminals: terminalManager, mcp: mcpManager })

  // Loads the policy and the accepted-config gate and answers policy:get; the HTTP audit below reads policyStore().
  await registerPolicyIpc(id => internalMcpWorkspaceServ.get(id)?.rootPath, { db, files: fileSystemService, servers: mcpManager, executions })

  const httpAuditLog = new HttpAuditHistory(db, undefined, {
    isProductionHost: productionHostsFor({ db, policy: policyStore() ?? undefined })
  })
  registerHttpAuditIpc(httpAuditLog)
  httpAuditLog.prune()
  const pruneHttpInterval = setInterval(() => httpAuditLog.prune(), 24 * 60 * 60 * 1000)
  app.once('before-quit', () => clearInterval(pruneHttpInterval))

  const agentActivity = new AgentActivity(db, {
    isProductionHost: productionHostsFor({ db, policy: policyStore() ?? undefined }),
    pendingFor: connectionId => Boolean(oxeQuery.agent?.hasPending(connectionId))
  })
  sharedAgentActivity.current = agentActivity
  registerAgentActivityIpc(agentActivity)

  // OXESpace context manifest — prepended to the agent's initial prompt on pane spawn so the CLI knows the
  // workspace state without calling any MCP tool. Read shortcut; MCP is still the action path (see oxe-context.service.ts).
  registerOxeContextIpc({
    db,
    workspaceServ: internalMcpWorkspaceServ,
    github: internalMcpGithub,
    git: internalMcpGit,
    background: backgroundManager,
    fileSystem: fileSystemService
  })

  return { internalMcp, runDataExport }
}
