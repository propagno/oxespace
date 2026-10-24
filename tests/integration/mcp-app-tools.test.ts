import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { TOOL_REGISTRY, type ToolContext } from '../../electron/main/mcp-internal/tool-registry'
import { domainTool, resolveScope } from '../../electron/main/mcp-internal/domain-tool'
import { GIT_TOOLS, renderDiff } from '../../electron/main/mcp-internal/git-tools'
import { AgentActions } from '../../electron/main/services/agent-actions/agent-actions'
import { ApprovalBroker, type ApprovalDecision, type ApprovalRequest } from '../../electron/main/services/agent-actions/approval-broker'
import type { ActionAuditRecord } from '../../electron/main/services/agent-actions/action-audit'
import { THREAD_MCP_TOOLS, THREAD_READ_ONLY_MCP_TOOLS } from '../../electron/main/services/conversation/thread-mcp'

const WS = { id: 'ws-1', rootPath: '/repo', name: 'repo', isActive: true }

function context(overrides: Partial<ToolContext> = {}, live = true): ToolContext {
  const execution = { id: 'exec-1', owner: { kind: 'pane', id: 'p1' }, workspaceId: WS.id, canonicalRoot: '/repo/sub', cwd: '/repo/sub' }
  return {
    workspaceId: WS.id,
    workspaceServ: { get: (id: string) => id === WS.id ? WS : null, list: () => [WS] },
    executions: { authenticate: () => { if (!live) throw new Error('no execution'); return execution } },
    executionId: 'exec-1', executionToken: 't',
    ...overrides
  } as unknown as ToolContext
}

function body(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text) as { ok: boolean; code?: string; message?: string; result?: unknown }
}

function harness(decide: ApprovalDecision | 'never' = 'allow-once') {
  const asked: ApprovalRequest[] = []
  const audit: ActionAuditRecord[] = []
  const broker = new ApprovalBroker({ ask: async request => { asked.push(request); return decide === 'never' ? new Promise<ApprovalDecision>(() => {}) : decide } }, Date.now, 50)
  const actions = new AgentActions({ broker, audit: { record: (entry: ActionAuditRecord) => audit.push(entry) } as never })
  const run = vi.fn(async () => 'done')
  const tool = domainTool('oxespace_demo', 'Demo.', {
    look: { level: 'read', description: 'Read.', run },
    change: { level: 'write', description: 'Write.', run },
    ship: { level: 'confirm', description: 'Ship.', confirm: () => ({ summary: 'ship it', text: 'git push origin feat/x' }), run }
  })
  return { asked, audit, run, tool, ctx: (live = true) => context({ agentActions: actions }, live) }
}

describe('domain tools', () => {
  it('take an action enum and no policy flags from the model', () => {
    const { tool } = harness()
    const schema = tool.descriptor.inputSchema as { properties: Record<string, { enum?: string[] }>; additionalProperties: boolean; required: string[] }
    expect(schema.additionalProperties).toBe(false)
    expect(schema.required).toEqual(['action'])
    expect(schema.properties.action.enum).toEqual(['look', 'change', 'ship'])
    for (const entry of [...TOOL_REGISTRY]) {
      const keys = Object.keys((entry.descriptor.inputSchema as { properties?: object }).properties ?? {})
      expect(keys).not.toContain('confirmed')
      expect(keys).not.toContain('approved')
    }
    expect(tool.descriptor.description).toContain('- ship (confirm): Ship. A person approves each call.')
  })

  it('refuse an unknown action', async () => {
    const { tool, ctx } = harness()
    expect(body(await tool.handler({ action: 'nope' }, ctx()))).toMatchObject({ ok: false, code: 'invalid' })
  })

  it('let a caller without a live execution read but not change anything', async () => {
    const { tool, ctx, run } = harness()
    expect(body(await tool.handler({ action: 'look' }, ctx(false)))).toMatchObject({ ok: true, result: 'done' })
    expect(body(await tool.handler({ action: 'change' }, ctx(false)))).toMatchObject({ ok: false, code: 'no-execution' })
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('run writes for a live execution and record them; reads are not recorded', async () => {
    const { tool, ctx, audit } = harness()
    await tool.handler({ action: 'look' }, ctx())
    expect(body(await tool.handler({ action: 'change' }, ctx()))).toMatchObject({ ok: true })
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({ actor: 'pane:p1', tool: 'oxespace_demo', action: 'change', level: 'write', decision: 'auto', outcome: 'ok' })
  })

  it('ask a person before a confirm action and show the exact text', async () => {
    const { tool, ctx, asked, audit } = harness('allow-once')
    expect(body(await tool.handler({ action: 'ship' }, ctx()))).toMatchObject({ ok: true })
    expect(asked[0]).toMatchObject({ summary: 'pane:p1 wants to ship it', text: 'git push origin feat/x', target: '/repo/sub', risk: 'action' })
    expect(audit[0]).toMatchObject({ decision: 'approved', outcome: 'ok' })
  })

  it('report a declined or pending approval without running', async () => {
    const denied = harness('deny')
    expect(body(await denied.tool.handler({ action: 'ship' }, denied.ctx()))).toMatchObject({ ok: false, code: 'denied' })
    const pending = harness('never')
    expect(body(await pending.tool.handler({ action: 'ship' }, pending.ctx()))).toMatchObject({ ok: false, code: 'approval-pending' })
    expect(denied.run).not.toHaveBeenCalled()
    expect(pending.run).not.toHaveBeenCalled()
  })

  it('limit changes per execution', async () => {
    const { tool, ctx } = harness()
    for (let i = 0; i < 30; i++) await tool.handler({ action: 'change' }, ctx())
    expect(body(await tool.handler({ action: 'change' }, ctx()))).toMatchObject({ ok: false, code: 'rate-limited' })
  })

  it('scope a live execution to its own directory, and a generic caller to its workspace', async () => {
    expect(await resolveScope(context())).toMatchObject({ rootPath: '/repo/sub', actor: { label: 'pane:p1', authenticated: true } })
    expect(await resolveScope(context({}, false))).toMatchObject({ rootPath: '/repo', actor: { authenticated: false } })
  })
})

describe('oxespace_git', () => {
  const git = {
    getStatus: vi.fn(async (root: string) => ({ branch: 'main', root })),
    getBranch: vi.fn(async () => ({ branch: 'main', detached: false, shortSha: null })),
    getDiffSummary: vi.fn(async () => ({ files: [] })),
    buildDiff: vi.fn(async () => ({ base: 'HEAD', includeUncommitted: true, compiledAt: 0, files: [
      { path: 'a.ts', additions: 1, deletions: 1, mtime: null, hunks: [{ header: '@@ -1 +1 @@', lines: [{ type: 'removed', content: 'old', oldLineNo: 1, newLineNo: null }, { type: 'added', content: 'new', oldLineNo: null, newLineNo: 1 }] }] }
    ] })),
    getFileAtRef: vi.fn(async () => ({ content: 'x' }))
  }
  const tool = GIT_TOOLS[0]

  it('is registered once and offered to every Thread, including read-only ones', () => {
    expect(TOOL_REGISTRY.filter(entry => entry.descriptor.name === 'oxespace_git')).toHaveLength(1)
    expect(THREAD_MCP_TOOLS).toContain('oxespace_git')
    expect(THREAD_READ_ONLY_MCP_TOOLS).toContain('oxespace_git')
    expect(readFileSync('resources/mcp-bridge/oxespace-mcp.cjs', 'utf8')).toContain("'oxespace_git'")
  })

  it('reads status in the caller\'s directory', async () => {
    expect(body(await tool.handler({ action: 'status' }, context({ git } as never)))).toMatchObject({ ok: true, result: { root: '/repo/sub' } })
  })

  it('renders a diff and refuses an option-like ref', async () => {
    const result = body(await tool.handler({ action: 'diff' }, context({ git } as never)))
    expect(result).toMatchObject({ ok: true, result: { files: 1, omittedFiles: [] } })
    expect((result.result as { text: string }).text).toContain('-old\n+new')
    expect(body(await tool.handler({ action: 'diff', base: '--output=/tmp/x' }, context({ git } as never)))).toMatchObject({ ok: false, code: 'invalid' })
    expect(body(await tool.handler({ action: 'file_at_ref', ref: 'HEAD', path: '../secret' }, context({ git } as never)))).toMatchObject({ ok: false, code: 'invalid' })
  })

  it('lists files that did not fit in the budget', () => {
    const big = { base: 'HEAD', includeUncommitted: true, compiledAt: 0, files: ['a', 'b'].map(path => ({ path, additions: 1, deletions: 0, mtime: null, hunks: [{ header: '@@', lines: [{ type: 'added' as const, content: 'x'.repeat(600), oldLineNo: null, newLineNo: 1 }] }] })) }
    expect(renderDiff(big, 1000)).toMatchObject({ files: 2, omittedFiles: ['b'] })
  })
})

describe('agent action audit', () => {
  it('keeps an append-only, pruned trail', async () => {
    const { openInMemoryDatabase } = await import('../../electron/main/db')
    const { ActionAudit } = await import('../../electron/main/services/agent-actions/action-audit')
    const db = openInMemoryDatabase()
    try {
      let now = 1_000_000_000_000
      const audit = new ActionAudit(db, () => now)
      audit.record({ actor: 'thread:t1', workspaceId: 'w', tool: 'oxespace_git', action: 'commit', level: 'write', text: 'commit', decision: 'auto', outcome: 'ok', durationMs: 3 })
      expect(audit.list()).toMatchObject([{ actor: 'thread:t1', action: 'commit', level: 'write', outcome: 'ok' }])
      expect(() => db.prepare("UPDATE agent_action_audit SET outcome = 'error'").run()).toThrow(/append-only/)
      now += 91 * 86_400_000
      expect(audit.prune()).toBe(1)
    } finally { db.close() }
  })
})
