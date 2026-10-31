/**
 * S7.1 · The words of the needs-you desktop notification (§5.10) and what its click opens. Pure, so it is tested
 * without Electron: one row says who and for how long, several say how many; the body is each request's main-built
 * title. The click sends `agents:activate` for the first row and its request, nothing else (it never answers).
 */
import { messageKey } from '../../../../shared/messages'
import type { AgentActivateEvent, AgentOverviewRow } from '../../../../shared/types/ipc/agents'

export type Translate = (key: string, values?: Record<string, unknown>) => string

export interface NudgeNotice { title: string; body: string; activate: AgentActivateEvent }

export function nudgeNotice(rows: AgentOverviewRow[], t: Translate, now: number): NudgeNotice | null {
  const [row] = rows
  if (!row) return null
  const minutes = Math.max(1, Math.round((now - (row.pendingRequest?.since ?? row.since)) / 60_000))
  const title = rows.length === 1 ? t(messageKey('agents.nudge.single'), { agent: row.title, minutes }) : t(messageKey('agents.nudge.batch'), { count: rows.length })
  const body = rows.map(item => (item.pendingRequest ? t(messageKey(item.pendingRequest.title.code)) : item.title)).join(' · ')
  return { title, body, activate: { agentId: row.key, ...(row.pendingRequest ? { requestId: row.pendingRequest.id } : {}) } }
}
