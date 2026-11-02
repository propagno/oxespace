import { ipcMain } from 'electron'
import { registerMcpToolRulesIpc } from './mcp-tool-rules.ipc'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { PolicyView } from '../../../shared/policy'
import type { AppDatabase } from '../db'
import type { FileSystemService } from '../services/file-system.service'
import type { ToolRulesDeps } from '../services/mcp-tool-rules'

/**
 * Settings › Policy: the policy files in force, and (B7.4) the answers to a change made outside OXESpace. Accept and
 * "Review again" are the person's, from the app's window only: never an MCP tool (`policy.accept_change` is forbidden)
 * or a phone command (`policy.edit`). Also Settings › Tools per tool (B7.3), which writes the project layer.
 *
 * The accepted-version gate and the answers (policy-runtime.ts) load here, awaited before any window or agent starts,
 * so the gate is in place as before and the main entry carries only these handlers. If they cannot load, this
 * rejects and the app does not go on without the gate.
 */
export async function registerPolicyIpc(rootOf: (workspaceId: string) => string | undefined, deps?: {
  db: AppDatabase
  files: FileSystemService
  servers?: ToolRulesDeps['servers']
  executions?: { liveWithin(root: string): number }
}): Promise<void> {
  if (deps) registerMcpToolRulesIpc(deps.db, deps.files, deps.servers)
  const { createPolicyRuntime } = await import('./policy-runtime')
  const policy = createPolicyRuntime(rootOf, deps)
  ipcMain.handle(IPC_CHANNELS.policy.get, (_event, workspaceId: unknown): PolicyView => policy.get(workspaceId))
  ipcMain.handle(IPC_CHANNELS.policy.acceptChange, (_event, value: unknown): PolicyView => policy.accept(value))
  ipcMain.handle(IPC_CHANNELS.policy.reviewChange, (_event, value: unknown): PolicyView => policy.review(value))
}
