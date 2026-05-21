export interface UsageSessionMetadata {
  sessionId: string
  lastUpdatedMs: number
  sessionStartedAtMs: number
  modelId: string | null
  requestCount: number
  workspaceRootPath?: string | null
}
