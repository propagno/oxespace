import { basename, join } from 'node:path'
import { existsSync } from 'node:fs'
import type { AgentProfile } from '../../../shared/types/agent'
import type { DelegationTask } from '../../../shared/types/delegation'
import type { TerminalManager } from './terminal.service'
import type { AppDatabase } from '../db/index'
import { codexMcpArguments, readManagedMcp } from './conversation/thread-managed-mcp'
import { bridgePlanFlags, type BridgePlan } from '../mcp-internal/bridge-plan'

const forwarded = ['OXESPACE_MCP_PORT','OXESPACE_MCP_TOKEN','OXESPACE_WORKSPACE_ID','OXESPACE_EXECUTION_ID','OXESPACE_EXECUTION_TOKEN','OXESPACE_MEMORY_RUN_ID']
/** The bridge's own arguments: the session's tool list and the groups it may turn on, when a plan limits them (B7.2). */
export function bridgeArguments(bridge: string, plan?: BridgePlan): string[] {
  return plan ? [bridge, ...bridgePlanFlags(plan)] : [bridge]
}
export function agentMcpArguments(provider: string, bridge: string, plan?: Parameters<typeof bridgeArguments>[1]): string[] {
  const args = bridgeArguments(bridge, plan)
  if (provider === 'claude') return ['--mcp-config', JSON.stringify({ mcpServers: { 'oxespace-delegation': { command: 'node', args } } })]
  if (provider === 'codex') return ['-c', 'mcp_servers.oxespace-delegation.command="node"', '-c', `mcp_servers.oxespace-delegation.args=${JSON.stringify(args)}`,
    '-c', `mcp_servers.oxespace-delegation.env_vars=${JSON.stringify(forwarded)}`]
  return []
}
/**
 * MCP arguments for an agent started in a Code terminal. Claude Code and Copilot
 * read the workspace's `.mcp.json`; Codex reads only its own configuration, so
 * the servers configured in OXESpace travel as `-c` overrides for this launch.
 * Nothing is written to ~/.codex/config.toml, and a `codex` started outside
 * OXESpace does not see them. Secrets go in `env`, referenced by name.
 */
export async function codeAgentMcpLaunch(db: AppDatabase, provider: string, bridge: string, workspaceId: string, args: string[],
  source: NodeJS.ProcessEnv = process.env): Promise<{ args: string[]; env?: Record<string, string> }> {
  // The same groups as an OxeChat conversation, plus the Code terminal's own, by the project's modes (B2.2).
  const [{ projectToolModes, sessionToolPlan, usesToolSearch }, { toolSearchEnvironment }, { loadRepoConfig }] = await Promise.all([
    import('./conversation/tool-groups'), import('./conversation/thread-mcp'), import('./repo-config/loader')])
  let root: string | undefined
  try { root = (db.prepare('SELECT root_path FROM workspaces WHERE id = ?').get(workspaceId) as { root_path: string } | undefined)?.root_path } catch { /* defaults */ }
  const modes = projectToolModes(root ? (await loadRepoConfig(root).catch(() => null))?.thread : undefined)
  const search = provider === 'claude' || provider === 'codex' ? toolSearchEnvironment(provider, source) : {}
  // Other agents read the workspace's .mcp.json and get no bridge arguments here; the plan only matters for these two.
  const plan = sessionToolPlan(provider === 'claude' || provider === 'codex' ? usesToolSearch(provider, { ...source, ...search }) : false, { code: true }, modes)
  const own = agentMcpArguments(provider, bridge, plan)
  if (provider !== 'codex') return { args: [...own, ...args], env: search }
  try {
    const managed = readManagedMcp(db, workspaceId)
    return { args: [...own, ...codexMcpArguments(managed), ...args], env: { ...managed.env, ...search } }
  } catch {
    // The launch never fails over the extra servers.
    return { args: [...own, ...args], env: search }
  }
}
export class AgentLaunchService {
  constructor(private terminal: TerminalManager, private profiles: () => AgentProfile[], private directory: string) {}
  resolve(id: string): { executable: string; provider: string; prompt: string } {
    const p = this.profiles().find(p => p.agentProfileId === id)
    if (!p) throw new Error('Unknown agent profile')
    const provider = p.parentProvider ?? p.provider
    if (!['claude','codex'].includes(provider)) throw new Error('Delegation currently supports native Claude and Codex profiles')
    const command = (p.parentProvider ? this.profiles().find(other => other.provider === p.parentProvider)?.command : p.command)?.trim() ?? ''
    const executable = command.replace(/^"(.*)"$/, '$1')
    if (!executable || /[\r\n\0]/.test(executable) || (!existsSync(executable) && /\s/.test(executable))) throw new Error('Delegation requires an agent executable path without embedded command arguments. Configure the agent profile first.')
    return { executable, provider, prompt: p.systemPrompt ?? '' }
  }
  launch(task: DelegationTask): Promise<void> {
    const agent = this.resolve(task.agentProfileId)
    const prompt = delegationBootstrap(task, agent.prompt)
    return this.terminal.start({ paneId: task.paneId!, workspaceId: task.workspaceId, requireCwd: task.path,
      launch: { executable: agent.executable, args: [...agentMcpArguments(agent.provider, join(this.directory,'bin','oxespace-mcp.cjs')), '--', prompt] } })
  }
}
export function delegationBootstrap(task: DelegationTask, systemPrompt = ''): string {
  return `You are handling OXESpace delegation ${task.id}. First call oxespace_delegation_context with taskId ${task.id}, then oxespace_delegation_update with state accepted and a short summary. Follow its objective and acceptance criteria. Persist progress with oxespace_delegation_checkpoint and check oxespace_delegation_inbox at milestones. Send questions with oxespace_delegation_message. Submit a verified result and tests using state review. Do not create recursive delegations.\n${systemPrompt.slice(0,2000)}`
}
export function providerForExecutable(executable: string): string {
  return basename(executable).replace(/\.(exe|cmd|bat|ps1)$/i,'').toLowerCase()
}
