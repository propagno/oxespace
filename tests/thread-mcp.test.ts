import { expect, it, vi } from 'vitest'
import { bindThreadMcp, threadMcpArguments } from '../electron/main/services/conversation/thread-mcp'
import type { AgentConversationAdapter } from '../shared/types/thread'

it('adds the OXESpace bridge while preserving Claude CLI MCP inheritance and permissions', () => {
  const args = threadMcpArguments('claude', ['--tools', 'default', '--settings', '{"disableAllHooks":true}'], '/bridge.cjs')
  expect(args.filter(arg => arg === '--mcp-config')).toHaveLength(1)
  expect(args).not.toContain('--strict-mcp-config')
  expect(args.slice(0, 4)).toEqual(['--tools', 'default', '--settings', '{"disableAllHooks":true}'])
  const server = JSON.parse(args.at(-1)!).mcpServers['oxespace-delegation']
  expect(server.args[0]).toBe('/bridge.cjs')
  expect(JSON.parse(server.args[2])).toContain('oxespace_memory_search')
  expect(JSON.parse(server.args[2])).toContain('oxespace_hybrid_explore')
  // Tools that need a Code workspace's panes, scripts, jobs or worktrees are not offered to a Thread.
  for (const codeOnly of ['oxespace_run_script', 'oxespace_list_panes', 'oxespace_list_worktrees', 'oxespace_create_worktree', 'oxespace_remove_worktree', 'oxespace_list_background_jobs']) {
    expect(JSON.parse(server.args[2])).not.toContain(codeOnly)
  }
  expect(JSON.parse(server.args[2])).toContain('oxespace_quality_check')
  expect(JSON.parse(server.args[2])).toContain('oxespace_thread_create')
  expect(JSON.parse(server.args[2])).toContain('oxespace_thread_send')
})

it('injects Codex MCP options before app-server without embedding secrets in arguments', () => {
  const args = threadMcpArguments('codex', ['app-server', '--listen', 'stdio://'], '/bridge.cjs')
  expect(args.slice(-3)).toEqual(['app-server', '--listen', 'stdio://'])
  expect(args.join(' ')).toContain('OXESPACE_MEMORY_RUN_ID')
  expect(args.join(' ')).toContain('OXESPACE_EXECUTION_ID')
  expect(args.join(' ')).toContain('OXESPACE_EXECUTION_TOKEN')
  expect(args.join(' ')).toContain('--allowed-tools')
})

it('releases a Thread memory lease even if provider cleanup fails, and only once', async () => {
  const end = vi.fn(), dispose = vi.fn(async () => { throw Error('Process already closed') })
  const adapter = bindThreadMcp({ dispose } as unknown as AgentConversationAdapter, end)
  await expect(adapter.dispose()).rejects.toThrow('Process already closed')
  await expect(adapter.dispose()).rejects.toThrow('Process already closed')
  expect(end).toHaveBeenCalledTimes(1)
})

it('gives a read-only Claude conversation the bridge limited to read-only lookups, and no user servers', () => {
  const args = ['--tools', 'Read,Glob,Grep,AskUserQuestion', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}']
  const result = threadMcpArguments('claude', args, '/bridge.cjs', { servers: [{ name: 'user-writer' }] } as never)
  expect(result.slice(0, 4)).toEqual(args.slice(0, 4))
  const config = JSON.parse(result[4]) as { mcpServers: Record<string, { args: string[] }> }
  expect(Object.keys(config.mcpServers)).toEqual(['oxespace-delegation'])
  const allowed = JSON.parse(config.mcpServers['oxespace-delegation'].args[2]) as string[]
  expect(allowed).toContain('oxespace_hybrid_explore')
  expect(allowed).toContain('oxespace_memory_search')
  for (const writer of ['oxespace_memory_remember', 'oxespace_thread_send', 'oxespace_delegate_task', 'oxespace_team_message', 'oxespace_documentation_create', 'oxespace_open_web_preview']) {
    expect(allowed).not.toContain(writer)
  }
})

it('preserves any other explicitly restricted MCP configuration untouched', () => {
  const args = ['--strict-mcp-config', '--mcp-config', '{"mcpServers":{"custom":{"command":"x"}}}']
  expect(threadMcpArguments('claude', args, '/bridge.cjs')).toEqual(args)
})
