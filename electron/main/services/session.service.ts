import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AppDatabase } from '../db/index'
import type { AgentProvider } from '../../../shared/types/agent'
import type { ForkSessionInput, ForkSessionResult, SessionSummary } from '../../../shared/types/session'
import { UsageService } from './usage.service'
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
    private readonly claudeProjectsRoot: string = join(homedir(), '.claude', 'projects')
  ) {}

  /** Returns enriched session summaries for the workspace, joined with fork metadata. */
  listSessions(workspaceId: string, workspaceRootPath: string, provider: AgentProvider): SessionSummary[] {
    const sessions = this.usage.listSessionsFor(provider, workspaceRootPath)
    if (sessions.length === 0) return []

    const forks = this.db
      .prepare('SELECT * FROM session_forks WHERE workspace_id = ?')
      .all(workspaceId) as ForkRow[]
    const forksBySessionId = new Map<string, ForkRow>()
    for (const row of forks) forksBySessionId.set(row.fork_session_id, row)

    return sessions.map((session) => {
      const fork = forksBySessionId.get(session.sessionId)
      const snapshot = this.usage.getSnapshotFor(provider, workspaceRootPath, session.sessionId)
      const filePath = provider === 'claude'
        ? join(this.claudeProjectsRoot, encodeClaudePath(workspaceRootPath), `${session.sessionId}.jsonl`)
        : null
      const firstMessagePreview = filePath ? readFirstMessagePreview(filePath) : session.summary ?? null

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
        firstMessagePreview,
        workspaceRootPath: session.workspaceRootPath ?? null
      }
    })
  }

  /**
   * Forks a Claude session by copying the first `messageCount` lines of the parent
   * JSONL into a new file with a fresh UUID. The new session can then be opened via
   * `claude --resume <newSessionId>`. Records the fork in the `session_forks` table.
   */
  forkSession(input: ForkSessionInput): ForkSessionResult {
    if (input.provider !== 'claude') {
      throw new Error(`Fork ainda não é suportado para provider "${input.provider}". Apenas Claude por enquanto.`)
    }

    assertSessionId(input.parentSessionId, 'parentSessionId')

    const projectDir = join(this.claudeProjectsRoot, encodeClaudePath(input.workspaceRootPath))
    // safeJoin pins both filenames inside projectDir even if the UUID check is bypassed.
    const parentPath = safeJoin(projectDir, `${input.parentSessionId}.jsonl`)
    if (!existsSync(parentPath)) {
      throw new Error(`Sessão parente não encontrada em ${parentPath}`)
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
      join(this.claudeProjectsRoot, encodeClaudePath(workspaceRootPath)),
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
  cleanupUnusedSessions(workspaceId: string, workspaceRootPath: string, provider: AgentProvider): number {
    if (provider !== 'claude') return 0
    let cleaned = 0
    const projectDir = join(this.claudeProjectsRoot, encodeClaudePath(workspaceRootPath))
    if (!existsSync(projectDir)) return 0

    const sessions = this.usage.listSessionsFor(provider, workspaceRootPath)
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

function encodeClaudePath(rootPath: string): string {
  return rootPath.replace(/[:\\/]/g, '-')
}

const PREVIEW_MAX = 80

/**
 * Returns a short preview of the first user message in a Claude JSONL transcript.
 * Reads up to the first ~64KB of the file (enough to skip system entries and
 * locate the first user turn) without slurping the whole transcript into memory.
 * Returns null when the file is missing, malformed, or has no user message.
 */
function readFirstMessagePreview(filePath: string): string | null {
  try {
    if (!existsSync(filePath)) return null
    // Read up to 64KB — Claude transcripts often start with a large system entry,
    // so we need more than just the first line to land on the first user message.
    const buf = readFileSync(filePath, { encoding: 'utf8', flag: 'r' }).slice(0, 65536)
    for (const line of buf.split('\n')) {
      if (!line.trim()) continue
      let entry: { type?: string; role?: string; message?: { role?: string; content?: unknown } }
      try { entry = JSON.parse(line) } catch { continue }
      const role = entry.role ?? entry.message?.role
      if (entry.type === 'system' || role === 'system') continue
      if (role !== 'user') continue
      const content = entry.message?.content
      const text = extractTextContent(content)
      if (!text) continue
      return text.length > PREVIEW_MAX ? `${text.slice(0, PREVIEW_MAX - 1)}…` : text
    }
    return null
  } catch {
    return null
  }
}

function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) {
    for (const item of content) {
      if (typeof item === 'string') return item.trim()
      if (item && typeof item === 'object') {
        const text = (item as { text?: unknown; type?: unknown }).text
        if (typeof text === 'string') return text.trim()
      }
    }
  }
  return ''
}
