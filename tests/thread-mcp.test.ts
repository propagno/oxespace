import { expect, it, vi } from 'vitest'
import { bindThreadMcp, threadMcpArguments } from '../electron/main/services/conversation/thread-mcp'
import type { AgentConversationAdapter } from '../shared/types/thread'

it('adds the OXESpace bridge while preserving Claude CLI MCP inheritance and permissions', () => {
  const args = threadMcpArguments('claude', ['--tools', 'Read,Glob,Grep,Skill', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--settings', '{"disableAllHooks":true}'], '/bridge.cjs')
  expect(args.filter(arg => arg === '--mcp-config')).toHaveLength(1)
  expect(args).not.toContain('--strict-mcp-config')
  expect(args.slice(0, 4)).toEqual(['--tools', 'Read,Glob,Grep,Skill', '--settings', '{"disableAllHooks":true}'])
  const server = JSON.parse(args.at(-1)!).mcpServers['oxespace-delegation']
  expect(server.args[0]).toBe('/bridge.cjs')
  expect(JSON.parse(server.args[2])).toContain('oxespace_memory_search')
  expect(JSON.parse(server.args[2])).toContain('oxespace_run_script')
  expect(JSON.parse(server.args[2])).toContain('oxespace_quality_check')
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
