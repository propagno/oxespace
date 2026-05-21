import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { createRequire } from 'node:module'
import type { Database as DatabaseHandle } from 'better-sqlite3'
import { EMPTY_CONTEXT_USAGE, type ContextUsageSnapshot } from '../../../../shared/types/usage'
import type { SessionMetadata, UsageProvider } from './types'

interface CopilotSessionRow {
  id: string
  cwd: string | null
  repository: string | null
  branch: string | null
  summary: string | null
  created_at: string | null
  updated_at: string | null
}

interface CopilotTurnCountRow {
  session_id: string
  count: number
}

const DEFAULT_CONTEXT_LIMIT = 256_000
const require = createRequire(import.meta.url)

/**
 * GitHub Copilot CLI stores local session metadata in `~/.copilot/session-store.db`.
 * The DB is the source used by `copilot --resume`, so reading it directly is more
 * reliable than trying to infer history from terminal output or logs.
 */
export class CopilotUsageProvider implements UsageProvider {
  readonly provider = 'copilot' as const

  constructor(private readonly storePath: string = join(homedir(), '.copilot', 'session-store.db')) {}

  getSnapshot(workspaceRootPath: string, sessionId?: string | null): ContextUsageSnapshot {
    const sessions = this.findSessionsFor(workspaceRootPath)
    if (sessions.length === 0) return EMPTY_CONTEXT_USAGE

    const target = sessionId
      ? sessions.find((session) => session.sessionId === sessionId) ?? sessions[0]
      : sessions[0]

    return {
      ...EMPTY_CONTEXT_USAGE,
      available: true,
      sessionId: target.sessionId,
      modelId: target.modelId,
      requestCount: target.requestCount,
      contextLimit: DEFAULT_CONTEXT_LIMIT,
      lastUpdatedMs: target.lastUpdatedMs,
      sessionStartedAtMs: target.sessionStartedAtMs
    }
  }

  listSessions(workspaceRootPath: string): SessionMetadata[] {
    return this.findSessionsFor(workspaceRootPath)
  }

  listSessionSummaries(workspaceRootPath: string): Map<string, string> {
    const summaries = new Map<string, string>()
    for (const row of this.readRows(workspaceRootPath).rows) {
      const summary = normalizeSummary(row.summary)
      if (summary) summaries.set(row.id, summary)
    }
    return summaries
  }

  private findSessionsFor(workspaceRootPath: string): SessionMetadata[] {
    const { rows, turnCounts } = this.readRows(workspaceRootPath)
    return rows.map((row) => {
      const createdAt = parseTimestamp(row.created_at)
      const updatedAt = parseTimestamp(row.updated_at) ?? createdAt ?? fallbackMtime(this.storePath)
      return {
        sessionId: row.id,
        lastUpdatedMs: updatedAt,
        sessionStartedAtMs: createdAt ?? updatedAt,
        modelId: 'GitHub Copilot',
        requestCount: turnCounts.get(row.id) ?? (row.summary ? 1 : 0),
        summary: normalizeSummary(row.summary),
        workspaceRootPath: row.cwd
      }
    })
  }

  private readRows(workspaceRootPath: string): { rows: CopilotSessionRow[]; turnCounts: Map<string, number> } {
    if (!existsSync(this.storePath)) return { rows: [], turnCounts: new Map() }

    let db: DatabaseHandle | null = null
    try {
      const Database = require('better-sqlite3') as typeof import('better-sqlite3')
      db = new Database(this.storePath, { readonly: true, fileMustExist: true })
      const tables = new Set(
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => String((row as { name: unknown }).name))
      )
      if (!tables.has('sessions')) return { rows: [], turnCounts: new Map() }

      const rows = db
        .prepare(
          `SELECT id, cwd, repository, branch, summary, created_at, updated_at
           FROM sessions
           ORDER BY datetime(updated_at) DESC`
        )
        .all() as CopilotSessionRow[]

      const turnCounts = new Map<string, number>()
      if (tables.has('turns')) {
        for (const row of db.prepare('SELECT session_id, COUNT(*) AS count FROM turns GROUP BY session_id').all() as CopilotTurnCountRow[]) {
          turnCounts.set(row.session_id, row.count)
        }
      }

      return {
        rows: rows.filter((row) => isWorkspacePath(row.cwd, workspaceRootPath)),
        turnCounts
      }
    } catch {
      return { rows: [], turnCounts: new Map() }
    } finally {
      db?.close()
    }
  }
}

export function isWorkspacePath(candidate: string | null, workspaceRootPath: string): boolean {
  if (!candidate) return false
  const normalizedCandidate = normalizePath(candidate)
  const normalizedRoot = normalizePath(workspaceRootPath)
  if (normalizedCandidate === normalizedRoot) return true

  const rel = relative(normalizedRoot, normalizedCandidate)
  if (!rel || rel.startsWith('..') || rel.includes(':')) return false
  return !rel.split(sep).some((part) => ['.git', 'node_modules'].includes(part.toLowerCase()))
}

function normalizePath(value: string): string {
  return value.replace(/[/\\]+/g, sep).replace(/[\\/]+$/, '').toLowerCase()
}

function parseTimestamp(value: string | null): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function fallbackMtime(path: string): number {
  try { return statSync(path).mtimeMs } catch { return Date.now() }
}

function normalizeSummary(value: string | null): string | null {
  const trimmed = value?.replace(/\s+/g, ' ').trim()
  return trimmed || null
}
