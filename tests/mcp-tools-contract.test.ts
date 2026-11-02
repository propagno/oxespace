import { describe, expect, it, vi } from 'vitest'
import { TOOL_REGISTRY } from '../electron/main/mcp-internal/tool-registry'
import { CODE_TOOL_GROUP, MCP_TOOL_GROUPS, OPTIONAL_THREAD_TOOL_GROUPS, THREAD_TOOL_GROUPS } from '../electron/main/services/conversation/thread-mcp'
import { createOxeApi, type PreloadIpc } from '../electron/preload/api'
import { FORBIDDEN_CAPABILITIES, MCP_COVERAGE } from '../shared/mcp-coverage'
import { IPC_CHANNELS } from '../shared/types/ipc'
import { serverKey } from '../shared/types/mcp'
import {
  CHARS_PER_TOKEN, CONFIGURABLE_MCP_TOOL_GROUPS, MCP_TOOL_DECISIONS, MCP_TOOL_RULE_REFUSAL_CODES, estimateTokens, isMcpToolRuleRefusal,
  MCP_TOOL_GROUP_IDS, MCP_TOOL_GROUP_MODES, type McpToolRule
} from '../shared/types/mcp-tools'

vi.mock('../electron/main/vendor/codegraph/mcp/tools', () => ({ ToolHandler: class { execute = vi.fn() } }))

describe('Settings › Tools contract (F10)', () => {
  it('names the same groups the Thread runtime offers, and the same configurable ones', () => {
    expect([...MCP_TOOL_GROUP_IDS].sort()).toEqual(Object.keys(MCP_TOOL_GROUPS).sort())
    expect([...CONFIGURABLE_MCP_TOOL_GROUPS].sort()).toEqual([...OPTIONAL_THREAD_TOOL_GROUPS].sort())
    for (const fixed of ['core', 'team', 'worker', 'code']) expect(CONFIGURABLE_MCP_TOOL_GROUPS as readonly string[]).not.toContain(fixed)
    expect(MCP_TOOL_GROUP_MODES).toEqual(['always', 'on-demand', 'off'])
  })

  it('puts every registered tool in a group, and keeps the Code terminal\'s group out of OxeChat', () => {
    const grouped = new Set<string>(Object.values(MCP_TOOL_GROUPS).flat())
    // The enable tool belongs to no group: a session is given it only when it has something to turn on (B7.2).
    expect(TOOL_REGISTRY.map(entry => entry.descriptor.name).filter(name => !grouped.has(name) && name !== 'oxespace_tools_enable')).toEqual([])
    const thread = new Set<string>(Object.values(THREAD_TOOL_GROUPS).flat())
    expect(CODE_TOOL_GROUP.filter(tool => thread.has(tool))).toEqual([])
    expect(Object.keys(THREAD_TOOL_GROUPS)).not.toContain('code')
  })

  it('uses stable channel names', () => {
    expect(IPC_CHANNELS.mcpInternal.toolGroups).toBe('mcp-internal:tool-groups')
    expect(IPC_CHANNELS.mcpInternal.setToolGroupMode).toBe('mcp-internal:set-tool-group-mode')
    expect(IPC_CHANNELS.mcpInternal.toolRules).toBe('mcp-internal:tool-rules')
    expect(IPC_CHANNELS.mcpInternal.setToolRule).toBe('mcp-internal:set-tool-rule')
  })

  it('keeps per-tool rules with the person: forbidden to MCP, read only by the window (B7.3)', () => {
    expect(MCP_TOOL_DECISIONS).toEqual(['allow', 'ask', 'deny'])
    expect(FORBIDDEN_CAPABILITIES).toContain('mcp.tool_rules_admin')
    const admin = MCP_COVERAGE['mcp.tool_rules_admin']
    expect('forbidden' in admin && !('tools' in admin)).toBe(true)
    expect(admin.ipc).toEqual(['mcpInternal.setToolRule'])
    expect(MCP_COVERAGE['settings.app'].ipc).toContain('mcpInternal.toolRules')
    expect(TOOL_REGISTRY.map(entry => entry.descriptor.name).filter(name => /tool_?rule|approval_rule|set_permission/i.test(name))).toEqual([])
  })

  it('names why a tool rule is refused with a typed code the window can test (B7.3 CCR)', () => {
    expect(MCP_TOOL_RULE_REFUSAL_CODES).toEqual(['mcp.toolRule.confirmLevel', 'mcp.toolRule.locked', 'mcp.toolRule.invalidPolicy'])
    for (const code of MCP_TOOL_RULE_REFUSAL_CODES) expect(isMcpToolRuleRefusal(new Error(code).message), code).toBe(true)
    for (const other of ['Invalid MCP tool', 'mcp.quarantine.added', undefined, null]) expect(isMcpToolRuleRefusal(other)).toBe(false)
  })

  it('keys a configured server the same way on both sides (B7.3 CCR)', () => {
    expect(serverKey('GitHub')).toBe('github')
    expect(serverKey('  My Docs Server ')).toBe('my-docs-server')
    expect(serverKey('db_main-2')).toBe('db_main-2')
    expect(serverKey('***')).toBe('mcp-server')
  })

  it('offers the window only the decisions a row allows (B7.3 CCR)', async () => {
    const handlers = new Map<string, (event: unknown, input: unknown) => unknown>()
    vi.doMock('electron', () => ({ ipcMain: { handle: (channel: string, handler: (event: unknown, input: unknown) => unknown) => handlers.set(channel, handler) } }))
    const { registerMcpToolsMock } = await import('../electron/main/e2e/mcp-tools-mock')
    registerMcpToolsMock()
    const rules = handlers.get(IPC_CHANNELS.mcpInternal.toolRules)!({}, { rootPath: 'C:/repo' }) as McpToolRule[]
    const byTool = Object.fromEntries(rules.map(rule => [rule.tool, rule]))
    expect(byTool.oxespace_remove_worktree).toMatchObject({ confirmLevel: true, allowedDecisions: ['ask', 'deny'] })
    expect(byTool.create_issue).toMatchObject({ confirmLevel: false, allowedDecisions: ['allow', 'ask', 'deny'] })
    expect(byTool.delete_repository).toMatchObject({ editable: false, allowedDecisions: [] })
    const set = handlers.get(IPC_CHANNELS.mcpInternal.setToolRule)!
    expect(() => set({}, { rootPath: 'C:/repo', server: 'oxespace-delegation', tool: 'oxespace_remove_worktree', decision: 'allow' })).toThrow('mcp.toolRule.confirmLevel')
    expect(() => set({}, { rootPath: 'C:/repo', server: 'github', tool: 'delete_repository', decision: 'ask' })).toThrow('mcp.toolRule.locked')
    vi.doUnmock('electron')
  })

  it('keeps choosing a mode with the person, and reading it to the window', () => {
    expect(FORBIDDEN_CAPABILITIES).toContain('mcp_internal.tool_groups_admin')
    const admin = MCP_COVERAGE['mcp_internal.tool_groups_admin']
    expect('forbidden' in admin && !('tools' in admin)).toBe(true)
    expect(admin.ipc).toEqual(['mcpInternal.setToolGroupMode'])
    expect(MCP_COVERAGE['settings.app'].ipc).toContain('mcpInternal.toolGroups')
    // A session turns a group on with oxespace_tools_enable (B7.2); nothing writes the project's modes.
    expect(TOOL_REGISTRY.map(entry => entry.descriptor.name).filter(name => /tool_?group|tools_mode|set_tool/i.test(name))).toEqual([])
  })

  it('estimates tokens with the factor measured in T8, rounded up', () => {
    expect(CHARS_PER_TOKEN).toBe(2.4)
    expect(estimateTokens(0)).toBe(0)
    expect(estimateTokens(2400)).toBe(1000)
    expect(estimateTokens(2401)).toBe(1001)
    // The real session: 47,411 characters of definitions were 19,875 tokens.
    expect(Math.abs(estimateTokens(47_411) - 19_875) / 19_875).toBeLessThan(0.01)
  })

  it('exposes both calls through the preload', async () => {
    const ipc: PreloadIpc = { invoke: vi.fn().mockResolvedValue(undefined), on: vi.fn(), removeListener: vi.fn() }
    const api = createOxeApi(ipc).mcpInternal
    await api.toolGroups!({ rootPath: 'C:/repo' })
    await api.setToolGroupMode!({ rootPath: 'C:/repo', group: 'data', mode: 'off' })
    await api.toolRules!({ rootPath: 'C:/repo' })
    await api.setToolRule!({ rootPath: 'C:/repo', server: 'github', tool: 'create_issue', decision: 'deny' })
    expect(vi.mocked(ipc.invoke).mock.calls).toEqual([
      [IPC_CHANNELS.mcpInternal.toolGroups, { rootPath: 'C:/repo' }],
      [IPC_CHANNELS.mcpInternal.setToolGroupMode, { rootPath: 'C:/repo', group: 'data', mode: 'off' }],
      [IPC_CHANNELS.mcpInternal.toolRules, { rootPath: 'C:/repo' }],
      [IPC_CHANNELS.mcpInternal.setToolRule, { rootPath: 'C:/repo', server: 'github', tool: 'create_issue', decision: 'deny' }]
    ])
  })
})
