import { describe, expect, test, vi } from 'vitest'
import { openInMemoryDatabase } from '../../../electron/main/db/index'
import { AGENT_CHANGE_TOOLS, AGENT_READ_TOOLS, _resetAgentOwnersForTests } from '../../../electron/main/mcp-internal/agent-tools'
import type { ToolContext } from '../../../electron/main/mcp-internal/tool-registry'
import { AgentActions } from '../../../electron/main/services/agent-actions/agent-actions'
import { ApprovalBroker } from '../../../electron/main/services/agent-actions/approval-broker'
import { AgentLaunchService, SUPPORTED_AGENT_PROVIDERS } from '../../../electron/main/services/agent-launch.service'
import { PaneBusService } from '../../../electron/main/services/agent-state/pane-bus.service'
import type { AgentProfile } from '../../../shared/types/agent'
import type { AgentLifecycleState, PaneAgentState } from '../../../shared/types/agent-state'

describe('OXE-445 A5 · Multi-provider start/resolve and persistent SQLite pane_agent_owners', () => {
  test('supports configured providers (antigravity, claude, codex, copilot, cursor, grok) in start and AgentLaunchService and persists ownership in SQLite pane_agent_owners', async () => {
    const expectedProviders = ['antigravity', 'claude', 'codex', 'copilot', 'cursor', 'grok'] as const
    for (const provider of expectedProviders) {
      expect(SUPPORTED_AGENT_PROVIDERS).toContain(provider)
    }

    const profiles: AgentProfile[] = expectedProviders.map((provider) => ({
      agentProfileId: `prof-${provider}`,
      provider,
      name: provider,
      command: provider === 'antigravity' ? 'agy' : provider,
      isBuiltIn: true
    } as AgentProfile))

    // 1. AgentLaunchService.resolve supports all 6 configured providers.
    const launcher = new AgentLaunchService({} as never, () => profiles, '/userData')
    for (const provider of expectedProviders) {
      const resolved = launcher.resolve(`prof-${provider}`)
      expect(resolved.provider).toBe(provider)
      expect(resolved.executable).toBe(provider === 'antigravity' ? 'agy' : provider)
    }

    // 2. Starting an Antigravity helper persists ownership in SQLite pane_agent_owners.
    const db = openInMemoryDatabase()
    const bus = new PaneBusService(db)
    try {
      const workspace = {
        id: 'ws-multi',
        name: 'Multi',
        rootPath: '/repo',
        isActive: true,
        panes: [{ id: 'pane-caller', displayName: 'Caller', status: 'running', rowIndex: 0, columnIndex: 0 }] as Array<Record<string, unknown>>
      }
      const states = new Map<string, PaneAgentState>()
      const asked: unknown[] = []
      const submit = vi.fn(async () => true)
      const start = vi.fn(async (input: { paneId: string }) => {
        states.set(input.paneId, {
          paneId: input.paneId,
          workspaceId: 'ws-multi',
          agent: 'antigravity',
          state: 'idle',
          source: 'screen',
          seen: true,
          since: 1,
          stateChangeSeq: 1,
          completionSeq: 0
        })
      })
      const execution = { id: 'exec-owner', paneId: 'pane-caller', owner: { kind: 'pane', id: 'pane-caller' }, workspaceId: 'ws-multi', canonicalRoot: '/repo', cwd: '/repo' }
      const ctx = {
        db,
        workspaceId: 'ws-multi',
        executionId: 'exec-owner',
        executionToken: 'tok',
        workspaceServ: { get: (id: string) => (id === 'ws-multi' ? workspace : null), list: () => [workspace] },
        executions: { authenticate: () => execution },
        agentActions: new AgentActions({ broker: new ApprovalBroker({ ask: async (req) => { asked.push(req); return 'allow-once' } }, Date.now, 50) }),
        app: {
          agents: {
            bus,
            state: {
              list: () => [...states.values()],
              get: (id: string) => states.get(id) ?? null,
              explain: () => ({ state: null, hook: null, screen: null, pendingIdle: false }),
              waitFor: vi.fn(async (id: string, until: AgentLifecycleState[]) => ({ state: states.get(id) ?? null, timedOut: !until.includes(states.get(id)?.state ?? 'unknown') }))
            },
            terminal: { peek: () => ({ running: true, data: '', altScreen: false }), submit, interrupt: vi.fn(async () => true), start, stop: vi.fn() },
            profiles: () => profiles,
            resolve: (id: string) => launcher.resolve(id),
            mcpArgs: () => [],
            createPane: () => {
              const created = { id: 'pane-agy-helper', displayName: 'Helper', status: 'running', agentProfileId: 'prof-antigravity', rowIndex: 0, columnIndex: 1 }
              workspace.panes.push(created)
              return { workspace, paneId: created.id }
            },
            setPaneAgent: () => workspace,
            closePane: () => workspace,
            workspaceChanged: vi.fn()
          }
        }
      } as unknown as ToolContext

      const changeTool = AGENT_CHANGE_TOOLS.find((t) => t.descriptor.name === 'oxespace_agents_change')!
      const readTool = AGENT_READ_TOOLS.find((t) => t.descriptor.name === 'oxespace_agents')!

      const started = JSON.parse((await changeTool.handler({ action: 'start', agent: 'antigravity', name: 'Helper' }, ctx)).content[0].text) as { ok: boolean; result?: { paneId: string } }
      expect(started).toMatchObject({ ok: true, result: { paneId: 'pane-agy-helper' } })
      expect(start).toHaveBeenCalledWith(expect.objectContaining({
        paneId: 'pane-agy-helper',
        launch: expect.objectContaining({ executable: 'agy' })
      }))

      // Clear in-memory owners cache completely: ownership MUST survive via SQLite pane_agent_owners.
      _resetAgentOwnersForTests()

      const listed = JSON.parse((await readTool.handler({ action: 'list' }, ctx)).content[0].text) as {
        ok: boolean
        result: Array<{ paneId: string; startedByYou: boolean; provider: string }>
      }
      expect(listed.ok).toBe(true)
      expect(listed.result).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ paneId: 'pane-agy-helper', provider: 'antigravity', startedByYou: true })
        ])
      )

      // Prompting the owned pane succeeds without triggering a human confirmation prompt.
      const prompted = JSON.parse((await changeTool.handler({ action: 'prompt', paneId: 'pane-agy-helper', text: 'Run checks' }, ctx)).content[0].text) as { ok: boolean }
      expect(prompted.ok).toBe(true)
      expect(asked).toHaveLength(0)
      expect(submit).toHaveBeenCalledWith('pane-agy-helper', 'Run checks')
    } finally {
      db.close()
    }
  })
})
