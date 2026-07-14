import { describe, expect, test, vi } from 'vitest'
// Import tool-registry (a value import) BEFORE tool-handlers so the
// tool-handlers <-> tool-registry circular dependency resolves in the same
// order as production (registry first). Importing handlers first leaves
// `handlers` undefined while tool-registry's TOOL_REGISTRY array evaluates.
import { TOOL_REGISTRY, type ToolContext } from '../../electron/main/mcp-internal/tool-registry'
import { handlers } from '../../electron/main/mcp-internal/tool-handlers'
import { WorktreeEventBus } from '../../electron/main/mcp-internal/worktree-event-bus'
import type { InternalMcpWorktreeChangedEvent } from '../../shared/types/mcp-internal'

/**
 * DB-free unit coverage for the two Tier-1 additions:
 *   - oxespace_get_job_output (read + workspace-ownership guard)
 *   - worktree create/remove emit a `changed` event on the bus
 *
 * The local-rpc integration suite can't run in this environment (better-sqlite3
 * is compiled for Electron's ABI, not the vitest Node ABI), so these tests
 * exercise the handlers directly with lightweight fakes — no native binding.
 */

const WS = { id: 'ws-1', rootPath: '/repo', name: 'Repo' }

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  const base = {
    workspaceId: WS.id,
    workspaceServ: { get: () => WS, list: () => [WS] },
    github: {
      createWorktree: vi.fn(async () => ({ ok: true, message: 'created' })),
      removeWorktree: vi.fn(async () => ({ ok: true, message: 'removed' }))
    },
    background: {
      list: () => [{ id: 'job-1', workspaceId: WS.id, status: 'running' }],
      getOutput: (jobId: string) => ({ jobId, startSequence: 0, lines: ['build ok'] })
    },
    fileSystem: {},
    webPreview: { emitPreview: vi.fn() },
    worktree: new WorktreeEventBus()
  }
  return { ...(base as unknown as ToolContext), ...overrides }
}

describe('tool registry', () => {
  test('registers oxespace_get_job_output as a workspace-scoped tool', () => {
    const entry = TOOL_REGISTRY.find((e) => e.descriptor.name === 'oxespace_get_job_output')
    expect(entry).toBeDefined()
    expect(entry?.requiresWorkspace).toBe(true)
  })

  test('registers the post-diff quality controller as a workspace tool', () => {
    const entry = TOOL_REGISTRY.find((e) => e.descriptor.name === 'oxespace_quality_check')
    expect(entry?.requiresWorkspace).toBe(true)
    expect(entry?.descriptor.description).toContain('Post-diff')
  })
})

describe('get_job_output handler', () => {
  test('returns the buffered output for a job owned by the workspace', async () => {
    const ctx = makeCtx()
    const result = await handlers.getJobOutput({ jobId: 'job-1' }, ctx)
    expect(result.isError).toBeUndefined()
    expect(result.content[0].text).toContain('build ok')
    expect(result.content[0].text).toContain('"jobId": "job-1"')
  })

  test('refuses a jobId that does not belong to this workspace', async () => {
    const ctx = makeCtx()
    const result = await handlers.getJobOutput({ jobId: 'other-job' }, ctx)
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('not found in this workspace')
  })

  test('rejects a missing jobId argument', async () => {
    // Inline validation throws; the local-rpc-server's dispatch catch converts
    // the throw into an MCP isError payload (see dispatchRpc try/catch).
    const ctx = makeCtx()
    await expect(handlers.getJobOutput({}, ctx)).rejects.toThrow('jobId')
  })
})

describe('worktree handlers emit change events', () => {
  test('createWorktree emits a "created" event with the workspace rootPath', async () => {
    const ctx = makeCtx()
    const events: InternalMcpWorktreeChangedEvent[] = []
    ctx.worktree.subscribe((e) => events.push(e))
    await handlers.createWorktree({ path: '../wt', branch: 'feature/x', createBranch: true }, ctx)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ workspaceId: WS.id, rootPath: WS.rootPath, action: 'created' })
    expect(ctx.github.createWorktree).toHaveBeenCalledWith({
      rootPath: WS.rootPath,
      path: '../wt',
      branch: 'feature/x',
      createBranch: true
    })
  })

  test('removeWorktree emits a "removed" event', async () => {
    const ctx = makeCtx()
    const events: InternalMcpWorktreeChangedEvent[] = []
    ctx.worktree.subscribe((e) => events.push(e))
    await handlers.removeWorktree({ path: '../wt' }, ctx)
    expect(events).toHaveLength(1)
    expect(events[0].action).toBe('removed')
  })

  test('does not emit when the git call throws', async () => {
    const ctx = makeCtx({
      github: { createWorktree: vi.fn(async () => { throw new Error('exists') }) } as unknown as ToolContext['github']
    })
    const events: InternalMcpWorktreeChangedEvent[] = []
    ctx.worktree.subscribe((e) => events.push(e))
    await expect(handlers.createWorktree({ path: '../wt', branch: 'x' }, ctx)).rejects.toThrow('exists')
    expect(events).toHaveLength(0)
  })
})
