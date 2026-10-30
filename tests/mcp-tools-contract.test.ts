import { describe, expect, it, vi } from 'vitest'
import { TOOL_REGISTRY } from '../electron/main/mcp-internal/tool-registry'
import { CODE_TOOL_GROUP, MCP_TOOL_GROUPS, OPTIONAL_THREAD_TOOL_GROUPS, THREAD_TOOL_GROUPS } from '../electron/main/services/conversation/thread-mcp'
import { createOxeApi, type PreloadIpc } from '../electron/preload/api'
import { FORBIDDEN_CAPABILITIES, MCP_COVERAGE } from '../shared/mcp-coverage'
import { IPC_CHANNELS } from '../shared/types/ipc'
import { CONFIGURABLE_MCP_TOOL_GROUPS, estimateTokens, MCP_TOOL_GROUP_IDS, MCP_TOOL_GROUP_MODES } from '../shared/types/mcp-tools'

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

  it('estimates tokens as characters / 4, rounded up', () => {
    expect(estimateTokens(0)).toBe(0)
    expect(estimateTokens(9000)).toBe(2250)
    expect(estimateTokens(9001)).toBe(2251)
  })

  it('exposes both calls through the preload', async () => {
    const ipc: PreloadIpc = { invoke: vi.fn().mockResolvedValue(undefined), on: vi.fn(), removeListener: vi.fn() }
    const api = createOxeApi(ipc).mcpInternal
    await api.toolGroups!({ rootPath: 'C:/repo' })
    await api.setToolGroupMode!({ rootPath: 'C:/repo', group: 'data', mode: 'off' })
    expect(vi.mocked(ipc.invoke).mock.calls).toEqual([
      [IPC_CHANNELS.mcpInternal.toolGroups, { rootPath: 'C:/repo' }],
      [IPC_CHANNELS.mcpInternal.setToolGroupMode, { rootPath: 'C:/repo', group: 'data', mode: 'off' }]
    ])
  })
})
