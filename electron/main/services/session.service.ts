import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AppDatabase } from '../db/index'
import type { AgentProvider } from '../../../shared/types/agent'
import type { ForkSessionInput, ForkSessionResult, SessionSummary } from '../../../shared/types/session'
import { UsageService } from './usage.service'
import type { SessionMetadata } from './usage/types'
import { defaultClaudeProjectsRoot, encodeClaudeProjectPath } from './usage/claude-project-path'
import { safeJoin } from '../utils/safe-join'

// Session IDs from Claude/Codex are RFC 4122 UUIDs. We refuse anything else so
// that a caller cannot craft a value like "../../foo" and read or overwrite an
// arbitrary .jsonl file under the user's home directory.
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function assertSessionId(value: string, label: string): void {
  if (!SESSION_ID_PATTERN.test(value)) {
    throw new Error(`${label} must be a valid session UUID`)
  }
}

interface ForkRow {
  id: string
  workspace_id: string
  parent_session_id: string
  fork_session_id: string
  fork_point_message_index: number
  label: string | null
  created_at: number
}

/**
 * Cross-provider session management — listing, forking, and metadata for resume.
 * Fork creation is currently Claude-only (the only provider that exposes a copyable
 * per-session JSONL transcript). Codex sessions can be listed and resumed via the CLI
 * directly but not forked at a specific message index since their file layout per-day
 * makes that lossy. Antigravity/Cursor are listed-only (provider stubs).
 */
export class SessionService {
  constructor(
    private readonly db: AppDatabase,
    private readonly usage: UsageService = new UsageService(),
    private readonly claudeProjectsRoot: string = defaultClaudeProjectsRoot()
  ) {}

  /**
   * Returns enriched session summaries for the workspace, joined with fork metadata. Claude transcripts are read
   * asynchronously, never in one blocking pass on the main process (OXE-157); `onPartial` gets the summaries read so far.
   */
  async listSessions(workspaceId: string, workspaceRootPath: string, provider: AgentProvider, onPartial?: (sessions: SessionSummary[]) => void): Promise<SessionSummary[]> {
    let forksBySessionId: Map<string, ForkRow> | null = null
    const summarize = (sessions: SessionMetadata[]): SessionSummary[] => {
      forksBySessionId ??= this.forksOf(workspaceId)
      return sessions.map(session => this.summary(session, forksBySessionId!, workspaceRootPath, provider))
    }
    const sessions = await this.usage.listSessionsForAsync(provider, workspaceRootPath, onPartial && (partial => onPartial(summarize(partial))))
    return sessions.length === 0 ? [] : summarize(sessions)
  }

  private forksOf(workspaceId: string): Map<string, ForkRow> {
    const forks = this.db
      .prepare('SELECT * FROM session_forks WHERE workspace_id = ?')
      .all(workspaceId) as ForkRow[]
    const forksBySessionId = new Map<string, ForkRow>()
    for (const row of forks) forksBySessionId.set(row.fork_session_id, row)
    return forksBySessionId
  }

  private summary(session: SessionMetadata, forksBySessionId: Map<string, ForkRow>, workspaceRootPath: string, provider: AgentProvider): SessionSummary {
    const fork = forksBySessionId.get(session.sessionId)
    const snapshot = session.snapshot ?? this.usage.getSnapshotFor(provider, workspaceRootPath, session.sessionId)
    const filePath = provider === 'claude'
      ? join(this.claudeProjectsRoot, encodeClaudeProjectPath(workspaceRootPath), `${session.sessionId}.jsonl`)
      : null
    return {
      sessionId: session.sessionId,
      provider,
      modelId: session.modelId,
      requestCount: session.requestCount,
      lastUpdatedMs: session.lastUpdatedMs,
      sessionStartedAtMs: session.sessionStartedAtMs,
      totalTokens: snapshot.inputTokens + snapshot.cacheCreationTokens + snapshot.cacheReadTokens + snapshot.outputTokens,
      estimatedCostUsd: snapshot.estimatedCostUsd,
      filePath,
      isFork: fork !== undefined,
      parentSessionId: fork?.parent_session_id ?? null,
      label: fork?.label ?? null,
      // Claude's async list reads the first message with the transcript.
      firstMessagePreview: session.firstMessagePreview ?? (filePath ? null : session.summary ?? null),
      workspaceRootPath: session.workspaceRootPath ?? null
    }
  }

  /**
   * Forks a Claude session by copying the first `messageCount` lines of the parent
   * JSONL into a new file with a fresh UUID. The new session can then be opened via
   * `claude --resume <newSessionId>`. Records the fork in the `session_forks` table.
   */
  forkSession(input: ForkSessionInput): ForkSessionResult {
    if (input.provider !== 'claude') {
      throw new Error(`Fork is not supported yet for provider "${input.provider}". Only Claude for now.`)
    }

    assertSessionId(input.parentSessionId, 'parentSessionId')

    const projectDir = join(this.claudeProjectsRoot, encodeClaudeProjectPath(input.workspaceRootPath))
    // safeJoin pins both filenames inside projectDir even if the UUID check is bypassed.
    const parentPath = safeJoin(projectDir, `${input.parentSessionId}.jsonl`)
    if (!existsSync(parentPath)) {
      throw new Error(`Parent session not found at ${parentPath}`)
    }

    const forkSessionId = randomUUID()
    const forkPath = safeJoin(projectDir, `${forkSessionId}.jsonl`)

    const messages = readFileSync(parentPath, 'utf8').split('\n').filter((l) => l.length > 0)
    const truncated = input.messageCount < 0
      ? messages
      : messages.slice(0, Math.min(messages.length, Math.max(1, input.messageCount)))
    writeFileSync(forkPath, truncated.join('\n') + '\n', 'utf8')

    this.db
      .prepare(
        `INSERT INTO session_forks (id, workspace_id, parent_session_id, fork_session_id, fork_point_message_index, label, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        randomUUID(),
        input.workspaceId,
        input.parentSessionId,
        forkSessionId,
        truncated.length,
        input.label ?? null,
        Date.now()
      )

    return { forkSessionId, filePath: forkPath }
  }

  /**
   * Clears any fork bookkeeping for the given session. The JSONL transcript itself
   * is intentionally kept on disk so the user can still `claude --resume` it later;
   * removing only the fork record severs the "this is a fork of X" link in our UI.
   * Returns true if a fork record was removed.
   */
  deleteSession(workspaceRootPath: string, sessionId: string, provider: AgentProvider): boolean {
    if (provider !== 'claude') return false
    assertSessionId(sessionId, 'sessionId')
    // Resolve the path through safeJoin so a malformed sessionId can't escape projectDir.
    // We don't act on the file today, but future code that reads it must be safe.
    safeJoin(
      join(this.claudeProjectsRoot, encodeClaudeProjectPath(workspaceRootPath)),
      `${sessionId}.jsonl`
    )
    const result = this.db
      .prepare('DELETE FROM session_forks WHERE fork_session_id = ? OR parent_session_id = ?')
      .run(sessionId, sessionId)
    return (result.changes ?? 0) > 0
  }

  /**
   * Cleans up (deletes) unused history files for a workspace. A session is considered
   * unused if it has 0 requests (e.g. agent was started but no message was sent).
   * Also cleans up any fork bookkeeping associated with the deleted sessions.
   * Returns the number of files deleted.
   */
  async cleanupUnusedSessions(workspaceId: string, workspaceRootPath: string, provider: AgentProvider): Promise<number> {
    if (provider !== 'claude') return 0
    let cleaned = 0
    const projectDir = join(this.claudeProjectsRoot, encodeClaudeProjectPath(workspaceRootPath))
    if (!existsSync(projectDir)) return 0

    const sessions = await this.usage.listSessionsForAsync(provider, workspaceRootPath)
    for (const session of sessions) {
      if (session.requestCount === 0) {
        const filePath = join(projectDir, `${session.sessionId}.jsonl`)
        if (existsSync(filePath)) {
          try {
            unlinkSync(filePath)
            // Remove any fork records pointing to or from this session
            this.db
              .prepare('DELETE FROM session_forks WHERE fork_session_id = ? OR parent_session_id = ?')
              .run(session.sessionId, session.sessionId)
            cleaned++
          } catch {
            // Ignore if we can't delete the file (e.g. permissions)
          }
        }
      }
    }
    return cleaned
  }
}
