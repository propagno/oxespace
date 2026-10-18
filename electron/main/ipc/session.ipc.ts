import { app, ipcMain } from 'electron'
import { join } from 'node:path'
import type { SessionSearchInput } from '../../../shared/types/session-search'
import { SessionSearchIndex, SessionSearchService } from '../services/session-search'
import type { AppDatabase } from '../db/index'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { AgentProvider } from '../../../shared/types/agent'
import { SessionService } from '../services/session.service'

const VALID_PROVIDERS: AgentProvider[] = ['claude', 'codex', 'antigravity', 'copilot', 'gh-copilot', 'cursor', 'grok', 'custom']

export function registerSessionIpc(db: AppDatabase, service = new SessionService(db)): SessionService {
  ipcMain.handle(IPC_CHANNELS.session.list, (_event, input: unknown) => {
    const { workspaceId, workspaceRootPath, provider } = readListInput(input)
    return service.listSessions(workspaceId, workspaceRootPath, provider)
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
  // that costs a file handle and a first scan.
  let search: SessionSearchService | null = null
  ipcMain.handle(IPC_CHANNELS.session.search, (_event, input: unknown) => {
    search ??= new SessionSearchService(new SessionSearchIndex(join(app.getPath('userData'), 'session-search.sqlite3')))
    return search.search(readSearchInput(input))
  })

  ipcMain.handle(IPC_CHANNELS.session.cleanup, (_event, input: unknown) => {
    const { workspaceId, workspaceRootPath, provider } = readListInput(input)
    return service.cleanupUnusedSessions(workspaceId, workspaceRootPath, provider)
  })

  return service
}

function readListInput(value: unknown): { workspaceId: string; workspaceRootPath: string; provider: AgentProvider } {
  if (!value || typeof value !== 'object') throw new Error('Invalid input')
  const { workspaceId, workspaceRootPath, provider } = value as {
    workspaceId?: unknown; workspaceRootPath?: unknown; provider?: unknown
  }
  if (typeof workspaceId !== 'string' || !workspaceId) throw new Error('workspaceId is required')
  if (typeof workspaceRootPath !== 'string' || !workspaceRootPath) throw new Error('workspaceRootPath is required')
  if (typeof provider !== 'string' || !VALID_PROVIDERS.includes(provider as AgentProvider)) throw new Error('invalid provider')
  return { workspaceId, workspaceRootPath, provider: provider as AgentProvider }
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
