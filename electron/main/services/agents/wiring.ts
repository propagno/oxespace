/**
 * S7.1 · Startup wiring for the agents read model: the two `agents:*` handlers now, the model itself on the first
 * call (its modules load then, never at boot). Kept out of index.ts so the entry file stays small.
 */
import { app, BrowserWindow, Notification } from 'electron'
import { agentTimersE2e, readAgentTimers } from '../../../../shared/agents/agentTimers'
import { messageKey } from '../../../../shared/messages'
import { IPC_CHANNELS } from '../../../../shared/types/ipc'
import type { AgentOverviewRow, AgentsChange } from '../../../../shared/types/ipc/agents'
import type { PaneAgentState } from '../../../../shared/types/agent-state'
import type { Workspace } from '../../../../shared/types/workspace'
import type { AppDatabase } from '../../db'
import { registerAgentsIpc } from '../../ipc/agents.ipc'
import type { AgentsReadModel } from './read-model'

export interface AgentsWiringDeps {
  db: AppDatabase
  agentState: { list(): PaneAgentState[]; get(paneId: string): PaneAgentState | null; markSeen(paneId: string): void }
  workspaces: () => Workspace[]
  profiles: () => Array<{ agentProfileId: string; provider: string; parentProvider?: string | null }>
}

let loading: Promise<AgentsReadModel> | null = null

/** The read model, once loaded; the remote gateway (#204) and later callers share it. */
export function agentsReadModel(): Promise<AgentsReadModel> | null {
  return loading
}

export function wireAgents(deps: AgentsWiringDeps): void {
  const load = (): Promise<AgentsReadModel> => (loading ??= (async () => {
    const [{ AgentsReadModel }, { dbAgentSources }, { AgentSeenStore }, sources, { approvalCenter }, { tMain }] = await Promise.all([
      import('./read-model'), import('./db-sources'), import('./agent-seen-store'), import('./source-events'), import('../approvals'), import('../../i18n')
    ])
    const store = new AgentSeenStore(deps.db)
    const model = new AgentsReadModel({
      sources: dbAgentSources({ db: deps.db, panes: deps.agentState, approvals: approvalCenter, workspaces: deps.workspaces, profiles: deps.profiles }),
      seen: store,
      subscribe: listener => sources.onAgentSource(listener),
      subscribeStops: listener => sources.onAgentStop(listener),
      publish: (change: AgentsChange) => { for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.agents.changed, change) },
      nudge: rows => showNudge(rows, tMain as (key: string, values?: Record<string, unknown>) => string),
      focused: () => BrowserWindow.getFocusedWindow() !== null,
      markPaneSeen: paneId => deps.agentState.markSeen(paneId),
      timers: readAgentTimers(process.env, agentTimersE2e(process.env, app.isPackaged))
    })
    model.start()
    app.on('browser-window-blur', () => model.focusChanged())
    app.once('before-quit', () => model.stop())
    return model
  })())
  registerAgentsIpc({ model: load })
  // Also on the first thing an agent does, so the needs-you nudge works before any window asked for the overview.
  void import('./source-events').then(({ onAgentSource }) => {
    const off = onAgentSource(() => { off(); void load() })
  })
}

/** One desktop notification for needs-you rows (§5.10). Clicking it brings the window forward; it never answers. */
function showNudge(rows: AgentOverviewRow[], t: (key: string, values?: Record<string, unknown>) => string): void {
  if (!rows.length || !Notification.isSupported()) return
  const [row] = rows
  const minutes = Math.max(1, Math.round((Date.now() - (row.pendingRequest?.since ?? row.since)) / 60_000))
  const title = rows.length === 1 ? t(messageKey('agents.nudge.single'), { agent: row.title, minutes }) : t(messageKey('agents.nudge.batch'), { count: rows.length })
  const body = rows.map(item => (item.pendingRequest ? t(messageKey(item.pendingRequest.title.code)) : item.title)).join(' · ')
  const notification = new Notification({ title, body, silent: false })
  notification.on('click', () => {
    const window = BrowserWindow.getAllWindows().find(item => !item.isDestroyed())
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  })
  notification.show()
}
