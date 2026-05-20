import type { AgentProvider } from './agent'

export interface SessionSummary {
  sessionId: string
  provider: AgentProvider
  modelId: string | null
  requestCount: number
  lastUpdatedMs: number
  sessionStartedAtMs: number
  /** Total tokens (cumulative across the session) */
  totalTokens: number
  /** Estimated API-equivalent cost in USD */
  estimatedCostUsd: number
  /** Filesystem path of the JSONL transcript (Claude only — null for others). */
  filePath: string | null
  /** Whether this session originated from a fork. */
  isFork: boolean
  /** Parent session id when isFork is true. */
  parentSessionId: string | null
  /** Human-readable label set when forking; null otherwise. */
  label: string | null
  /** First non-system user message of the session, truncated. Null when the
   *  provider doesn't expose a readable transcript or the preview failed. */
  firstMessagePreview: string | null
}

export interface ForkSessionInput {
  workspaceId: string
  workspaceRootPath: string
  provider: AgentProvider
  parentSessionId: string
  /** Number of messages from the parent transcript to copy into the fork (-1 = all). */
  messageCount: number
  label?: string
}

export interface ForkSessionResult {
  forkSessionId: string
  filePath: string
}

export interface ResumeSessionInput {
  paneId: string
  workspaceId: string
  sessionId: string
  provider: AgentProvider
}
