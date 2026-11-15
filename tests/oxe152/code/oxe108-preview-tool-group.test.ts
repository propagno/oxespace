// Frozen acceptance test for 1.5.2 OxeCode F3 (OXE program oxespace-152-code, phase F3, Jira OXE-108).
// Written by the planner; the executor must not edit it.
// Defect (real use, 13/11): the Web Preview and Android device tools live in the optional "docs" group ("web previews
// and documentation captures"), on demand by default, so an agent in a Code terminal without tool search does not see
// them (shared/types/mcp-tools.ts:12-16, electron/main/services/conversation/thread-mcp.ts:45,
// electron/main/mcp-internal/tool-registry.ts:91).
// Contract:
// - A new group id 'preview' in MCP_TOOL_GROUP_IDS and CONFIGURABLE_MCP_TOOL_GROUPS (RT-1), with MCP_TOOL_GROUPS.preview
//   (THREAD_TOOL_GROUPS.preview) holding oxespace_open_web_preview, oxespace_capture_web_preview,
//   oxespace_preview_interact and oxespace_device_screenshot; no other group holds any of them.
// - projectToolModes(): 'preview' defaults to { mode: 'always', source: 'default' }; a project can set it 'off'; a saved
//   configuration that turns 'docs' off (map form) or lists groups (1.3 list form) does not turn 'preview' off (RT-2).
// - sessionToolPlan(): with the defaults, a Code terminal session without tool search starts with the preview tools.
// - oxespace_capabilities: every entry of data.tools carries `group`: the group that holds the tool (the one group for a
//   tool in exactly one; one of its groups for a tool in several; null for a tool in none).
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/user-data', getAppPath: () => '/app', isPackaged: false, getVersion: () => '1.5.2' } }))

const { MCP_TOOL_GROUP_IDS, CONFIGURABLE_MCP_TOOL_GROUPS } = await import('../../../shared/types/mcp-tools')
const { MCP_TOOL_GROUPS } = await import('../../../electron/main/services/conversation/thread-mcp')
const { projectToolModes, sessionToolPlan } = await import('../../../electron/main/services/conversation/tool-groups')
const { findTool } = await import('../../../electron/main/mcp-internal/tool-registry')
const { ExecutionRegistry } = await import('../../../electron/main/services/execution-registry')

const PREVIEW_TOOLS = ['oxespace_open_web_preview', 'oxespace_capture_web_preview', 'oxespace_preview_interact', 'oxespace_device_screenshot']
const groups = MCP_TOOL_GROUPS as unknown as Record<string, readonly string[]>
type Modes = Record<string, { mode: string; source: string }>

describe('OXE-108 · the preview and device tools have their own visible group', () => {
  it('CA-1 · the Web Preview and Android device tools are in the "preview" group, and none is left in docs', () => {
    expect(MCP_TOOL_GROUP_IDS as readonly string[]).toContain('preview')
    expect(CONFIGURABLE_MCP_TOOL_GROUPS as readonly string[]).toContain('preview')
    expect([...(groups.preview ?? [])].sort()).toEqual([...PREVIEW_TOOLS].sort())
    for (const [id, tools] of Object.entries(groups)) {
      if (id === 'preview') continue
      expect(tools.filter(tool => PREVIEW_TOOLS.includes(tool)), id).toEqual([])
    }
  })

  it('CA-2 · in a session with a workspace the "preview" group starts on, and Settings can turn it off', () => {
    const defaults = projectToolModes(undefined) as unknown as Modes
    expect(defaults.preview).toEqual({ mode: 'always', source: 'default' })
    // An agent in a Code terminal, without tool search (the case that hid them), starts with the tools.
    const plan = sessionToolPlan(false, { code: true }, projectToolModes(undefined))
    for (const tool of PREVIEW_TOOLS) expect(plan.tools, tool).toContain(tool)
    // The person can turn it off (Settings › Tools writes thread.toolModes), and then nothing of it is offered.
    const off = projectToolModes({ toolModes: { preview: 'off' } } as never)
    expect((off as unknown as Modes).preview).toEqual({ mode: 'off', source: 'project' })
    const planOff = sessionToolPlan(true, { code: true }, off)
    for (const tool of PREVIEW_TOOLS) expect(planOff.tools, tool).not.toContain(tool)
    // RT-2: a configuration saved with docs off, or in the 1.3 list form, leaves preview on.
    expect((projectToolModes({ toolModes: { docs: 'off' } } as never) as unknown as Modes).preview.mode).toBe('always')
    expect((projectToolModes({ tools: ['data'] } as never) as unknown as Modes).preview.mode).toBe('always')
  })

  it('CA-3 · oxespace_capabilities lists the group of each tool', async () => {
    const executions = new ExecutionRegistry()
    const env = executions.register({ owner: { kind: 'thread', id: 't1' }, workspaceId: 'w1', cwd: process.cwd() })
    const tool = findTool('oxespace_capabilities')
    expect(tool).not.toBeNull()
    const ctx = { workspaceId: 'w1', executionId: env.OXESPACE_EXECUTION_ID, executionToken: env.OXESPACE_EXECUTION_TOKEN, executions, workspaceServ: { get: () => undefined } }
    const result = await tool!.handler({}, ctx as never)
    const reply = JSON.parse((result.content[0] as { text: string }).text) as { status: string; data: { tools: Array<{ name: string; group?: unknown }> } }
    expect(reply.status).toBe('ok')
    const listed = reply.data.tools
    for (const name of PREVIEW_TOOLS) expect(listed.find(entry => entry.name === name), name).toMatchObject({ group: 'preview' })
    for (const entry of listed) {
      expect(entry, entry.name).toHaveProperty('group')
      const holders = Object.entries(groups).filter(([, tools]) => tools.includes(entry.name)).map(([id]) => id)
      if (holders.length === 0) expect(entry.group, entry.name).toBeNull()
      else expect(holders, entry.name).toContain(entry.group)
    }
  })
})
