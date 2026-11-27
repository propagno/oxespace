import { app, BrowserWindow, safeStorage } from 'electron'
import log from 'electron-log/main.js'
import { delimiter, join } from 'node:path'
import type { openDatabase } from '../db/index'
import { registerAgentIpc } from '../ipc/agent.ipc'
import { registerAgentHooksIpc } from '../ipc/agent-hooks.ipc'
import { registerFeatureUsageIpc } from '../ipc/feature-usage.ipc'
import { registerHostsProxyIpc } from '../ipc/hosts-proxy.ipc'
import { registerTaskIpc } from '../ipc/task.ipc'
import { registerTerminalIpc } from '../ipc/terminal.ipc'
import { registerWorkspaceIpc } from '../ipc/workspace.ipc'
import { codeAgentMcpLaunch, providerForExecutable } from '../services/agent-launch.service'
import { AgentHookServer } from '../services/agent-hooks/server'
import { hookServerOptionsFor } from '../services/agent-hooks/hook-pipeline'
import { setPreviewGrantAudit } from '../services/browser-preview/preview-grants'
import { ExecutionBindingStore } from '../services/execution-binding-store'
import { ExecutionRegistry } from '../services/execution-registry'
import { createSecretCipher } from '../services/oxequery/secret-cipher'
import { resolveSessionLocation } from '../services/git-common-dir'
import { TerminalManager } from '../services/terminal.service'
import { IPC_CHANNELS } from '../../../shared/types/ipc'

export type MainDatabase = ReturnType<typeof openDatabase>

export interface DelegationHandleRef {
  current?: {
    ownsPane(paneId: string): boolean
    exited(paneId: string): void
  }
}

export interface CoreServicesOptions {
  db: MainDatabase
  rootExists: (path: string) => boolean
  delegationRef: DelegationHandleRef
}

export async function bootstrapCoreServices({ db, rootExists, delegationRef }: CoreServicesOptions) {
  const [{ DelegationService }, { registerDelegationIpc }, { AndroidAgentAccess, AndroidDevices }, { registerAndroidIpc }] = await Promise.all([
    import('../services/delegation.service'), import('../ipc/delegation.ipc'),
    import('../services/android/android-devices'), import('../ipc/android.ipc')
  ])
  const executionStore = new ExecutionBindingStore({
    filePath: join(app.getPath('userData'), 'execution-bindings.json'),
    cipher: createSecretCipher(safeStorage)
  })
  const executions = new ExecutionRegistry({ store: executionStore })
  const personAuditStmt = db.prepare("INSERT INTO person_action_audit (ts, actor, action, target, outcome, code) VALUES (?, 'person', ?, ?, ?, ?)")
  setPreviewGrantAudit(entry => {
    try { personAuditStmt.run(Date.now(), entry.action, entry.target, entry.outcome, null) } catch { /* best-effort audit */ }
  })
  const androidDevices = new AndroidDevices()
  const androidAccess = new AndroidAgentAccess({
    devices: androidDevices,
    audit: {
      record: entry => {
        try { personAuditStmt.run(Date.now(), entry.action, entry.target, 'ok', entry.outcome) } catch { /* best-effort audit */ }
      }
    }
  })
  // The Android panel opens pairing through the gateway, which is registered further down.
  const remotePairing: { start?: () => Promise<{ uri: string; expiresAt: number }> } = {}
  const androidDisconnect: { notify?: (e: { serial: string; name: string; sessionKeys: string[] }) => void } = {}
  registerAndroidIpc({
    devices: androidDevices,
    access: androidAccess,
    startPairing: () => remotePairing.start ? remotePairing.start() : Promise.reject(new Error('Pairing is not ready yet')),
    audit: entry => { try { personAuditStmt.run(Date.now(), entry.action, entry.target, entry.outcome, entry.detail) } catch { /* best-effort audit */ } },
    onDeviceDisconnected: event => { log.info(`[android] device disconnected: ${event.serial} (${event.name})`); androidDisconnect.notify?.(event) }
  })
  registerAgentHooksIpc(app.getPath('userData'))
  // What each pane's agent is doing (working, blocked, done...), from its hooks and its screen.
  const [{ AgentStateService }, { loadManifests }, { BUNDLED_MANIFESTS }, { registerAgentStateIpc, broadcastAgentState }, { notifyAgentsChanged, onAgentsChanged }] = await Promise.all([
    import('../services/agent-state/agent-state.service'), import('../services/agent-state/manifest'),
    import('../services/agent-state/bundled-manifests'), import('../ipc/agent-state.ipc'), import('../services/agents/agents-notifier')
  ])
  const agentManifests = loadManifests(BUNDLED_MANIFESTS, join(app.getPath('userData'), 'agent-detection'))
  for (const warning of agentManifests.warnings) log.warn(`[agent-state] ${warning}`)
  // eslint-disable-next-line prefer-const -- assigned below; the history callback runs only after terminals start
  let terminalForHistory: { peek(paneId: string): { data: string } | null } | undefined
  const agentState = new AgentStateService({
    manifests: () => agentManifests.manifests,
    emit: event => { broadcastAgentState(event); notifyAgentsChanged() },
    history: paneId => terminalForHistory?.peek(paneId)?.data ?? null
  })
  registerAgentStateIpc(agentState)
  // S7.1: every agent in one overview (panes, conversations, delegations, work runs), for the window and later the phone.
  const [{ AgentsReadModel }, { registerAgentsIpc }, { ThreadHistory }, { englishText }] = await Promise.all([
    import('../services/agents/agents-read-model'), import('../ipc/agents.ipc'), import('../services/conversation/thread-history'), import('../agent-text')
  ])
  const agentThreadHistory = new ThreadHistory(db)
  const agentsModel = new AgentsReadModel({
    db,
    panes: () => agentState.list(),
    threadRequests: () => agentThreadHistory.pendingRequestsAll(),
    markPaneSeen: paneId => agentState.markSeen(paneId)
  })
  registerAgentsIpc(agentsModel)
  const { PaneAgentSessions } = await import('../services/agent-state/pane-sessions')
  const paneAgentSessions = new PaneAgentSessions(db)
  // Agents' own lifecycle hooks report here. Deliveries authenticate with the
  // same per-pane execution credentials the terminal already carries, so a
  // hook script outside an OXESpace terminal is simply inert.
  // A18 (P7) · the cwd each pane's agent reported last, for the task's Terminal tab.
  const paneAgentCwd = new Map<string, string>()
  const agentHookServer = new AgentHookServer(hookServerOptionsFor({
    db,
    authenticate: ({ executionId, token, workspaceId }) => {
      try {
        const execution = executions.authenticate(executionId, token, workspaceId)
        return execution.owner.kind === 'pane' ? { paneId: execution.owner.id, workspaceId: execution.workspaceId, launchRoot: execution.cwd } : null
      } catch {
        return null
      }
    },
    onStatus: (event) => {
      const hookAgent = event.agent === 'codex' ? 'codex' : 'claude'
      agentState.hook(event.paneId, hookAgent, event.state)
      // Remember the native session so the pane can reopen it after a restart; an ended session is forgotten.
      const sessionBefore = paneAgentSessions.current(event.paneId)?.sessionId
      if (event.state === 'ended') { paneAgentSessions.clear(event.paneId); paneAgentCwd.delete(event.paneId) }
      else if (event.sessionId) paneAgentSessions.record(event.paneId, hookAgent, event.sessionId, 'hook', event.permissionMode)
      // BE-A46-c5: the phone's reader of this pane's conversation hears a new (or ended) session: a higher epoch, one signal.
      if (paneAgentSessions.current(event.paneId)?.sessionId !== sessionBefore) void import('../services/remote/pane-conversation').then(module => module.announcePaneSession(event.paneId), () => undefined)
      if (event.agent === 'codex' && event.state === 'done') {
        const codexSessionId = event.sessionId ?? paneAgentSessions.current(event.paneId)?.sessionId
        if (codexSessionId) {
          void Promise.all([import('../services/http-audit/codex-rollout'), import('../services/http-audit/store')]).then(async ([rollout, store]) => {
            const file = await rollout.findCodexRolloutFile(codexSessionId)
            if (file) await rollout.ingestCodexRollout(new store.HttpAuditLog(db), { file, paneId: event.paneId, workspaceId: event.workspaceId, sessionId: codexSessionId })
          }).catch(() => undefined)
        }
      }
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(IPC_CHANNELS.agentHooks.onStatus, event)
      }
    },
    resolveLocation: resolveSessionLocation,
    onLocation: (event) => {
      paneAgentCwd.set(event.paneId, event.cwd)
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(IPC_CHANNELS.agentHooks.onLocation, event)
      }
    }
  }))
  // A bind failure only costs the hook signal; the heuristic keeps working.
  void agentHookServer.start().catch((error) => log.warn('Agent hook server unavailable', error))
  app.once('before-quit', () => agentHookServer.stop())
  const oxeQueryShells: { shellFor?: (paneId: string) => { file: string; args: string[] } | undefined } = {}
  registerFeatureUsageIpc(db)
  const hostsProxy = registerHostsProxyIpc(db, log)
  const ptyOption = await (await import('../services/terminal/utility-pty')).appPtyOption(
    process.env,
    join(app.getAppPath(), 'out', 'main', 'pty-host.js'),
    message => log.warn(message),
    { daemonEntry: join(app.getAppPath(), 'out', 'main', 'pty-daemon.js'), userDataPath: app.getPath('userData') }
  )
  const ptyDaemon = ptyOption.daemon ?? null
  // OXE-447 · Reconcile persisted execution credentials ONLY against live daemon sessions (purging dead entries).
  if (ptyDaemon) {
    void ptyDaemon.listSessions()
      .then(sessions => executions.reconcileWithLiveSessions(sessions.filter(s => s.alive).map(s => s.sessionId)))
      .catch(() => executions.reconcileWithLiveSessions([]))
  } else {
    void executions.reconcileWithLiveSessions([])
  }
  const terminalManager: TerminalManager = new TerminalManager(db, {
    ...ptyOption, // OXE-400/OXE-447: utility process (default), main, or detached PTY daemon
    rootExists, // OXE-367: a pane in a workspace folder that is gone is refused before any PTY is spawned
    oxeQueryShell: paneId => oxeQueryShells.shellFor?.(paneId),
    grantProxy: origin => hostsProxy.grant(origin),
    observer: agentState,
    resumeSession: (paneId, wanted, again) => paneAgentSessions.take(paneId, wanted, again),
    assignSession: (paneId, agent, sessionId) => paneAgentSessions.record(paneId, agent, sessionId, 'launch'),
    clearSession: paneId => paneAgentSessions.clear(paneId),
    currentSession: paneId => paneAgentSessions.current(paneId),
    isManagedPane: paneId => delegationRef.current?.ownsPane(paneId) ?? false,
    onLaunchExit: (paneId) => {
      const ex = executions.forOwner({ kind: 'pane', id: paneId })
      if (ex) androidAccess.revokeSession(ex.id)
      executions.end(paneId)
      delegationRef.current?.exited(paneId)
    },
    executionEnvironment: (input) => {
      const meta = db.prepare('SELECT port, token FROM internal_mcp_meta LIMIT 1').get() as { port: number; token: string } | undefined
      const hookPort = agentHookServer.port
      const binDir = join(app.getPath('userData'), 'bin')
      const pathKey = Object.keys(process.env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH'
      const currentPath = process.env[pathKey] ?? ''
      const pathEntries = currentPath.split(delimiter).filter(Boolean)
      const nextPath = pathEntries.some((entry) => entry.toLowerCase() === binDir.toLowerCase()) ? currentPath : [binDir, ...pathEntries].join(delimiter)
      return {
        ...executions.register(input),
        [pathKey]: nextPath,
        ...(hookPort ? { OXESPACE_AGENT_HOOK_PORT: String(hookPort) } : {}),
        ...(meta ? { OXESPACE_MCP_PORT: String(meta.port), OXESPACE_MCP_TOKEN: meta.token } : {})
      }
    },
    agentMcpArgs: (executable, args, workspaceId) => codeAgentMcpLaunch(db, providerForExecutable(executable), join(app.getPath('userData'), 'bin', 'oxespace-mcp.cjs'), workspaceId, args),
    emitData: (event) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(IPC_CHANNELS.terminal.onData, event)
      }
    },
    emitExit: (event) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(IPC_CHANNELS.terminal.onExit, event)
      }
    },
    // Detached sessions send this instead of their output, so the sidebar and
    // notifications still reflect a background agent without shipping bytes
    // that no view would render.
    // A18 (T73) · The pane header's branch, pushed when it changes.
    emitBranchChanged: (event) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.terminal.branchChanged, event)
      }
    },
    emitActivity: (event) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(IPC_CHANNELS.terminal.onActivity, event)
      }
    },
    emitSizeLease: (event) => { for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.terminal.sizeLeaseChanged, event) }, // a phone took or gave back a pane's size
    userDataPath: app.getPath('userData')
  })

  terminalForHistory = terminalManager
  registerWorkspaceIpc(db, terminalManager)
  registerTerminalIpc(terminalManager)
  registerAgentIpc(db)
  const taskService = registerTaskIpc(db, terminalManager)

  return {
    db,
    DelegationService,
    registerDelegationIpc,
    executions,
    androidDevices,
    androidAccess,
    androidDisconnect,
    remotePairing,
    agentState,
    notifyAgentsChanged,
    onAgentsChanged,
    agentThreadHistory,
    agentsModel,
    englishText,
    paneAgentSessions,
    paneAgentCwd,
    oxeQueryShells,
    hostsProxy,
    ptyDaemon,
    terminalManager,
    taskService
  }
}

export type CoreServicesContext = Awaited<ReturnType<typeof bootstrapCoreServices>>
