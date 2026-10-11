import { ipcMain } from 'electron'
import { join } from 'node:path'
import statusHookSource from '../../../resources/agent-hooks/oxespace-status-hook.cjs?raw'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { AgentHookAgent, AgentHooksStatus } from '../../../shared/types/agent-hooks'
import { AgentHookInstaller } from '../services/agent-hooks/installer'

const AGENTS: AgentHookAgent[] = ['claude-code', 'codex']

function expectAgent(value: unknown): AgentHookAgent {
  if (value === 'claude-code' || value === 'codex') return value
  throw new Error('agent must be "claude-code" or "codex"')
}

/**
 * Install/remove/status for the agents' status hooks. Installation is always an
 * explicit user action (Settings); nothing here runs at startup, because the
 * target files are user-global and shared with other tools.
 */
export function registerAgentHooksIpc(userDataPath: string, installer = new AgentHookInstaller({
  directory: join(userDataPath, 'agent-hooks'),
  scriptSource: statusHookSource
})): AgentHookInstaller {
  ipcMain.handle(IPC_CHANNELS.agentHooks.status, async (): Promise<AgentHooksStatus[]> =>
    Promise.all(AGENTS.map((agent) => installer.status(agent)))
  )
  ipcMain.handle(IPC_CHANNELS.agentHooks.install, (_event, agent: unknown) => installer.install(expectAgent(agent)))
  ipcMain.handle(IPC_CHANNELS.agentHooks.remove, (_event, agent: unknown) => installer.remove(expectAgent(agent)))
  return installer
}
