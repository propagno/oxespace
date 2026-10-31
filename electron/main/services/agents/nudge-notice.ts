/**
 * S7.1 · The words of the needs-you desktop notification (§5.10, #355) and what its click opens. Pure, so it is tested
 * without Electron: one row says who and the chosen delay ("has needed you for 2 min": the setting's 1, 2 or 5, not the
 * time measured), several say how many; the body is each request's main-built title. With the setting off there is no
 * notification. The click sends `agents:activate` for the first row and its request, nothing else (it never answers).
 */
import { messageKey } from '../../../../shared/messages'
import type { AgentActivateEvent, AgentOverviewRow } from '../../../../shared/types/ipc/agents'

export type Translate = (key: string, values?: Record<string, unknown>) => string

export interface NudgeNotice { title: string; body: string; activate: AgentActivateEvent }

export function nudgeNotice(rows: AgentOverviewRow[], t: Translate, nudgeAfterMs: number | null): NudgeNotice | null {
  const [row] = rows
  if (!row || nudgeAfterMs === null) return null
  const minutes = Math.round(nudgeAfterMs / 60_000)
  const title = rows.length === 1 ? t(messageKey('agents.nudge.single'), { agent: row.title, minutes }) : t(messageKey('agents.nudge.batch'), { count: rows.length })
  const body = rows.map(item => (item.pendingRequest ? t(messageKey(item.pendingRequest.title.code)) : item.title)).join(' · ')
  return { title, body, activate: { agentId: row.key, ...(row.pendingRequest ? { requestId: row.pendingRequest.id } : {}) } }
}
