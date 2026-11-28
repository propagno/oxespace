import { app, BrowserWindow, ipcMain, safeStorage } from 'electron'
import log from 'electron-log/main.js'
import { join } from 'node:path'
import { registerAppInfoIpc } from '../ipc/app-info.ipc'
import { registerBackgroundIpc } from '../ipc/background.ipc'
import { registerClipboardTextIpc } from '../ipc/clipboard.ipc'
import { registerCopilotIpc } from '../ipc/copilot.ipc'
import { registerFileSystemIpc } from '../ipc/file-system.ipc'
import { broadcastMcpHealth, registerMcpIpc } from '../ipc/mcp.ipc'
import { registerNotificationsIpc } from '../ipc/notifications.ipc'
import { registerOxeIpc } from '../ipc/oxe.ipc'
import { registerSessionIpc } from '../ipc/session.ipc'
import { broadcastSkillChange, registerSkillIpc } from '../ipc/skill.ipc'
import type { AgentActivity } from '../services/agent-activity/read-model'
import { AgentLaunchService } from '../services/agent-launch.service'
import { AgentService } from '../services/agent.service'
import { BackgroundManager } from '../services/background.service'
import { McpManager } from '../services/mcp.service'
import { SearchService } from '../services/search.service'
import { SkillService } from '../services/skill.service'
import { WorkspaceService } from '../services/workspace.service'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { CoreServicesContext } from './core-services'

export async function bootstrapWorkspaceServices(core: CoreServicesContext) {
  const {
    db,
    executions,
    androidAccess,
    androidDisconnect,
    remotePairing,
    agentState,
    notifyAgentsChanged,
    onAgentsChanged,
    agentsModel,
    englishText,
    paneAgentSessions,
    paneAgentCwd,
    oxeQueryShells,
    remoteSshPanes,
    hostsProxy,
    terminalManager
  } = core

  // Source-control/search/integration surfaces are not required to create the
  // first window. Load them as one deferred group so their implementation does
  // not inflate the main entry or block startup parsing.
  const [
    { registerGitIpc }, { registerSearchIpc }, { registerGitHubIpc }, { registerIntegrationIpc }, { registerRemoteIpc },
    { GitHubService }, { GitService }, { registerPullRequestIpc }, { paneConversationsFor }, { registerPaneConversationIpc },
    { createInternalMcpHandle }, { registerMcpInternalIpc }, { registerMcpToolsIpc }, { registerDataExportIpc }, { startSchedules },
    { registerAgentCreditsIpc }, { registerContextUsageIpc }, { registerHttpAuditIpc }, { registerAgentActivityIpc }, { AgentActivity }, { HttpAuditHistory }, { productionHostsFor }
  ] = await Promise.all([
    import('../ipc/git.ipc'), import('../ipc/search.ipc'), import('../ipc/github.ipc'), import('../ipc/integration.ipc'), import('../ipc/remote.ipc'),
    import('../services/github.service'), import('../services/git.service'), import('../ipc/pull-request.ipc'), import('../services/remote/pane-conversation'), import('../ipc/pane-conversation.ipc'),
    import('../mcp-internal/bootstrap'), import('../ipc/mcp-internal.ipc'), import('../ipc/mcp-tools.ipc'), import('../ipc/data-export.ipc'), import('../services/schedules'),
    import('../ipc/agentCredits.ipc'), import('../ipc/contextUsage.ipc'), import('../ipc/http-audit.ipc'), import('../ipc/agent-activity.ipc'),
    import('../services/agent-activity/read-model'), import('../services/http-audit/history'), import('../services/http-audit/production-hosts')
  ])

  const gitService = registerGitIpc()
  registerSearchIpc()
  // Agents search with their own instance: a new search cancels the previous one of the same service.
  const agentSearch = new SearchService()
  const gitHubService = registerGitHubIpc(db)
  const pullRequestProvider = registerPullRequestIpc()
  gitHubService.configureWorktreeLifecycle({ stopTerminalsWithin: (dir) => terminalManager.stopWithin(dir) })
  registerIntegrationIpc(db)

  const backgroundListeners = new Set<() => void>()
  const backgroundManager = new BackgroundManager(db, {
    emitOutput: (event) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(IPC_CHANNELS.background.onOutput, event)
      }
      for (const listener of backgroundListeners) listener()
    },
    emitUpdate: (event) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(IPC_CHANNELS.background.onUpdate, event)
      }
      for (const listener of backgroundListeners) listener()
    }
  })
  registerBackgroundIpc(backgroundManager)
  registerSessionIpc(db)

  // OxePod (containers) loads on its first request; OxeQuery (databases) reaches a database container through it, in process.
  const oxePod = (await import('../services/oxepod/startup')).startOxePod(db)
  oxeQueryShells.shellFor = paneId => oxePod.peek()?.shellFor(paneId)
  const oxeQuery = await (await import('../services/oxequery/startup')).startOxeQuery(db, async () => (await oxePod.load()).containers)

  const { registerThreadIpc } = await import('../ipc/thread.ipc')
  const delegatedThreadObserver: { current?: (thread: import('../../../shared/types/thread').ConversationThread) => void } = {}
  // Conversations started in their own worktree use the same creation path as the Worktrees panel.
  const threadWorktrees = {
    createWorktree: (input: import('../../../shared/types/github').GitHubCreateWorktreeInput) => gitHubService.createWorktree(input),
    resolveBaseRef: async (rootPath: string) => (await gitHubService.resolveWorktreeBase({ workspaceId: '', rootPath })).baseRef,
    removeWorktree: (input: import('../../../shared/types/github').GitHubRemoveWorktreeInput) => gitHubService.removeWorktree(input)
  }
  const sharedAgentActivity: { current?: AgentActivity } = {}
  const threadManager = registerThreadIpc(db, {
    observed: thread => delegatedThreadObserver.current?.(thread),
    bridge: join(app.getPath('userData'), 'bin', 'oxespace-mcp.cjs'),
    prepare: async thread => {
      // The internal MCP starts after first paint: a conversation sent in the first seconds waits for it (bounded).
      const { waitForInternalMcp } = await import('../mcp-internal/ready')
      const meta = await waitForInternalMcp(() => db.prepare('SELECT port, token FROM internal_mcp_meta LIMIT 1').get() as { port: number; token: string } | undefined)
      if (!meta) throw Error('Internal MCP is still starting. Retry shortly.')
      const execution = executions.register({ owner: { kind: 'thread', id: thread.id }, workspaceId: thread.workspaceId, cwd: thread.rootPath })
      return { ...execution, OXESPACE_MCP_PORT: String(meta.port), OXESPACE_MCP_TOKEN: meta.token, OXESPACE_WORKSPACE_ID: thread.workspaceId }
    },
    end: (threadId, executionId) => {
      const current = executions.forOwner({ kind: 'thread', id: threadId })
      if (executionId && current?.id !== executionId) return
      if (current) androidAccess.revokeSession(current.id)
      executions.endOwner({ kind: 'thread', id: threadId })
    }
  }, threadWorktrees, () => sharedAgentActivity.current, {
    // F6 A22: the conversation's own OXESpace jobs with their last lines; Stop stays on background:stop.
    jobs: thread => backgroundManager.list(thread.workspaceId).map(job => ({ job, tail: backgroundManager.getOutput(job.id).lines.slice(-5) })),
    onJobsChanged: listener => { backgroundListeners.add(listener); return () => { backgroundListeners.delete(listener) } },
    pullRequest: async ({ rootPath, branch }) => {
      const state = await pullRequestProvider.state({ rootPath, branch }).catch(() => null)
      return state?.pr ? { number: state.pr.number } : null
    }
  }, {
    // OXE-466: read-only ScreenMirror & terminal snapshot host for OxeCode side chats (Ctrl+.).
    peek: paneId => terminalManager.peek(paneId),
    shellCwd: paneId => terminalManager.shellCwd(paneId),
    status: paneId => terminalManager.status(paneId),
    readScreen: paneId => agentState.readScreen(paneId),
    agentOf: paneId => agentState.agentOf(paneId),
    agentState: paneId => agentState.get(paneId)
  })

  // A18 (P7) · the task's Terminal tab reads every running pane: its launch folder, its agent's reported cwd and its
  // shell's OSC cwd (F4-P6); `agent` = the pane runs an agent CLI.
  const paneRows = db.prepare('SELECT id, workspace_id, display_name, agent_name FROM panes')
  void threadManager.manager.then(manager => {
    androidDisconnect.notify = e => { for (const k of e.sessionKeys) void manager.steer(k.replace(/^thread:/, ''), `Android device ${e.name} (${e.serial}) disconnected from adb.`).catch(() => {}) }
    manager.configureHostsProxy(hostsProxy)
    manager.configurePanes(() => {
      const sources: import('../../../shared/types/thread-places').ThreadPaneSource[] = []
      for (const row of paneRows.all() as { id: string; workspace_id: string; display_name: string | null; agent_name: string | null }[]) {
        if (!terminalManager.hasSession(row.id)) continue
        const launchDir = terminalManager.status(row.id).launchDirectory
        if (!launchDir) continue
        const paneState = agentState.get(row.id)
        sources.push({
          paneId: row.id,
          title: row.display_name || row.agent_name || 'Terminal',
          workspaceId: row.workspace_id,
          launchDir,
          agentCwd: paneAgentCwd.get(row.id) ?? null,
          shellCwd: terminalManager.shellCwd(row.id),
          agent: paneState !== null || Boolean(row.agent_name),
          working: paneState?.state === 'working'
        })
      }
      return sources
    })
  }).catch(error => log.warn('Thread panes unavailable', error))

  const skillService = new SkillService({ onChange: broadcastSkillChange })
  registerSkillIpc(skillService, (input) => terminalManager.write(input))
  const mcpManager = new McpManager(db, {
    emitHealth: broadcastMcpHealth,
    getCipher: async () => (await import('../services/oxequery/secret-cipher')).createSecretCipher(safeStorage)
  })
  registerMcpIpc(mcpManager)
  registerClipboardTextIpc()
  registerNotificationsIpc()

  const paneConversations = paneConversationsFor(db, () => {
    const rows = db.prepare('SELECT root_path AS root FROM workspaces UNION SELECT root_path FROM thread_project_contexts').all() as Array<{ root: string | null }>
    return rows.map(row => row.root).filter((root): root is string => typeof root === 'string' && root.length > 0)
  })
  const disposePaneConversationIpc = registerPaneConversationIpc(ipcMain, {
    conversations: paneConversations,
    push: (senderId, payload) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed() && window.webContents.id === senderId) {
          window.webContents.send(IPC_CHANNELS.paneConversation.changed, payload)
        }
      }
    }
  })
  app.once('before-quit', disposePaneConversationIpc)

  // Schedules & Automations: cron/time + CI/PR/CLI events with mandatory isolated worktrees & unified Review Queue.
  const schedulesRuntime = startSchedules(db, {
    service: () => threadManager.manager,
    context: (projectId, rootPath) => threadManager.projects.context(projectId, rootPath),
    worktrees: {
      ...threadWorktrees,
      pushBranch: async ({ rootPath }) => {
        await gitHubService.push({ workspaceId: '', rootPath }, { reason: 'git-panel:automation-push' })
      },
      createPullRequest: async ({ rootPath, title, body, head, base }) => {
        const res = await gitHubService.createPullRequest({ workspaceId: '', rootPath, title, body, head, base })
        const match = /https?:\/\/\S+/.exec(res.message)
        return { url: match?.[0] ?? res.message }
      }
    },
    events: {
      listWorkflowRuns: (rootPath) => gitHubService.listWorkflowRuns({ workspaceId: '', rootPath }),
      listReviewRequestedPrs: (rootPath) => gitHubService.listPullRequests({ workspaceId: '', rootPath, state: 'open' })
    }
  })
  app.once('before-quit', () => schedulesRuntime.stop())

  remotePairing.start = registerRemoteIpc(db, {
    threads: threadManager.manager,
    terminals: terminalManager,
    agentState,
    paneConversations,
    // S7.1: the phone's `agents` topic; a mark from the phone reaches the window too.
    agents: {
      overview: () => agentsModel.overview(),
      // Only an agent the overview lists: a phone cannot push the person's real marks out of the store with made-up
      // keys (SECURITY #531 L2). The answer is ok either way; the phone already sees every row.
      markSeen: key => {
        const { kind, id } = (key ?? {}) as { kind?: unknown; id?: unknown }
        if (!agentsModel.overview().agents.some(row => row.kind === kind && row.id === id)) return false
        const ok = agentsModel.markSeen(key)
        if (ok) notifyAgentsChanged()
        return ok
      },
      onChanged: onAgentsChanged,
      text: englishText
    }
  }).startPairing
  app.once('before-quit', registerAppInfoIpc(db))

  registerCopilotIpc()
  const creditsService = registerAgentCreditsIpc()
  const contextUsageService = registerContextUsageIpc(undefined, (paneId, provider) => {
    const own = paneAgentSessions.current(paneId)
    return own && own.agent === provider ? own.sessionId : null
  }) // A7: the pane's own session
  const oxeService = registerOxeIpc()
  const fileSystemService = registerFileSystemIpc(db)
  registerMcpToolsIpc(db, fileSystemService)

  // Internal oxespace MCP server — auto-starts on app boot, registers a
  // global row in mcp_servers, syncs to every workspace's .mcp.json. The
  // bridge script lives under <userData>/bin/ and is spawned by each
  // agent CLI separately (Claude Code, Copilot, …). See plan section 3.
  const internalMcpWorkspaceServ = new WorkspaceService(db, { isPaneRunning: (paneId) => terminalManager.hasSession(paneId) || terminalManager.isStarting(paneId) })
  // OXE-447 · Remote SSH Hosts loads lazily on first IPC call so ssh2 never enters the main entry bundle.
  let remoteHostsLoader: Promise<import('../ipc/remote-hosts.ipc').RemoteHostsIpcController> | null = null
  const loadRemoteHosts = async () => {
    if (!remoteHostsLoader) {
      remoteHostsLoader = Promise.all([
        import('../ipc/remote-hosts.ipc'),
        import('../services/oxequery/secret-cipher')
      ]).then(([{ createRemoteHostsController, broadcastRemoteHostsChanged }, { createSecretCipher }]) => {
        const controller = createRemoteHostsController({
          db,
          cipher: createSecretCipher(safeStorage),
          createWorkspacePane: ({ workspaceId, displayName }) => {
            const created = internalMcpWorkspaceServ.createPane(workspaceId)
            internalMcpWorkspaceServ.updatePaneName(created.paneId, displayName)
            return { paneId: created.paneId }
          },
          onChanged: broadcastRemoteHostsChanged
        })
        remoteSshPanes.resolve = (paneId, geometry) => controller.resolvePanePty(paneId, geometry)
        return controller
      })
    }
    return remoteHostsLoader
  }
  ipcMain.handle(IPC_CHANNELS.remoteHosts.call, async (_event, request: unknown) => {
    const body = request && typeof request === 'object' ? request as { op?: unknown; input?: unknown } : {}
    if (typeof body.op !== 'string') return { ok: false, error: { code: 'invalid_op', message: 'Unknown remote hosts operation' } }
    const controller = await loadRemoteHosts()
    return controller.call(body.op as import('../../../shared/types/remote-hosts').RemoteHostCallOp, body.input)
  })
  const internalMcpGithub = new GitHubService(db)
  internalMcpGithub.configureWorktreeLifecycle({ stopTerminalsWithin: (dir) => terminalManager.stopWithin(dir) })
  const internalMcpGit = new GitService()
  const delegationAgents = new AgentService(db)
  const launcher = new AgentLaunchService(terminalManager, () => delegationAgents.list(), app.getPath('userData'))
  const { ThreadDelegationHost } = await import('../services/delegation/thread-delegation-host')
  const threadDelegationHost = new ThreadDelegationHost(
    threadManager.manager,
    executions,
    agentProfileId => {
      const provider = launcher.resolve(agentProfileId).provider
      if (provider !== 'claude' && provider !== 'codex') throw new Error('Unsupported delegation provider')
      return provider
    },
    agentProfileId => delegationAgents.list().find(profile => profile.agentProfileId === agentProfileId) ?? {},
    async rootPath => (await new (await import('../services/conversation/thread-projects')).ThreadProjectService(db).add(rootPath)).projectId
  )

  return {
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
    delegatedThreadObserver,
    sharedAgentActivity,
    skillService,
    mcpManager,
    creditsService,
    contextUsageService,
    oxeService,
    fileSystemService,
    internalMcpWorkspaceServ,
    internalMcpGithub,
    internalMcpGit,
    delegationAgents,
    launcher,
    threadDelegationHost
  }
}

export type WorkspaceServicesContext = Awaited<ReturnType<typeof bootstrapWorkspaceServices>>
