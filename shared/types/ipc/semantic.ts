/** The semantic index's status, logs and API as they cross the IPC boundary. Re-exported by `../ipc`. */

export interface SemanticStatus {
  enabled: boolean
  workerReady: boolean
  indexing: boolean
  count: number
  lastError: string | null
  /** Embedding model id (e.g. Xenova/multilingual-e5-base). */
  modelId?: string
  mode: SemanticSearchMode
  coverage: SemanticIndexCoverage
  lastQuery: SemanticLastQuery | null
  vector?: SemanticVectorStatus
}

/** A retrieval source that answered a query: the optional vector index, or exact terms. */
export type SemanticRetrievalSource = 'vector' | 'fts5'

/**
 * The optional vector index (Settings › Agents › Semantic index). The model is
 * not in the installer: it is downloaded or imported into userData on demand.
 */
export interface SemanticVectorStatus {
  /** The user turned the index on. */
  enabled: boolean
  /** The model files are present in userData. */
  installed: boolean
  state: 'off' | 'not-installed' | 'downloading' | 'loading' | 'ready' | 'error'
  /** Bytes fetched so far, while downloading. */
  progress: { loaded: number; total: number } | null
  modelId: string
  error: string | null
  /** False when this build has no model store (tests). */
  available: boolean
}

export interface SemanticUsageBucket {
  calls: number
  answered: number
  results: number
  estimatedTokens: number
}

/** Local-only counts of retrieval tool calls, split by whether vectors took part. */
export interface SemanticUsage {
  since: number
  tools: Record<string, { withVector: SemanticUsageBucket; withoutVector: SemanticUsageBucket }>
}

export type SemanticSearchMode = 'auto' | 'explore' | 'exhaustive'
export type SemanticConfidence = 'high' | 'medium' | 'low'

export interface SemanticIndexCoverage {
  lexicalDocuments: number
  lastIndexedAt: number | null
  byCategory: { source: number; test: number; config: number; docs: number; other: number }
}

export interface SemanticLastQuery {
  requestedMode: SemanticSearchMode
  resolvedMode: Exclude<SemanticSearchMode, 'auto'>
  confidence: SemanticConfidence
  expanded: boolean
  expansionReason: string | null
  durationMs: number
  semanticCandidates: number
  lexicalCandidates: number
  returnedResults: number
  estimatedTokens: number
  estimatedFullFileTokens: number
  estimatedSavingsPercent: number
  truncated: boolean
}

export type SemanticLogLevel = 'debug' | 'info' | 'warn' | 'error'

/** One line of the semantic engine's activity log, surfaced for transparency. */
export interface SemanticLogEntry {
  ts: number
  level: SemanticLogLevel
  message: string
  workspaceId?: string
  file?: string
}

export interface SemanticQueryHit {
  filePath: string
  score: number
}

export interface SemanticApi {
  getStatus(workspaceId: string): Promise<SemanticStatus>
  setEnabled(input: { workspaceId: string; enabled: boolean }): Promise<SemanticStatus>
  /** Semantic search for a Thread project's directory: whether it is on, and its index. */
  projectStatus(rootPath: string): Promise<{ on: boolean; status: SemanticStatus }>
  setProjectEnabled(input: { rootPath: string; enabled: boolean }): Promise<{ on: boolean; status: SemanticStatus }>
  setMode(input: { workspaceId: string; mode: SemanticSearchMode }): Promise<SemanticStatus>
  reindex(workspaceId: string): Promise<SemanticStatus>
  getLogs(): Promise<SemanticLogEntry[]>
  onLog(callback: (entry: SemanticLogEntry) => void): () => void
  query(input: { workspaceId: string; text: string; limit?: number }): Promise<SemanticQueryHit[]>
  getVectorStatus(): Promise<SemanticVectorStatus>
  setVectorIndex(enabled: boolean): Promise<SemanticVectorStatus>
  downloadModel(): Promise<SemanticVectorStatus>
  /** Opens a folder picker; resolves unchanged when the user cancels. */
  importModel(): Promise<SemanticVectorStatus>
  removeModel(): Promise<SemanticVectorStatus>
  getUsage(): Promise<SemanticUsage>
}
