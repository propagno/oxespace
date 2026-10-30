/** Persistent knowledge is scoped to a project; native agent sessions remain independent. */
export interface MemoryContext {
  projectId: string
  workspace: string
  project: string
  cwd: string
  agentId?: string
  sessionId?: string
  /** Where the agent's request came from: the Thread, and the last thing the person asked there (already redacted and short). */
  threadId?: string
  originExcerpt?: string
  /** Who the answer is for. A handoff to another agent never receives personal notes. Default: the person's own agent. */
  audience?: 'self' | 'delegate'
  /** True for the brief that starts a session without a request: notes that look like instructions are left out of it. */
  automatic?: boolean
}

export type MemoryKind = 'decision' | 'lesson' | 'issue' | 'todo' | 'preference'
export const MEMORY_KINDS: readonly MemoryKind[] = ['decision', 'lesson', 'issue', 'todo', 'preference']
/** supersedes is the page path of an earlier note this one corrects; nothing is merged or deleted automatically. */
export interface MemoryInput { text: string; title?: string; kind?: MemoryKind; supersedes?: string }
/** Who may use a note: `personal` only the person's own agents here, `project` every agent of the project (the default), `team` also what is shared out of this machine. */
export type MemoryScope = 'personal' | 'project' | 'team'
export const MEMORY_SCOPES: readonly MemoryScope[] = ['personal', 'project', 'team']
export type MemoryTrust = 'trusted' | 'untrusted'
/** `user` wrote or reviewed it; `agent` an agent chose to record it; `file`, `web` and `tool` came from that kind of content; `unknown` was captured by the memory service itself. */
export type MemoryOriginKind = 'user' | 'agent' | 'file' | 'web' | 'tool' | 'unknown'
export interface MemoryResult {
  text: string; path?: string; source: string; title?: string; updatedAt?: string; score?: number
  /** Added when the app knows the note; a note it does not know is untrusted. */
  trust?: MemoryTrust; scope?: MemoryScope; pinned?: boolean; originKind?: MemoryOriginKind
}
export type MemoryNoteState = 'active' | 'wrong' | 'expired' | 'deleted' | 'superseded'
export interface MemoryNoteUse { agentId: string; uses: number; firstUsedAt: number; lastUsedAt: number }
/** One note as the person sees it: the note, where it came from, its state, and which agents were given it. */
export interface MemoryNote {
  path: string; title?: string; text: string; kind?: MemoryKind
  /** What was chosen, and what applies now: policy can lower a team note to project. */
  scope: MemoryScope; effectiveScope: MemoryScope
  trust: MemoryTrust; suspicious: boolean
  origin: { kind: MemoryOriginKind; agentId?: string; sessionId?: string; threadId?: string; excerpt?: string }
  pinned: boolean; wrong: boolean; expiresAt?: number; supersededBy?: string; deletedAt?: number
  state: MemoryNoteState
  createdAt: number; updatedAt: number
  usedBy: MemoryNoteUse[]
  /** Why the note cannot be shared with the team yet, when it cannot. */
  teamBlock?: string
}
export interface MemoryNotesView { notes: MemoryNote[]; teamAllowed: boolean; teamBlock?: string }
export interface MemoryExport { fileName: string; content: string; count: number }
export type MemoryResetScope = 'project' | 'all'
export interface MemoryResetResult { scope: MemoryResetScope; notesRemoved: number; storeErased: boolean }
export interface MemorySession { sessionId: string; agentId: string; cwd: string; ended: boolean }
export interface MemoryHandoff { id: string; summary: string; cwd?: string; state: string; nextSteps: string[]; openQuestions: string[]; filesTouched: string[] }
export interface ProjectContext { text: string; sources: string[] }
export type MemoryErrorCode = 'authentication' | 'timeout' | 'cancelled' | 'transport' | 'http' | 'protocol' | 'rejected' | 'response-too-large'
export interface MemoryCapabilities { exactHandoff: boolean; createHandoff: boolean; sessionObservations: boolean; deletePage?: boolean }
/** Availability is independent of capture, delivery and asynchronous consolidation. */
export interface MemoryPipelineStatus {
  capture: 'unknown' | 'disabled' | 'active' | 'suspended' | 'failed'
  delivery: 'unknown' | 'idle' | 'pending' | 'delivering' | 'failed'
  consolidation: 'unknown' | 'idle' | 'pending' | 'running' | 'failed'
}
export interface MemoryHealth {
  status: 'disabled' | 'ready' | 'unavailable'
  message?: string
  errorCode?: MemoryErrorCode
  pipeline?: MemoryPipelineStatus
}
export interface MemorySettings {
  enabled: boolean
  automaticCapture: boolean
  automaticContext: boolean
}
export interface MemoryRuntimeSettings {
  mode: 'managed' | 'connected'
  executable: string
  url: string
}
export interface MemoryWorkspaceStatus {
  /** False when Shared Project Memory is not enabled in this build; the interface must then show nothing. */
  featureEnabled?: boolean
  projectId: string
  settings: MemorySettings
  runtime: MemoryRuntimeSettings
  health: MemoryHealth
  sessions: MemorySession[]
  rollbackAvailable?: boolean
  outbox?: { pending: number; quarantined: number; bytes: number; refused: number; stored: number; replayed: number; dropped: number; failed: number; oldestAt?: number; lastDeliveredAt?: number; lastFailureAt?: number }
}
/** Physical bytes per top-level entry of the memory directory. Informational only: nothing here is deleted by the app. */
export interface MemoryStorageUsage { categories: Record<string, number>; totalBytes: number; truncated: boolean; measuredAt: number }
export type MemoryReply<T> = { status: 'ok'; value: T } | { status: 'disabled' | 'unavailable'; message: string }
export interface MemoryApi {
  status(workspaceId: string): Promise<MemoryWorkspaceStatus>
  configure(input: { workspaceId: string; settings: MemorySettings; runtime: MemoryRuntimeSettings; token?: string }): Promise<MemoryWorkspaceStatus>
  install(): Promise<string>
  rollback(workspaceId: string): Promise<MemoryWorkspaceStatus>
  setupAgents(workspaceId: string): Promise<string>
  search(input: { workspaceId: string; query: string }): Promise<MemoryReply<MemoryResult[]>>
  recent(workspaceId: string): Promise<MemoryReply<MemoryResult[]>>
  storage(): Promise<MemoryStorageUsage>
  /** Every note the app knows for the workspace's project, with its origin and state; searched by text when `query` is given. */
  notes(input: { workspaceId: string; query?: string }): Promise<MemoryNotesView>
  /** Hides the note from every agent and tool; erased from the memory service too when it can. */
  noteDelete(input: { workspaceId: string; path: string }): Promise<{ erased: boolean }>
  /** Notes as JSON Lines with secrets removed. `scope: 'team'` exports only what the team may receive. */
  export(input: { workspaceId: string; scope?: 'all' | 'team' }): Promise<MemoryExport>
  /** `confirm` must be the word RESET. `all` also erases the managed store of every project. */
  reset(input: { workspaceId: string; scope: MemoryResetScope; confirm: string }): Promise<MemoryResetResult>
  /** Offers are listed without being consumed. */
  handoffs(workspaceId: string): Promise<MemoryReply<MemoryHandoff[]>>
  /** Consumes exactly this offer; stale or already accepted offers are refused. */
  acceptHandoff(input: { workspaceId: string; handoffId: string }): Promise<MemoryReply<MemoryHandoff>>
}
