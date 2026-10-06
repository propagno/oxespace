import { agentMcpArguments } from '../agent-launch.service'
import type { ConversationThread, AgentConversationAdapter } from '../../../../shared/types/thread'

export interface ThreadMcpBindings {
  bridge: string
  prepare(thread: ConversationThread): Promise<Record<string, string>>
  end(threadId: string, executionId?: string): void
  observed?(thread: ConversationThread): void
}

// Thread receives the same local OXESpace surface as Code. Provider permission
// requests remain enabled, so mutating calls are reviewed in the conversation.
const tools = ['oxespace_team_status', 'oxespace_team_inbox', 'oxespace_team_message', 'oxespace_team_acknowledge', 'oxespace_memory_search', 'oxespace_memory_remember', 'oxespace_memory_sessions',
  'oxespace_memory_handoffs', 'oxespace_memory_accept_handoff', 'oxespace_project_context',
  'oxespace_capabilities', 'oxespace_execution_context', 'oxespace_list_agents', 'oxespace_list_workspaces', 'oxespace_list_panes', 'oxespace_list_worktrees', 'oxespace_list_scripts',
  'oxespace_list_background_jobs', 'oxespace_get_job_output', 'oxespace_semantic_search',
  'oxespace_hybrid_explore', 'oxespace_quality_check', 'oxespace_run_script', 'oxespace_stop_background_job',
  'oxespace_create_worktree', 'oxespace_remove_worktree', 'oxespace_open_web_preview', 'oxespace_capture_web_preview',
  'oxespace_preview_interact', 'oxespace_documentation_create', 'oxespace_documentation_get', 'oxespace_documentation_list',
  'oxespace_documentation_capture', 'oxespace_documentation_checkpoint', 'oxespace_documentation_image', 'oxespace_documentation_export',
  'oxespace_delegation_targets', 'oxespace_delegation_preflight', 'oxespace_delegate_task', 'oxespace_delegation_status',
  'oxespace_delegation_inbox', 'oxespace_delegation_acknowledge', 'oxespace_delegation_context', 'oxespace_delegation_result',
  'oxespace_delegation_message', 'oxespace_delegation_control', 'oxespace_delegation_update', 'oxespace_delegation_checkpoint']

export function threadMcpArguments(provider: 'claude' | 'codex', args: string[], bridge: string): string[] {
  // Preserve an explicitly restricted tool surface, including disabled MCPs.
  if (provider === 'claude' && args.includes('--strict-mcp-config')) return args
  const config = agentMcpArguments(provider, bridge)
  const bridgeArgs = [bridge, '--allowed-tools', JSON.stringify(tools)]
  if (provider === 'codex') {
    config[3] = `mcp_servers.oxespace-delegation.args=${JSON.stringify(bridgeArgs)}`
    return [...config, ...args]
  }
  const clean = args.filter((arg, i) => !['--mcp-config', '--strict-mcp-config'].includes(arg) && args[i - 1] !== '--mcp-config')
  // Keep Claude's user and project MCP configuration. The extra config adds
  // the OXESpace bridge without replacing servers already available in the CLI.
  return [...clean, '--mcp-config', JSON.stringify({ mcpServers: {
    'oxespace-delegation': { command: 'node', args: bridgeArgs }
  } })]
}

export function bindThreadMcp(adapter: AgentConversationAdapter, release: () => void): AgentConversationAdapter {
  const dispose = adapter.dispose.bind(adapter)
  let released = false
  adapter.dispose = async () => {
    try { await dispose() } finally { if (!released) { released = true; release() } }
  }
  return adapter
}
