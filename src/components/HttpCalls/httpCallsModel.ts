import type { HttpAuditRow } from '../../../shared/types/http-audit'

export function formatAgentName(agent?: string): string {
  if (!agent) return ''
  if (agent === 'claude-code') return 'Claude'
  if (agent === 'codex') return 'Codex'
  return agent.charAt(0).toUpperCase() + agent.slice(1)
}

export function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function formatRowButtonLabel(row: HttpAuditRow): string {
  const method = row.method || 'GET'
  const path = row.pathTemplate || '/'
  const status = row.status != null ? String(row.status) : 'No status'
  const agent = formatAgentName(row.agent)
  const time = formatTime(row.at)
  return `${method} ${path}, ${status}, ${agent}, ${time}`
}

export function formatHeaders(headerNames: string[]): string {
  return headerNames.join(', ')
}

export function formatBodySize(bytes: number | null): string {
  return bytes != null ? `${bytes} B` : ''
}

export function formatResponse(status: number | null, durationMs: number | null): string {
  if (status != null && durationMs != null) {
    return `${status} · ${durationMs} ms`
  }
  if (status != null) {
    return `${status}`
  }
  return 'No status'
}
