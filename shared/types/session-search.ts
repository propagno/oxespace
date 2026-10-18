export type SessionSearchAgent = 'claude' | 'codex'

export interface SessionSearchInput {
  query: string
  /** Only sessions whose working directory is this path or inside it. */
  cwd?: string
  agent?: SessionSearchAgent
  limit?: number
}

export interface SessionSearchHit {
  agent: SessionSearchAgent
  sessionId: string
  title: string | null
  cwd: string | null
  /** ms epoch of the session file's last write. */
  updatedAt: number
  messageCount: number
  /** FTS snippet with matches wrapped in `[` `]`. */
  snippet: string
  role: 'user' | 'assistant'
  /** Command to resume this exact session, to run from `cwd`. */
  resumeCommand: string
}

export interface SessionSearchResult {
  hits: SessionSearchHit[]
  /** How the query was matched: exact phrase, all terms, or any term. */
  mode: 'phrase' | 'all' | 'any' | 'none'
  /** Sessions indexed so far; lower than the total while the first scan is in progress. */
  indexedSessions: number
  indexing: boolean
}
