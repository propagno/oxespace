/**
 * S7.1 · Startup wiring for the agents read model: the `agents:*` handlers now, the model itself on the first call or
 * the first source event (its modules load then, never at boot). Kept out of index.ts so the entry file stays small.
 */
import { app, BrowserWindow, Notification } from 'electron'
import { agentTimersE2e, readAgentTimers, type AgentNudgeChoice } from '../../../../shared/agents/agentTimers'
import { IPC_CHANNELS } from '../../../../shared/types/ipc'
import type { AgentOverviewRow, AgentsChange } from '../../../../shared/types/ipc/agents'
import type { PaneAgentState } from '../../../../shared/types/agent-state'
import type { Workspace } from '../../../../shared/types/workspace'
import type { AppDatabase } from '../../db'
import { registerAgentsIpc } from '../../ipc/agents.ipc'
import type { Translate } from './nudge-notice'
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

const windows = (): BrowserWindow[] => BrowserWindow.getAllWindows().filter(window => !window.isDestroyed())

export function wireAgents(deps: AgentsWiringDeps): void {
  const settings = import('./agent-settings').then(({ AgentSettingsStore }) => new AgentSettingsStore(deps.db))
  /** The delay in force, kept in memory: the timers read it on every flush. */
  let nudgeAfterMs: AgentNudgeChoice | undefined
  const load = (): Promise<AgentsReadModel> => (loading ??= (async () => {
    const [{ AgentsReadModel }, { dbAgentSources }, { AgentSeenStore }, sources, { approvalCenter }, { tMain }, { nudgeNotice }, store] = await Promise.all([
      import('./read-model'), import('./db-sources'), import('./agent-seen-store'), import('./source-events'), import('../approvals'), import('../../i18n'), import('./nudge-notice'), settings
    ])
    nudgeAfterMs ??= store.nudgeAfterMs()
    const model = new AgentsReadModel({
      sources: dbAgentSources({ db: deps.db, panes: deps.agentState, approvals: approvalCenter, workspaces: deps.workspaces, profiles: deps.profiles }),
      seen: new AgentSeenStore(deps.db),
      subscribe: listener => sources.onAgentSource(listener),
      subscribeStops: (listener, failed) => { const offs = [sources.onAgentStop(listener), sources.onAgentStopFailed(failed)]; return () => { for (const off of offs) off() } },
      publish: (change: AgentsChange) => { for (const window of windows()) window.webContents.send(IPC_CHANNELS.agents.changed, change) },
      nudge: rows => showNudge(nudgeNotice(rows, tMain as Translate, nudgeAfterMs ?? null)),
      focused: () => BrowserWindow.getFocusedWindow() !== null,
      markPaneSeen: paneId => deps.agentState.markSeen(paneId),
      timers: readAgentTimers(process.env, agentTimersE2e(process.env, app.isPackaged)),
      nudgeAfterMs: () => nudgeAfterMs ?? null
    })
    model.start()
    // Focus can pass through "no window focused" while it moves between two OXESpace windows: check once it settled.
    app.on('browser-window-blur', () => setImmediate(() => model.focusChanged()))
    app.once('before-quit', () => model.stop())
    return model
  })())
  registerAgentsIpc({
    model: load,
    nudge: {
      get: async () => ({ afterMs: nudgeAfterMs ?? (nudgeAfterMs = (await settings).nudgeAfterMs()) }),
      set: async value => {
        nudgeAfterMs = (await settings).setNudgeAfterMs(value)
        ;(await loading)?.settingChanged()
        // Phones get the new delay in a fresh snapshot (C5); the gateway (#204) listens for it.
        ;(await import('./remote-seam')).requestRemoteAgentsResnapshot()
        return { afterMs: nudgeAfterMs }
      }
    }
  })
  // Also on the first thing an agent does, so the needs-you nudge works before any window asked for the overview.
  void import('./source-events').then(({ onAgentSource }) => {
    const off = onAgentSource(() => { off(); void load() })
  })
}

/** Shows the needs-you notification; its click brings the window forward and asks it to open Respond (`agents:activate`). */
function showNudge(notice: { title: string; body: string; activate: { agentId: AgentOverviewRow['key']; requestId?: string } } | null): void {
  if (!notice || !Notification.isSupported()) return
  const notification = new Notification({ title: notice.title, body: notice.body, silent: false })
  notification.on('click', () => {
    const [window] = windows()
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
    window.webContents.send(IPC_CHANNELS.agents.activate, notice.activate)
  })
  notification.show()
}
