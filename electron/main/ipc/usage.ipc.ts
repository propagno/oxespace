import { ipcMain } from 'electron'
import { UsageService } from '../services/usage.service'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { AgentProvider } from '../../../shared/types/agent'

const VALID_PROVIDERS: AgentProvider[] = ['claude', 'copilot', 'gh-copilot', 'codex', 'gemini', 'cursor', 'custom']

export function registerUsageIpc(service = new UsageService()): UsageService {
  ipcMain.handle(IPC_CHANNELS.usage.getContextUsage, (_event, input: unknown) => {
    const workspaceRootPath = readWorkspaceRootPath(input)
    return service.getContextUsage({ workspaceRootPath })
  })

  ipcMain.handle(IPC_CHANNELS.usage.getSnapshotFor, (_event, input: unknown) => {
    const { provider, workspaceRootPath, sessionId } = readSnapshotInput(input)
    return service.getSnapshotFor(provider, workspaceRootPath, sessionId)
  })

  ipcMain.handle(IPC_CHANNELS.usage.listSessions, (_event, input: unknown) => {
    const { provider, workspaceRootPath } = readSnapshotInput(input)
    return service.listSessionsFor(provider, workspaceRootPath)
  })

  ipcMain.handle(IPC_CHANNELS.usage.supportedProviders, () => service.supportedProviders())

  return service
}

function readWorkspaceRootPath(input: unknown): string {
  if (!input || typeof input !== 'object') throw new Error('Invalid usage input')
  const { workspaceRootPath } = input as { workspaceRootPath?: unknown }
  if (typeof workspaceRootPath !== 'string' || !workspaceRootPath) {
    throw new Error('workspaceRootPath is required')
  }
  return workspaceRootPath
}

function readSnapshotInput(input: unknown): { provider: AgentProvider; workspaceRootPath: string; sessionId: string | null } {
  if (!input || typeof input !== 'object') throw new Error('Invalid usage input')
  const { provider, workspaceRootPath, sessionId } = input as { provider?: unknown; workspaceRootPath?: unknown; sessionId?: unknown }
  if (typeof provider !== 'string' || !VALID_PROVIDERS.includes(provider as AgentProvider)) {
    throw new Error('invalid provider')
  }
  if (typeof workspaceRootPath !== 'string' || !workspaceRootPath) {
    throw new Error('workspaceRootPath is required')
  }
  return {
    provider: provider as AgentProvider,
    workspaceRootPath,
    sessionId: typeof sessionId === 'string' ? sessionId : null
  }
}
