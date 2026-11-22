import { app, ipcMain } from 'electron'
import { join } from 'node:path'
import type { SessionSearchInput } from '../../../shared/types/session-search'
import type { SessionSearchService } from '../services/session-search'
import type { AppDatabase } from '../db/index'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { AgentProvider } from '../../../shared/types/agent'
import type { SessionListPartialEvent, SessionSummary } from '../../../shared/types/session'
import { SessionService } from '../services/session.service'

const VALID_PROVIDERS: AgentProvider[] = ['claude', 'codex', 'antigravity', 'copilot', 'gh-copilot', 'cursor', 'grok', 'custom']
export const SESSION_PARTIAL_INTERVAL_MS = 50
export const SESSION_PARTIAL_BATCH_SIZE = 10

export function registerSessionIpc(db: AppDatabase, service = new SessionService(db)): SessionService {
  ipcMain.handle(IPC_CHANNELS.session.list, async (event, input: unknown) => {
    const { workspaceId, workspaceRootPath, provider, requestId } = readListInput(input)
    if (!requestId) return service.listSessions(workspaceId, workspaceRootPath, provider)

    const sender = event.sender
    const throttle = createPartialThrottle(sessions => {
      if (sender.isDestroyed()) return
      const payload: SessionListPartialEvent = { requestId, workspaceId, workspaceRootPath, provider, sessions }
      sender.send(IPC_CHANNELS.session.onPartial, payload)
    })
    try {
      return await service.listSessions(workspaceId, workspaceRootPath, provider, sessions => {
        if (sender.isDestroyed()) { throttle.cancel(); return }
        throttle.push(sessions)
      })
    } finally {
      throttle.cancel()
    }
  })

  ipcMain.handle(IPC_CHANNELS.session.fork, (_event, input: unknown) => {
    if (!input || typeof input !== 'object') throw new Error('Invalid fork input')
    const { workspaceId, workspaceRootPath, provider, parentSessionId, messageCount, label } = input as {
      workspaceId?: unknown; workspaceRootPath?: unknown; provider?: unknown
      parentSessionId?: unknown; messageCount?: unknown; label?: unknown
    }
    if (typeof workspaceId !== 'string' || !workspaceId) throw new Error('workspaceId is required')
    if (typeof workspaceRootPath !== 'string' || !workspaceRootPath) throw new Error('workspaceRootPath is required')
    if (typeof provider !== 'string' || !VALID_PROVIDERS.includes(provider as AgentProvider)) throw new Error('invalid provider')
    if (typeof parentSessionId !== 'string' || !parentSessionId) throw new Error('parentSessionId is required')
    if (typeof messageCount !== 'number' || !Number.isFinite(messageCount)) throw new Error('messageCount must be a number')
    return service.forkSession({
      workspaceId,
      workspaceRootPath,
      provider: provider as AgentProvider,
      parentSessionId,
      messageCount: Math.floor(messageCount),
      label: typeof label === 'string' && label.trim() ? label.trim() : undefined
    })
  })

  ipcMain.handle(IPC_CHANNELS.session.delete, (_event, input: unknown) => {
    if (!input || typeof input !== 'object') throw new Error('Invalid delete input')
    const { workspaceRootPath, sessionId, provider } = input as {
      workspaceRootPath?: unknown; sessionId?: unknown; provider?: unknown
    }
    if (typeof workspaceRootPath !== 'string' || !workspaceRootPath) throw new Error('workspaceRootPath is required')
    if (typeof sessionId !== 'string' || !sessionId) throw new Error('sessionId is required')
    if (typeof provider !== 'string' || !VALID_PROVIDERS.includes(provider as AgentProvider)) throw new Error('invalid provider')
    return service.deleteSession(workspaceRootPath, sessionId, provider as AgentProvider)
  })

  // Opened on first use: most sessions never search, and the index is a cache
  // that costs a file handle and a first scan. Its code loads then too, so the
  // transcript parser and the match ladder stay out of the main entry.
  let search: Promise<SessionSearchService> | null = null
  ipcMain.handle(IPC_CHANNELS.session.search, async (_event, input: unknown) => {
    const query = readSearchInput(input)
    search ??= import('../services/session-search')
      .then(({ SessionSearchIndex, SessionSearchService }) => new SessionSearchService(new SessionSearchIndex(join(app.getPath('userData'), 'session-search.sqlite3'))))
      .catch(error => { search = null; throw error })
    return (await search).search(query)
  })

  ipcMain.handle(IPC_CHANNELS.session.cleanup, (_event, input: unknown) => {
    const { workspaceId, workspaceRootPath, provider } = readListInput(input)
    return service.cleanupUnusedSessions(workspaceId, workspaceRootPath, provider)
  })

  return service
}

function readListInput(value: unknown): { workspaceId: string; workspaceRootPath: string; provider: AgentProvider; requestId?: string } {
  if (!value || typeof value !== 'object') throw new Error('Invalid input')
  const { workspaceId, workspaceRootPath, provider, requestId } = value as {
    workspaceId?: unknown; workspaceRootPath?: unknown; provider?: unknown; requestId?: unknown
  }
  if (typeof workspaceId !== 'string' || !workspaceId) throw new Error('workspaceId is required')
  if (typeof workspaceRootPath !== 'string' || !workspaceRootPath) throw new Error('workspaceRootPath is required')
  if (typeof provider !== 'string' || !VALID_PROVIDERS.includes(provider as AgentProvider)) throw new Error('invalid provider')
  const normalizedRequestId = typeof requestId === 'string' && requestId.trim() ? requestId.trim().slice(0, 128) : undefined
  return { workspaceId, workspaceRootPath, provider: provider as AgentProvider, requestId: normalizedRequestId }
}

export function createPartialThrottle(
  emit: (sessions: SessionSummary[]) => void,
  options: { intervalMs?: number; batchSize?: number; now?: () => number } = {}
): { push: (sessions: SessionSummary[]) => void; cancel: () => void } {
  const intervalMs = options.intervalMs ?? SESSION_PARTIAL_INTERVAL_MS
  const batchSize = options.batchSize ?? SESSION_PARTIAL_BATCH_SIZE
  const now = options.now ?? Date.now
  let lastSentAt = 0
  let lastSentCount = 0
  let pending: SessionSummary[] | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let cancelled = false

  const flush = (sessions: SessionSummary[]): void => {
    if (cancelled) return
    if (timer) { clearTimeout(timer); timer = null }
    pending = null
    lastSentAt = now()
    lastSentCount = sessions.length
    emit(sessions)
  }

  return {
    push(sessions: SessionSummary[]): void {
      if (cancelled) return
      const elapsed = now() - lastSentAt
      if (lastSentCount === 0 || sessions.length - lastSentCount >= batchSize || elapsed >= intervalMs) {
        flush(sessions)
        return
      }
      pending = sessions
      if (!timer) {
        timer = setTimeout(() => {
          timer = null
          if (!cancelled && pending) flush(pending)
        }, Math.max(1, intervalMs - elapsed))
      }
    },
    cancel(): void {
      cancelled = true
      pending = null
      if (timer) { clearTimeout(timer); timer = null }
    }
  }
}

function readSearchInput(value: unknown): SessionSearchInput {
  if (!value || typeof value !== 'object') throw new Error('Invalid search input')
  const { query, cwd, agent, limit } = value as { query?: unknown; cwd?: unknown; agent?: unknown; limit?: unknown }
  if (typeof query !== 'string') throw new Error('query is required')
  if (agent !== undefined && agent !== 'claude' && agent !== 'codex') throw new Error('agent must be "claude" or "codex"')
  return {
    query: query.slice(0, 500),
    cwd: typeof cwd === 'string' && cwd ? cwd : undefined,
    agent: agent as SessionSearchInput['agent'],
    limit: typeof limit === 'number' && Number.isFinite(limit) ? Math.floor(limit) : undefined
  }
}
