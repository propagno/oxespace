/** Conversation identity is distinct from native session, memory run and pane IDs. */
export type ThreadProvider = 'claude' | 'codex'
export type ThreadStatus = 'idle' | 'running' | 'approval' | 'interrupted' | 'failed'
export type ThreadOperationState = 'created' | 'sent' | 'acknowledged' | 'running' | 'completed' | 'failed' | 'cancelled' | 'unknown'
export type ThreadOperationKind = 'turn' | 'queue' | 'request' | 'configuration' | 'command' | 'recovery'
/** What the user can rely on for a message, derived from its operation. Never claims more than was observed. */
export type ThreadDeliveryState = 'sending' | 'delivered' | 'unconfirmed' | 'rejected'
export interface ThreadDelivery { state: ThreadDeliveryState; error?: string; updatedAt: number }
export type ThreadConnectionState = 'starting' | 'connected' | 'degraded' | 'reconnecting' | 'closed'
export interface ThreadConnectionStatus {
  state: ThreadConnectionState
  attempt: number
  changedAt: number
  lastHeartbeatAt?: number
  /** Last data received from the native provider while a turn was active. */
  lastNativeSignalAt?: number
  nextRetryAt?: number
  detail?: string
}

/** Durable identity around a provider or local operation. Visual events remain payloads. */
export interface ThreadOperation {
  id: string
  threadId: string
  turnId?: string
  generation: number
  kind: ThreadOperationKind
  state: ThreadOperationState
  createdAt: number
  updatedAt: number
  error?: string
}

/** Versioned storage/transport envelope. V1 event payloads remain readable. */
export interface ThreadEventEnvelope<T extends ThreadEvent = ThreadEvent> {
  schemaVersion: 2
  eventId: string
  operationId?: string
  threadId: string
  turnId?: string
  generation: number
  sequence: number
  createdAt: number
  updatedAt: number
  payload: T
}

export interface ThreadCommand {
  name: string
  description: string
  source: ThreadProvider | 'oxe'
  argumentHint?: string
  execution?: 'conversation' | 'cli' | 'desktop' | 'unavailable'
  unavailableReason?: string
}
export interface ThreadCommandCatalog { commands: ThreadCommand[]; warning?: string }
export interface ThreadModel { id: string; label: string; description: string; efforts: string[]; defaultEffort?: string; isDefault?: boolean }
export interface ThreadConfiguration {
  model?: string
  reasoningEffort?: string
  access?: 'read-only' | 'workspace-write' | 'full-access'
  networkAccess?: boolean
  approvalPolicy?: 'untrusted' | 'on-request' | 'never'
  mode?: 'default' | 'plan'
  /** Native provider hooks. Disabled by default and never allowed in read-only. */
  hooksEnabled?: boolean
}
/** `defaultKnown: false` means project or user settings may choose another model, so no default is named. */
export interface ThreadModelCatalog { models: ThreadModel[]; defaultModel?: string; defaultEffort?: string; defaultKnown?: boolean }
export type ThreadCapabilityAvailability = 'supported' | 'unavailable' | 'experimental'
export interface ThreadCapability {
  availability: ThreadCapabilityAvailability
  enabled: boolean
  authorized: boolean
  implemented: boolean
  verified: 'none' | 'fixture' | 'native' | 'pilot'
  reason?: string
}
export interface ThreadCapabilityManifest {
  provider: ThreadProvider
  providerVersion?: string
  protocolVersion?: string
  platform: NodeJS.Platform
  authentication: 'subscription' | 'api' | 'unknown'
  features: Record<string, ThreadCapability>
}
export interface ThreadUsageWindow { label: string; usedPercent: number; resetsAt?: number; windowMinutes?: number }
export interface ThreadUsage { windows: ThreadUsageWindow[]; checkedAt: number }
export interface ThreadFailure { id: string; occurredAt: number; code: 'authentication' | 'usage' | 'rate-limit' | 'context' | 'budget' | 'server' | 'network' | 'sandbox' | 'configuration' | 'session-busy' | 'unknown'; message: string; detail?: string; providerCode?: string; httpStatus?: number; usage?: ThreadUsage; usageUnavailable?: boolean }
export interface ThreadCommandResult { kind: 'applied' | 'panel' | 'navigate'; title?: string; text?: string; externalUrl?: string; surface?: 'model' | 'effort' | 'permissions' | 'accounts' | 'commands' | 'sessions' | 'rename' | 'settings' | 'delegations' | 'changes'; threadId?: string; usage?: ThreadUsage; rows?: { label: string; detail?: string; id?: string; turnId?: string }[] }
/** Resolved in the main process; skill paths are never accepted from the renderer. */
export interface ThreadAttachment {
  id: string
  name: string
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
  bytes: number
  /** Main-process only. Never accepted from the renderer. */
  path?: string
}
export interface ThreadAgentInput { text: string; skill?: { name: string; path: string }; attachments?: ThreadAttachment[]; nativeCli?: boolean }

export interface ThreadExecutionContext extends ThreadConfiguration {
  threadId: string
  workspaceId: string
  projectId: string
  rootPath: string
  nativeSessionId: string | null
  generation: number
  authentication: 'subscription' | 'api'
}

export interface ThreadRequestOption { label: string; description?: string; value?: string }
export interface ThreadRequestQuestion {
  id: string
  header?: string
  question: string
  options?: ThreadRequestOption[]
  multiple?: boolean
  secret?: boolean
  required?: boolean
}
/** What OXESpace observed, not a claim that the provider completed the tool. */
export type ThreadRequestResolution = 'answered' | 'approved' | 'declined' | 'cancelled-by-user' | 'turn-completed' | 'turn-failed' | 'interrupted' | 'connection-lost' | 'unknown'
export interface ThreadRequest {
  id: string
  nativeId: string
  nativeMethod: string
  kind: 'approval' | 'question' | 'permissions' | 'elicitation' | 'tool'
  title: string
  detail?: string
  command?: string
  cwd?: string
  reason?: string
  threadId?: string
  turnId?: string
  generation: number
  createdAt: number
  expiresAt?: number
  state: 'pending' | 'resolved' | 'cancelled' | 'expired'
  resolution?: ThreadRequestResolution
  resolvedAt?: number
  questions?: ThreadRequestQuestion[]
  availableDecisions?: ('accept' | 'acceptForSession' | 'decline' | 'cancel')[]
  requestedPermissions?: { fileSystem?: unknown; network?: unknown }
  schema?: Record<string, unknown>
  url?: string
}
export interface ThreadRequestResponse {
  decision?: 'accept' | 'acceptForSession' | 'decline' | 'cancel'
  answers?: Record<string, string[]>
  content?: Record<string, unknown>
  permissions?: { fileSystem?: unknown; network?: unknown }
  scope?: 'turn' | 'session'
}

export interface ThreadQueuedInput {
  id: string
  operationId?: string
  nativeId?: string
  text: string
  attachmentIds?: string[]
  attachments?: Omit<ThreadAttachment, 'path'>[]
  configuration?: ThreadConfiguration
  createdAt: number
  state: 'queued' | 'sending' | 'failed' | 'unknown'
  error?: string
}

export interface ThreadContextCategory { name: string; tokens: number; kind: 'used' | 'deferred' | 'buffer' | 'free' }
/** What fills the model's context window right now, as reported by the provider. */
/** Accumulated provider-reported cost of a conversation; an estimate, never a bill. */
export interface ThreadCostReport {
  totalUsd: number
  turns: number
  lastTurnUsd?: number
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  updatedAt: number
  source: 'claude-result'
}

export interface ThreadContextReport {
  model?: string
  usedTokens: number
  windowTokens: number
  percentage: number
  autoCompactAtTokens?: number
  categories: ThreadContextCategory[]
  capturedAt: number
  source: 'claude-control' | 'codex-token-usage'
}

export interface ThreadRewindResult {
  snapshot: ThreadSnapshot
  removedTurns: number
  /** Files restored from the dropped turns' checkpoints, when requested. */
  restoredFiles?: number
  /** Why files were not restored; the conversation itself was rewound. */
  fileError?: string
}

export interface ThreadQueuePause {
  reason: 'interrupted' | 'failed'
  since: number
  turnId?: string
}

/** A tool's evidence, distinct from the current working tree. Patches are loaded separately. */
export interface ThreadFileChange {
  path: string
  previousPath?: string
  kind: 'add' | 'update' | 'delete' | 'rename'
  source: 'native-patch' | 'tool-input' | 'working-tree-observation'
  /** Only native provider patches prove provider authorship. */
  authorship?: 'provider' | 'indeterminate'
  state: 'running' | 'completed' | 'failed' | 'unknown'
  additions?: number
  deletions?: number
  artifactId?: string
  truncated?: boolean
  /** Adapter-to-main only; removed before saving or exposing the snapshot. */
  patch?: string
}
export interface ThreadArtifact { id: string; content: string; hash: string; bytes: number; truncated: boolean; source: ThreadFileChange['source'] }
export interface ThreadSubagent {
  threadId: string
  status: 'pending' | 'running' | 'interrupted' | 'completed' | 'failed' | 'closed' | 'not-found' | 'unknown'
  message?: string
}
export interface ThreadTurn { id: string; operationId?: string; nativeId?: string; sequence: number; startedAt?: number; completedAt?: number; status: 'running' | 'completed' | 'failed' | 'interrupted'; configuration: ThreadConfiguration; attachmentIds?: string[] }

export interface ConversationThread {
  nativeHistoryCursor?: { before: number; size: number; identity: string; skipSuffix?: boolean; fingerprint?: string; modifiedAt?: number; claudeLineage?: 'linked' | 'legacy'; claudeParent?: string }
  agentProfileId?: string
  id: string
  workspaceId: string
  projectId: string
  rootPath: string
  provider: ThreadProvider
  nativeSessionId: string | null
  title: string
  pinned: boolean
  status: ThreadStatus
  /** Last finished turn, used to distinguish a new idle thread from completed work in navigation. */
  lastTurnStatus?: ThreadTurn['status']
  createdAt: number
  updatedAt: number
  /** A native interactive CLI exclusively owns this conversation until it exits. */
  cliActive?: boolean
  cliNotice?: string
  model?: string
  reasoningEffort?: string
  access?: ThreadConfiguration['access']
  networkAccess?: boolean
  approvalPolicy?: ThreadConfiguration['approvalPolicy']
  mode?: 'default' | 'plan'
  hooksEnabled?: boolean
  configurationRevision?: number
  pendingConfiguration?: ThreadConfiguration
  archived?: boolean
  generation?: number
  queue?: ThreadQueuedInput[]
  /** Set when a turn ended without completing while input was queued; the next item waits for the user. */
  queuePause?: ThreadQueuePause
  /** Latest context-window report; never part of the timeline. */
  contextReport?: ThreadContextReport
  /** Running cost estimate; never part of the timeline. */
  costReport?: ThreadCostReport
  capabilities?: ThreadCapabilityManifest
  connection?: ThreadConnectionStatus
  providerObservation?: ThreadProviderObservation
}

export interface ThreadProviderObservation {
  state: 'running' | 'awaiting-input' | 'completed' | 'interrupted' | 'failed' | 'idle' | 'unknown'
  observedAt: number
  source: 'codex-app-server' | 'unavailable'
  nativeTurnId?: string
  detail: string
}

export type ThreadEvent =
  | { type: 'continuation-started'; id: string; at: number }
  | { type: 'session'; nativeSessionId: string }
  /** Transport liveness only; the orchestrator updates metadata without saving a timeline row. */
  | { type: 'native-signal'; at: number }
  /** Metadata only: stored on the thread, never added to the timeline. */
  | { type: 'context-usage'; report: ThreadContextReport }
  /** Metadata only: one turn's reported cost, folded into the thread's running total. */
  | { type: 'turn-cost'; usd?: number; inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheCreationTokens?: number }
  | { type: 'connection-closed'; at: number }
  | { type: 'turn-accepted'; nativeTurnId: string; at: number }
  | { type: 'activity'; id: string; phase: 'preparing' | 'connecting' | 'reasoning' | 'responding'; at: number; summary?: string }
  | { type: 'message'; id: string; role: 'user' | 'assistant'; text: string; historicalQuestions?: { title: string; options: string[] | null }[]; attachments?: Omit<ThreadAttachment, 'path'>[]; context?: { path: string; bytes: number; truncated?: boolean }[] }
  | { type: 'delta'; id: string; text: string }
  | { type: 'tool'; id: string; name: string; state: 'running' | 'completed' | 'failed' | 'unknown'; detail: string; output?: string; exitCode?: number; startedAt?: number; completedAt?: number; turnId?: string; files?: ThreadFileChange[] }
  | { type: 'subagent'; id: string; action: string; state: 'running' | 'completed' | 'failed' | 'interrupted' | 'unknown'; senderThreadId?: string; receiverThreadIds: string[]; agents: ThreadSubagent[]; prompt?: string; model?: string; reasoningEffort?: string; startedAt?: number; completedAt?: number; turnId?: string }
  | { type: 'approval'; id: string; title: string; detail: string }
  | { type: 'approval-resolved'; id: string }
  | { type: 'request'; id: string; request: ThreadRequest }
  | { type: 'request-resolved'; id: string; state: ThreadRequest['state']; resolution?: ThreadRequestResolution; resolvedAt?: number }
  | { type: 'queue'; id: string; item: ThreadQueuedInput }
  | { type: 'model-picker'; id: string; models: ThreadModel[]; selectedModel?: string; selectedEffort?: string }
  | { type: 'configuration'; model?: string; reasoningEffort?: string; access?: ThreadConfiguration['access']; networkAccess?: boolean; approvalPolicy?: ThreadConfiguration['approvalPolicy']; hooksEnabled?: boolean; confirmed?: boolean }
  | { type: 'turn-diff'; id: string; turnId: string; files: ThreadFileChange[] }
  | { type: 'plan'; id: string; turnId?: string; explanation?: string; steps: { label: string; status: 'pending' | 'inProgress' | 'completed' }[] }
  | { type: 'cli-command'; id: string; command: string }
  | { type: 'completed'; status: 'completed' | 'interrupted' | 'failed'; error?: string; errorCode?: ThreadFailure['code']; failure?: ThreadFailure }
  | { type: 'failure-details'; id: string; usage?: ThreadUsage; usageUnavailable?: boolean }

export interface ConversationCapabilities {
  resume: boolean
  approvals: boolean
  attachments: boolean
  modelSelection: boolean
  questions?: boolean
  permissions?: boolean
  elicitation?: boolean
  queue?: boolean
  steering?: boolean
  nativeSessions?: boolean
  /** The adapter can rewind provider history and prove the result. */
  rewind?: boolean
  /** The adapter can stop one background task of the provider session. */
  stopTasks?: boolean
}

export interface ConversationProtocolEvidence {
  transport: string
  protocolVersion?: string
  providerVersion?: string
  verified: 'fixture' | 'native' | 'pilot'
}

export interface AgentConversationAdapter {
  readonly capabilities: ConversationCapabilities
  readonly evidence: ConversationProtocolEvidence
  readonly closed?: boolean
  start(context: { rootPath: string; nativeSessionId: string | null } & ThreadConfiguration, emit: (event: ThreadEvent) => void): Promise<void>
  configure?(configuration: ThreadConfiguration): Promise<void>
  command?(name: string, argument: string): Promise<ThreadCommandResult>
  observe?(nativeTurnId?: string): Promise<ThreadProviderObservation>
  /** Synchronously persist a confirmed recovery before releasing local ownership. */
  commitRecoveredTurn?(nativeTurnId: string, state: 'completed' | 'failed', commit: () => void): boolean
  send(text: string, skill?: ThreadAgentInput['skill'], attachments?: ThreadAttachment[]): Promise<void>
  steer?(text: string, attachments?: ThreadAttachment[]): Promise<void>
  enqueue?(item: ThreadQueuedInput, attachments?: ThreadAttachment[]): Promise<string | undefined>
  startQueued?(nativeId?: string): Promise<void>
  updateQueued?(nativeId: string, item: ThreadQueuedInput, attachments?: ThreadAttachment[]): Promise<void>
  deleteQueued?(nativeId: string): Promise<void>
  reorderQueued?(nativeIds: string[]): Promise<void>
  /** Remove the target turn and every later one from the provider's own history, then prove it. */
  rewind?(beforeNativeTurnId: string): Promise<void>
  /** Ask the provider what fills the context window. Resolves null when unavailable. */
  contextUsage?(): Promise<ThreadContextReport | null>
  /** Stops one provider background task (a shell or agent the session started). */
  stopTask?(taskId: string): Promise<void>
  interrupt(): Promise<void>
  approve(requestId: string, decision: 'accept' | 'decline'): Promise<void>
  respondRequest?(requestId: string, response: ThreadRequestResponse): Promise<void>
  dispose(): Promise<void>
}

export interface ThreadSnapshot {
  thread: ConversationThread
  events: ThreadEvent[]
  /** Actionable requests remain available independently of paginated history. */
  pendingRequests?: ThreadRequest[]
  turns?: ThreadTurn[]
  /** Delivery state by user-message id (turn or queued item id). Absent for imported history. */
  deliveries?: Record<string, ThreadDelivery>
  page?: { before?: number; hasMore: boolean; total: number; /** Persisted live events; the window's tail maps to seq live-n..live-1. */ live?: number }
  /** Cursor for readSince. The epoch changes when history is truncated or re-based. */
  sync?: ThreadSyncCursor
}

export interface ThreadSyncCursor { epoch: string; revision: number }

export type ThreadDelta =
  | { ok: true; epoch: string; revision: number; live: number; thread: ConversationThread; events: { seq: number; event: ThreadEvent }[]; turns: ThreadTurn[]; deliveries: Record<string, ThreadDelivery>; pendingRequests: ThreadRequest[] }
  | { ok: false; reset: 'epoch' | 'unknown' | 'limit' }

export interface ThreadHistoryPage { events: ThreadEvent[]; before?: number; hasMore: boolean; total: number }

export interface ThreadProjectSummary {
  projectId: string
  displayName: string
  identityLabel: string
  hidden: boolean
  contexts: { rootPath: string; label: string }[]
}

export interface ThreadProjectCatalog {
  projects: ThreadProjectSummary[]
  unavailable: string[]
}

export interface ThreadApi {
  artifact?(id: string, artifactId: string): Promise<ThreadArtifact>
  exportPortable?(id: string): Promise<string | null>
  importPortable?(id: string): Promise<ThreadSnapshot | null>
  projectDiff?(id: string): Promise<import('./git').GitDiff>
  models?(id: string, refresh?: boolean): Promise<ThreadModelCatalog>
  configure?(id: string, configuration: ThreadConfiguration, revision: number): Promise<ThreadSnapshot>
  command?(id: string, text: string): Promise<ThreadCommandResult>
  recover?(id: string): Promise<void>
  observe?(id: string): Promise<ThreadProviderObservation>
  commands(id: string, forceRefresh?: boolean): Promise<ThreadCommandCatalog>
  projects(): Promise<ThreadProjectCatalog>
  addProject(rootPath: string): Promise<ThreadProjectSummary>
  relinkProject(projectId: string, rootPath: string): Promise<ThreadProjectSummary>
  setProjectHidden(projectId: string, hidden: boolean): Promise<void>
  list(): Promise<ConversationThread[]>
  create(input: { projectId: string; rootPath?: string; provider: ThreadProvider }): Promise<ThreadSnapshot>
  read(id: string): Promise<ThreadSnapshot>
  history?(id: string, before?: number, limit?: number): Promise<ThreadHistoryPage>
  attach?(id: string, input: { name: string; mimeType: ThreadAttachment['mimeType']; data: ArrayBuffer }): Promise<ThreadAttachment>
  removeAttachment?(id: string, attachmentId: string): Promise<void>
  send(id: string, text: string, attachmentIds?: string[]): Promise<void>
  steer?(id: string, text: string, attachmentIds?: string[]): Promise<void>
  updateQueued?(id: string, itemId: string, text: string): Promise<void>
  deleteQueued?(id: string, itemId: string, preserveAttachments?: boolean): Promise<void>
  reorderQueued?(id: string, itemIds: string[]): Promise<void>
  contextUsage?(id: string): Promise<ThreadContextReport | null>
  stopTask?(id: string, taskId: string): Promise<void>
  turnFiles?(id: string, turnId: string): Promise<ThreadTurnFileStatus[]>
  undoTurnFile?(id: string, turnId: string, path: string): Promise<void>
  rewind?(id: string, turnId: string, options?: { restoreFiles?: boolean }): Promise<ThreadRewindResult>
  readSince?(id: string, cursor: ThreadSyncCursor): Promise<ThreadDelta>
  resumeQueue?(id: string): Promise<void>
  sendQueuedNow?(id: string, itemId: string): Promise<void>
  interrupt(id: string): Promise<void>
  approve(id: string, requestId: string, decision: 'accept' | 'decline'): Promise<void>
  respond?(id: string, requestId: string, response: ThreadRequestResponse): Promise<void>
  pin(id: string, pinned: boolean): Promise<void>
  onChanged(listener: (value: { threadId: string }) => void): () => void
}

/** One file changed by a turn, against the working tree now. */
export interface ThreadTurnFileStatus { path: string; state: 'pending' | 'reverted' | 'modified'; preExists: boolean; postExists: boolean }

export interface ThreadCliState {
  running: boolean
  nativeSessionId: string | null
  pendingCommand?: string
}
