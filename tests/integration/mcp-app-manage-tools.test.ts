import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import type { ToolContext } from '../../electron/main/mcp-internal/tool-registry'
import { APP_MANAGE_TOOLS, APP_MANAGE_TOOL_NAMES } from '../../electron/main/mcp-internal/app-manage-tools'
import { AgentActions } from '../../electron/main/services/agent-actions/agent-actions'
import { ApprovalBroker, type ApprovalDecision, type ApprovalRequest } from '../../electron/main/services/agent-actions/approval-broker'
import { THREAD_MCP_TOOLS, THREAD_READ_ONLY_MCP_TOOLS } from '../../electron/main/services/conversation/thread-mcp'

const WS = { id: 'ws-1', rootPath: '/repo', name: 'repo', isActive: true, panes: [] }

function setup(app: ToolContext['app'], options: { decide?: ApprovalDecision; owner?: { kind: 'pane' | 'thread'; id: string }; workspaceId?: string; semantic?: unknown } = {}) {
  const asked: ApprovalRequest[] = []
  const broker = new ApprovalBroker({ ask: async request => { asked.push(request); return options.decide ?? 'allow-once' } }, Date.now, 50)
  const execution = { id: 'e1', owner: options.owner ?? { kind: 'pane', id: 'p1' }, workspaceId: options.workspaceId ?? WS.id, canonicalRoot: '/repo', cwd: '/repo' }
  const ctx = {
    workspaceId: execution.workspaceId, executionId: 'e1', executionToken: 't',
    workspaceServ: { get: (id: string) => id === WS.id ? WS : null, list: () => [WS] },
    executions: { authenticate: () => execution }, agentActions: new AgentActions({ broker }), app, semantic: options.semantic
  } as unknown as ToolContext
  return { asked, ctx }
}

async function call(name: string, args: Record<string, unknown>, ctx: ToolContext) {
  const result = await APP_MANAGE_TOOLS.find(tool => tool.descriptor.name === name)!.handler(args, ctx)
  return JSON.parse(result.content[0].text) as { ok: boolean; code?: string; result?: unknown }
}

describe('manage tools', () => {
  it('are offered to normal Threads only and never retried by the bridge', () => {
    const block = /const READ_ONLY_TOOLS = new Set\(\[([\s\S]*?)\]\)/.exec(readFileSync('resources/mcp-bridge/oxespace-mcp.cjs', 'utf8'))![1]
    for (const name of APP_MANAGE_TOOL_NAMES) {
      expect(THREAD_MCP_TOOLS).toContain(name)
      expect(THREAD_READ_ONLY_MCP_TOOLS).not.toContain(name)
      expect(block).not.toContain(`'${name}'`)
    }
  })
})

describe('oxespace_skills_change', () => {
  it('shows the whole skill before saving it, in this project', async () => {
    const skills = { createSkill: vi.fn(input => ({ name: input.name, filePath: '/repo/.oxe/skills/x.md', source: 'workspace' })), listSkills: vi.fn() }
    const { asked, ctx } = setup({ skills } as never)
    expect(await call('oxespace_skills_change', { action: 'create', name: 'review-sql', description: 'Review SQL', body: 'Check indexes.' }, ctx)).toMatchObject({ ok: true })
    expect(asked[0].text).toBe('/review-sql — Review SQL\n\nCheck indexes.')
    expect(skills.createSkill).toHaveBeenCalledWith(expect.objectContaining({ scope: 'workspace', workspaceRootPath: '/repo' }))
    const denied = setup({ skills } as never, { decide: 'deny' })
    skills.createSkill.mockClear()
    expect(await call('oxespace_skills_change', { action: 'create', name: 'x', description: 'x', body: 'x' }, denied.ctx)).toMatchObject({ ok: false, code: 'denied' })
    expect(skills.createSkill).not.toHaveBeenCalled()
  })
})

describe('oxespace_automations_change', () => {
  const existing = [{ id: 'a1', name: 'Nightly', rootPath: '/repo', agent: 'claude', prompt: 'Fix flaky tests', schedule: { kind: 'daily', hour: 2, minute: 0 } }, { id: 'a2', name: 'Other', rootPath: '/elsewhere', agent: 'codex', prompt: 'x', schedule: { kind: 'interval', everyMinutes: 60 } }]
  const make = () => ({ list: vi.fn(() => existing), create: vi.fn(input => input), setEnabled: vi.fn(), remove: vi.fn(), runNow: vi.fn(), runs: vi.fn() })

  it('schedules in this project only, ignores extra CLI arguments and shows prompt and schedule', async () => {
    const service = make()
    const { asked, ctx } = setup({ automations: () => service } as never)
    const result = await call('oxespace_automations_change', { action: 'create', name: 'Deps', prompt: 'Update deps', agent: 'codex', schedule: { kind: 'weekly', days: [1], hour: 9, minute: 30 }, rootPath: '/etc', extraArgs: '--dangerously-bypass-approvals-and-sandbox' }, ctx)
    expect(result).toMatchObject({ ok: true, result: { rootPath: '/repo', extraArgs: '' } })
    expect(asked[0].text).toBe('codex in /repo, on days 1 (0 = Sunday) at 09:30\n\nUpdate deps')
  })

  it('turns off without asking, asks to turn on, and refuses another project\'s automation', async () => {
    const service = make()
    const { asked, ctx } = setup({ automations: () => service } as never)
    expect(await call('oxespace_automations_change', { action: 'disable', automationId: 'a1' }, ctx)).toMatchObject({ ok: true })
    expect(asked).toHaveLength(0)
    expect(await call('oxespace_automations_change', { action: 'enable', automationId: 'a1' }, ctx)).toMatchObject({ ok: true })
    expect(asked[0].text).toBe('claude, every day at 02:00\n\nFix flaky tests')
    expect(await call('oxespace_automations_change', { action: 'run_now', automationId: 'a2' }, ctx)).toMatchObject({ ok: false, code: 'not-found' })
  })
})

describe('oxespace_workspace_change', () => {
  it('notifies, and reindexes only a Code workspace', async () => {
    const notify = vi.fn(() => true)
    const semantic = { reindex: vi.fn(() => ({ indexing: true, enabled: true })) }
    expect(await call('oxespace_workspace_change', { action: 'notify', title: 'Build\ndone', body: 'All green' }, setup({ notify } as never).ctx)).toMatchObject({ ok: true, result: { shown: true } })
    expect(notify).toHaveBeenCalledWith('Build done', 'All green')
    expect(await call('oxespace_workspace_change', { action: 'reindex' }, setup({} as never, { semantic }).ctx)).toMatchObject({ ok: true, result: { indexing: true } })
    expect(await call('oxespace_workspace_change', { action: 'reindex' }, setup({} as never, { semantic, owner: { kind: 'thread', id: 't' }, workspaceId: 'thread:p' }).ctx)).toMatchObject({ ok: false, code: 'no-workspace' })
  })
})
