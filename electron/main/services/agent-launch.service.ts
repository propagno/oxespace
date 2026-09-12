import { basename, join } from 'node:path'
import { existsSync } from 'node:fs'
import type { AgentProfile } from '../../../shared/types/agent'
import type { DelegationTask } from '../../../shared/types/delegation'
import type { TerminalManager } from './terminal.service'

const forwarded = ['OXESPACE_MCP_PORT','OXESPACE_MCP_TOKEN','OXESPACE_WORKSPACE_ID','OXESPACE_EXECUTION_ID','OXESPACE_EXECUTION_TOKEN','OXESPACE_MEMORY_RUN_ID']
export function agentMcpArguments(provider: string, bridge: string): string[] {
  if (provider === 'claude') return ['--mcp-config', JSON.stringify({ mcpServers: { 'oxespace-delegation': { command: 'node', args: [bridge] } } })]
  if (provider === 'codex') return ['-c', 'mcp_servers.oxespace-delegation.command="node"', '-c', `mcp_servers.oxespace-delegation.args=${JSON.stringify([bridge])}`,
    '-c', `mcp_servers.oxespace-delegation.env_vars=${JSON.stringify(forwarded)}`]
  return []
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
    const prompt = `You are handling OXESpace delegation ${task.id}. First call oxespace_delegation_context with taskId ${task.id}, then oxespace_delegation_update with state accepted and a short summary. Follow its objective and acceptance criteria. Check oxespace_delegation_inbox at checkpoints. Send questions with oxespace_delegation_message. Submit a verified result and tests using state review. Do not create recursive delegations.\n${agent.prompt.slice(0,2000)}`
    return this.terminal.start({ paneId: task.paneId!, workspaceId: task.workspaceId, requireCwd: task.path,
      launch: { executable: agent.executable, args: [...agentMcpArguments(agent.provider, join(this.directory,'bin','oxespace-mcp.cjs')), '--', prompt] } })
  }
}
export function providerForExecutable(executable: string): string {
  return basename(executable).replace(/\.(exe|cmd|bat|ps1)$/i,'').toLowerCase()
}
