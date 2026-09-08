import { describe, expect, test, vi } from 'vitest'
import { MEMORY_TOOLS } from '../../electron/main/mcp-internal/memory-tool-handlers'
import { MemoryManager } from '../../electron/main/services/memory/memory-manager'
import type { ToolContext } from '../../electron/main/mcp-internal/tool-registry'
import type { MemoryProvider } from '../../electron/main/services/memory/memory-provider'

vi.mock('../../electron/main/vendor/codegraph/mcp/tools', () => ({ ToolHandler: class {
  async execute() { return { code: 'Current checkout code' } }
} }))
const context = { projectId: 'project', workspace: 'oxespace-local', project: 'p-project', cwd: '/worktrees/current' }
const tool = (name: string) => MEMORY_TOOLS.find(entry => entry.descriptor.name === name)!
const settings = () => ({ enabled: true, automaticCapture: true, automaticContext: true })
function fixture(offline = false): ToolContext {
  const provider = { search: vi.fn(async () => []), getRelevantContext: async () => {
    if (offline) throw new Error('offline')
    return { text: 'Verified project decision', sources: ['decision.md'] }
  } } as unknown as MemoryProvider
  return { workspaceId: 'ws', memoryRunId: 'run', memory: { contextForRun: vi.fn(async () => context), manager: new MemoryManager(() => provider, settings) },
    codegraph: { ensureInstance: vi.fn(async () => ({})) } } as unknown as ToolContext
}
describe('project context MCP boundary', () => {
  test('forbids active-workspace and unbound-run fallbacks', async () => {
    await expect(tool('oxespace_memory_search').handler({ query: 'JWT' }, { ...fixture(), workspaceId: null })).rejects.toThrow('explicitly bound')
    await expect(tool('oxespace_memory_search').handler({ query: 'JWT' }, { ...fixture(), memoryRunId: undefined })).rejects.toThrow('explicitly bound')
  })
  test('CodeGraph uses this checkout while memory remains shared project scope', async () => {
    const ctx = fixture()
    const result = await tool('oxespace_project_context').handler({ query: 'JWT', project: 'foreign', global: true }, ctx)
    expect(ctx.codegraph.ensureInstance).toHaveBeenCalledWith('/worktrees/current')
    const body = JSON.parse((result.content[0] as { text: string }).text)
    expect(body.checkout).toBe(context.cwd)
    expect(body.memory.status).toBe('ok')
    expect(body.code.code).toBe('Current checkout code')
  })
  test('memory failure does not suppress code, and graph failure does not suppress memory', async () => {
    const first = await tool('oxespace_project_context').handler({ query: 'JWT' }, fixture(true))
    const a = JSON.parse((first.content[0] as { text: string }).text)
    expect(a.memory.status).toBe('unavailable')
    expect(a.code.code).toBe('Current checkout code')
    const secondContext = fixture()
    vi.mocked(secondContext.codegraph.ensureInstance).mockRejectedValue(new Error('graph unavailable'))
    const second = await tool('oxespace_project_context').handler({ query: 'JWT' }, secondContext)
    const b = JSON.parse((second.content[0] as { text: string }).text)
    expect(b.memory.status).toBe('ok')
    expect(b.code.status).toBe('unavailable')
  })
})
