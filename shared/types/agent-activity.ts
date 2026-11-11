import type { HttpAuditActor } from './http-audit'

export const AGENT_ACTIVITY_SOURCES = ['changes', 'databases', 'containers', 'http'] as const
export type AgentActivitySource = typeof AGENT_ACTIVITY_SOURCES[number]

export interface AgentActivityRow {
  id: string
  at: number
  source: AgentActivitySource
  actor: HttpAuditActor
  workspaceId: string
  agent: string
  summary: string
  target: string
  write: boolean
  decision: string
  outcome: string
  errorCode?: string | null
  detailRef?: string
  status?: number | null
  path?: string
  line?: number | null
  added?: number | null
  removed?: number | null
}

export type AgentActivityView = 'all' | 'problems'

export interface AgentActivityQuery {
  sources?: AgentActivitySource[]
  view?: AgentActivityView
  agent?: string
  workspaceId?: string
  cursor?: string
  limit?: number
}

export interface AgentActivityPage {
  rows: AgentActivityRow[]
  cursor: string | null
  failedSources: AgentActivitySource[]
}

export interface AgentActivityBadgeQuery {
  connectionId: string
}

export interface AgentActivityBadge {
  today: number
  waiting: boolean
}

export interface AgentActivitySummary {
  changes: number | null
  databases: number | null
  containers: number | null
  http: number | null
  httpProduction: number | null
  failedSources: AgentActivitySource[]
}

export interface AgentActivityApi {
  list(query?: AgentActivityQuery): Promise<AgentActivityPage>
  detail(id: string): Promise<Record<string, unknown> | null>
  badge(query: AgentActivityBadgeQuery): Promise<AgentActivityBadge>
}
