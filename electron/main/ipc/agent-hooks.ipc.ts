import { ipcMain } from 'electron'
import { join } from 'node:path'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { AgentHookAgent, AgentHooksStatus } from '../../../shared/types/agent-hooks'
import type { AgentHookInstaller } from '../services/agent-hooks/installer'

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
async function createInstaller(userDataPath: string): Promise<AgentHookInstaller> {
  // The installer and the hook script it writes load with the first Settings request, not with the main entry.
  const [{ AgentHookInstaller }, { default: statusHookSource }] = await Promise.all([
    import('../services/agent-hooks/installer'), import('../../../resources/agent-hooks/oxespace-status-hook.cjs?raw')
  ])
  return new AgentHookInstaller({ directory: join(userDataPath, 'agent-hooks'), scriptSource: statusHookSource })
}

export function registerAgentHooksIpc(userDataPath: string, load: () => Promise<AgentHookInstaller> = () => createInstaller(userDataPath)): void {
  let installer: Promise<AgentHookInstaller> | null = null
  const loaded = (): Promise<AgentHookInstaller> => (installer ??= load().catch(error => { installer = null; throw error }))
  ipcMain.handle(IPC_CHANNELS.agentHooks.status, async (): Promise<AgentHooksStatus[]> => {
    const current = await loaded()
    return Promise.all(AGENTS.map((agent) => current.status(agent)))
  })
  ipcMain.handle(IPC_CHANNELS.agentHooks.install, async (_event, agent: unknown) => { const target = expectAgent(agent); return (await loaded()).install(target) })
  ipcMain.handle(IPC_CHANNELS.agentHooks.remove, async (_event, agent: unknown) => { const target = expectAgent(agent); return (await loaded()).remove(target) })
}
