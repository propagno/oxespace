import { describe, expect, it, vi } from 'vitest'
import { TOOL_REGISTRY } from '../electron/main/mcp-internal/tool-registry'
import { createOxeApi, type PreloadIpc } from '../electron/preload/api'
import { FORBIDDEN_CAPABILITIES, MCP_COVERAGE } from '../shared/mcp-coverage'
import { IPC_CHANNELS } from '../shared/types/ipc'

vi.mock('../electron/main/vendor/codegraph/mcp/tools', () => ({ ToolHandler: class { execute = vi.fn() } }))

describe('coordinator conversation contract (B1.4)', () => {
  it('lets only the person choose the coordinator', async () => {
    expect(IPC_CHANNELS.thread.setCoordinator).toBe('thread:set-coordinator')
    expect(FORBIDDEN_CAPABILITIES).toContain('thread.coordinator_admin')
    const admin = MCP_COVERAGE['thread.coordinator_admin']
    expect('forbidden' in admin && !('tools' in admin)).toBe(true)
    expect(admin.ipc).toEqual(['thread.setCoordinator'])
    const ipc: PreloadIpc = { invoke: vi.fn().mockResolvedValue(undefined), on: vi.fn(), removeListener: vi.fn() }
    await createOxeApi(ipc).thread!.setCoordinator!('thread-A', true)
    expect(ipc.invoke).toHaveBeenCalledWith(IPC_CHANNELS.thread.setCoordinator, 'thread-A', true, undefined)
    // B1.4 · S7.5: the preview and its token cross as the third argument.
    await createOxeApi(ipc).thread!.setCoordinator!('thread-A', true, { preview: true })
    expect(ipc.invoke).toHaveBeenLastCalledWith(IPC_CHANNELS.thread.setCoordinator, 'thread-A', true, { preview: true })
  })

  it('reads pending requests through a read action, and never answers them', () => {
    const read = MCP_COVERAGE['thread.coordinator_read']
    expect('tools' in read && read.tools).toEqual({ 'oxespace_threads#pending': 'read' })
    expect(FORBIDDEN_CAPABILITIES).toContain('thread.approvals')
    // No tool, whatever its role, answers an approval or a question.
    const actions = (schema: unknown) => (schema as { properties?: { action?: { enum?: string[] } } }).properties?.action?.enum ?? []
    const names = TOOL_REGISTRY.flatMap(({ descriptor }) => [descriptor.name, ...actions(descriptor.inputSchema).map(action => `${descriptor.name}#${action}`)])
    // The one exception is not a person's approval: the requesting agent accepts the result of a task it delegated, an
    // agreement between agents that never merges. For the coordinator it holds only for tasks the coordinator itself
    // delegated (tests/integration/coordination.workflow.test.ts refuses a coordinator on another conversation's task).
    const NOT_A_PERSONS_APPROVAL = ['oxespace_delegation_control#approve']
    expect(names.filter(name => /respond|approve|answer|decide/i.test(name) && !NOT_A_PERSONS_APPROVAL.includes(name))).toEqual([])
  })
})
