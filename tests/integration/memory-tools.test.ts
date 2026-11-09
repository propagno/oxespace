import { describe, expect, test, vi } from 'vitest'
import { MEMORY_TOOLS } from '../../electron/main/mcp-internal/memory-tool-handlers'
import { MemoryManager } from '../../electron/main/services/memory/memory-manager'
import type { ToolContext } from '../../electron/main/mcp-internal/tool-registry'
import type { MemoryProvider } from '../../electron/main/services/memory/memory-provider'

const context = { projectId: 'project', workspace: 'oxespace-local', project: 'p-project', cwd: '/worktrees/current' }
const tool = (name: string) => MEMORY_TOOLS.find(entry => entry.descriptor.name === name)!
const settings = () => ({ enabled: true, automaticCapture: true, automaticContext: true })
function fixture(offline = false): ToolContext {
  const provider = { search: vi.fn(async () => []), getRelevantContext: async () => {
    if (offline) throw new Error('offline')
    return { text: 'Verified project decision', sources: ['decision.md'] }
  } } as unknown as MemoryProvider
  return { workspaceId: 'ws', memoryRunId: 'run', memory: { contextForRun: vi.fn(async () => context), manager: new MemoryManager(() => provider, settings) } } as unknown as ToolContext
}
describe('project context MCP boundary', () => {
  test('forbids active-workspace and unbound-run fallbacks', async () => {
    await expect(tool('oxespace_memory_search').handler({ query: 'JWT' }, { ...fixture(), workspaceId: null })).rejects.toThrow('explicitly bound')
    await expect(tool('oxespace_memory_search').handler({ query: 'JWT' }, { ...fixture(), memoryRunId: undefined })).rejects.toThrow('explicitly bound')
  })
  test('names this checkout and returns the shared project memory, with no code index (R1)', async () => {
    const result = await tool('oxespace_project_context').handler({ query: 'JWT', project: 'foreign', global: true }, fixture())
    const body = JSON.parse((result.content[0] as { text: string }).text)
    expect(body.checkout).toBe(context.cwd)
    expect(body.memory.status).toBe('ok')
    expect(body).not.toHaveProperty('code')
    expect(tool('oxespace_project_context').descriptor.description).not.toMatch(/CodeGraph/)
  })
  test('a memory failure is reported as unavailable, not thrown', async () => {
    const result = await tool('oxespace_project_context').handler({ query: 'JWT' }, fixture(true))
    const body = JSON.parse((result.content[0] as { text: string }).text)
    expect(body.checkout).toBe(context.cwd)
    expect(body.memory.status).toBe('unavailable')
  })
})

describe('handoff acceptance tool', () => {
  test('requires an exact handoff id and forwards it to the provider', async () => {
    const acceptHandoff = vi.fn(async () => ({ accepted: true }))
    const provider = { acceptHandoff } as unknown as MemoryProvider
    const ctx = { workspaceId: 'ws', memoryRunId: 'run', memory: { contextForRun: vi.fn(async () => context), manager: new MemoryManager(() => provider, settings) } } as unknown as ToolContext
    const accept = tool('oxespace_memory_accept_handoff')
    expect(accept.descriptor.inputSchema).toMatchObject({ required: ['handoff_id'] })
    await expect(accept.handler({}, ctx)).rejects.toThrow('handoff_id is required')
    expect(acceptHandoff).not.toHaveBeenCalled()
    await accept.handler({ handoff_id: ' h1 ' }, ctx)
    expect(acceptHandoff).toHaveBeenCalledWith(context, 'h1')
  })
})
