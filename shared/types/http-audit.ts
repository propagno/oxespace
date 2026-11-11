export interface HttpAuditActor {
  kind: 'pane' | 'thread' | 'unknown'
  id: string
  name: string
  gone: boolean
}

export interface HttpAuditRow {
  id: number
  at: number
  actor: HttpAuditActor
  workspaceId: string
  agent: string
  sourceKind: 'hook' | 'rollout'
  tool: string
  method: string
  scheme: string
  host: string
  port: number
  pathTemplate: string
  queryKeys: string[]
  headerNames: string[]
  hasBody: boolean
  bodyBytes: number | null
  status: number | null
  durationMs: number | null
  insecure: boolean
  plainHttpExternal: boolean
  commandRedacted: string
  outputTruncated: boolean
  production: boolean
}

export type HttpAuditView = 'all' | 'errors' | 'flagged'

export interface HttpAuditQuery {
  workspaceId: string
  actor?: string
  view?: HttpAuditView
  filter?: string
  cursor?: string
  limit?: number
}

export interface HttpAuditHostSummary {
  host: string
  count: number
  production: boolean
}

export interface HttpAuditPage {
  rows: HttpAuditRow[]
  cursor: string | null
  hosts: HttpAuditHostSummary[]
}

export interface HttpAuditApi {
  list(query: HttpAuditQuery): Promise<HttpAuditPage>
}
