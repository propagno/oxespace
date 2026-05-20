import { ipcMain } from 'electron'
import type { AppDatabase } from '../db/index'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { AgentProvider } from '../../../shared/types/agent'
import { SessionService } from '../services/session.service'

const VALID_PROVIDERS: AgentProvider[] = ['claude', 'codex', 'gemini', 'copilot', 'gh-copilot', 'cursor', 'custom']

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
