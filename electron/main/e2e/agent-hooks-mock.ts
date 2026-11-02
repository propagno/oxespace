/**
 * F32 · The agents' status-hook installs for the E2E runs. Both read as installed unless a spec sets
 * `globalThis.__oxeAgentHooks = { 'claude-code': 'not_installed', … }`, so no other spec meets the install question.
 * An install is recorded in `globalThis.__oxeAgentHookInstalls` and nothing is written to ~/.claude or ~/.codex.
 */
import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { AgentHookAgent, AgentHooksInstallState, AgentHooksStatus } from '../../../shared/types/agent-hooks'

type Store = typeof globalThis & { __oxeAgentHooks?: Partial<Record<AgentHookAgent, AgentHooksInstallState>>; __oxeAgentHookInstalls?: AgentHookAgent[] }
const AGENTS: AgentHookAgent[] = ['claude-code', 'codex']

export function registerAgentHooksMock(): void {
  const store = globalThis as Store
  const status = (agent: AgentHookAgent): AgentHooksStatus => ({ agent, state: store.__oxeAgentHooks?.[agent] ?? 'installed', missing: [], detail: null })

  ipcMain.handle(IPC_CHANNELS.agentHooks.status, (): AgentHooksStatus[] => AGENTS.map(status))
  ipcMain.handle(IPC_CHANNELS.agentHooks.install, (_event, agent: AgentHookAgent): AgentHooksStatus => {
    ;(store.__oxeAgentHookInstalls ??= []).push(agent)
    store.__oxeAgentHooks = { ...store.__oxeAgentHooks, [agent]: 'installed' }
    return status(agent)
  })
  ipcMain.handle(IPC_CHANNELS.agentHooks.remove, (_event, agent: AgentHookAgent): AgentHooksStatus => {
    store.__oxeAgentHooks = { ...store.__oxeAgentHooks, [agent]: 'not_installed' }
    return status(agent)
  })
}
