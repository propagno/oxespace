import { BrowserWindow, ipcMain } from 'electron'
import type { AgentActivityBadgeQuery, AgentActivityChange, AgentActivityQuery } from '../../../shared/types/agent-activity'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import { parseAgentActivityQuery, type AgentActivity } from '../services/agent-activity/read-model'
import { auditWritten } from '../services/oxequery/audit-log'
import { expectPositiveInteger, expectRecord, parseBoundedId } from './validation'

/** PQ-07·7: hands one change to every open window on agentActivity:changed; a destroyed window is skipped. */
function sendChanged(change: AgentActivityChange): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue
    try { window.webContents.send(IPC_CHANNELS.agentActivity.changed, change) } catch { /* closing window */ }
  }
}

function parseListQuery(value: unknown): AgentActivityQuery {
  const query = parseAgentActivityQuery(value)
  if (query.limit !== undefined) expectPositiveInteger(query.limit, 'limit')
  return query
}

function parseBadgeQuery(value: unknown): AgentActivityBadgeQuery {
  return { connectionId: parseBoundedId(expectRecord(value, 'agent-activity:badge input').connectionId, 'connectionId') }
}

export function registerAgentActivityIpc(activity: AgentActivity): void {
  ipcMain.handle(IPC_CHANNELS.agentActivity.list, (_event, query: unknown) => activity.list(parseListQuery(query)))
  ipcMain.handle(IPC_CHANNELS.agentActivity.detail, (_event, id: unknown) => activity.detail(parseBoundedId(id, 'id')))
  ipcMain.handle(IPC_CHANNELS.agentActivity.badge, (_event, query: unknown) => activity.badge(parseBadgeQuery(query)))
  activity.onChanged(sendChanged)
  // PQ-07·7: an OxeQuery audit entry or an approval for a connection pushes agentActivity:changed to the windows.
  auditWritten.notify = change => activity.notifyChanged(change)
}
