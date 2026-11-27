import { describe, expect, test, vi } from 'vitest'
import { AGENT_READ_TOOLS } from '../../../electron/main/mcp-internal/agent-tools'
import type { ToolContext } from '../../../electron/main/mcp-internal/tool-registry'
import { fenceUntrusted } from '../../../electron/main/mcp-internal/untrusted-output'
import { AgentActions } from '../../../electron/main/services/agent-actions/agent-actions'
import { AgentStateService } from '../../../electron/main/services/agent-state/agent-state.service'

describe('OXE-445 A4 · ScreenMirror (@xterm/headless) clean TUI read with redaction and fencing', () => {
  test('oxespace_agents.read renders altScreen cursor-addressed UTF-8 TUI via PaneScreen, masks secrets, and applies fenceUntrusted', async () => {
    const workspace = {
      id: 'ws-screen',
      name: 'ScreenRepo',
      rootPath: '/repo',
      isActive: true,
      panes: [
        { id: 'caller', displayName: 'Caller', status: 'running', rowIndex: 0, columnIndex: 0 },
        { id: 'tui-pane', displayName: 'Antigravity TUI', status: 'running', agentProfileId: 'prof-agy', rowIndex: 0, columnIndex: 1 }
      ]
    }

    // Cursor-addressed alt-screen frame: writes row 3 first, then row 1, then overwrites part of row 2.
    const ansiFrame =
      '\x1b[?1049h' +
      '\x1b[3;1Htoken=supersecret999' +
      '\x1b[1;1HHeader Café ✨' +
      '\x1b[2;1HStatus: pending' +
      '\x1b[2;9Hready  '

    const stateService = new AgentStateService({
      manifests: () => new Map(),
      emit: vi.fn()
    })
    stateService.start('tui-pane', 'ws-screen', 80, 24, 'agy')

    const execution = { id: 'exec-caller', paneId: 'caller', owner: { kind: 'pane', id: 'caller' }, workspaceId: 'ws-screen', canonicalRoot: '/repo', cwd: '/repo' }
    const ctx = {
      workspaceId: 'ws-screen',
      executionId: 'exec-caller',
      executionToken: 'tok',
      workspaceServ: { get: (id: string) => (id === 'ws-screen' ? workspace : null), list: () => [workspace] },
      executions: { authenticate: () => execution },
      agentActions: new AgentActions(),
      app: {
        agents: {
          state: stateService,
          terminal: {
            peek: (id: string) => (id === 'tui-pane' ? { running: true, altScreen: true, data: ansiFrame } : null),
            submit: vi.fn(async () => true),
            interrupt: vi.fn(async () => true),
            start: vi.fn(async () => undefined),
            stop: vi.fn()
          },
          profiles: () => [{ agentProfileId: 'prof-agy', provider: 'antigravity', name: 'Antigravity', command: 'agy' }],
          resolve: () => ({ executable: 'agy', provider: 'antigravity' }),
          mcpArgs: () => [],
          createPane: vi.fn(),
          setPaneAgent: vi.fn(),
          closePane: vi.fn(),
          workspaceChanged: vi.fn()
        }
      }
    } as unknown as ToolContext

    const tool = AGENT_READ_TOOLS.find((t) => t.descriptor.name === 'oxespace_agents')!
    const args = { action: 'read', paneId: 'tui-pane', mode: 'auto' }
    const fenced = fenceUntrusted('oxespace_agents', args, await tool.handler(args, ctx))
    const rawText = fenced.content[0].text

    expect(rawText).toContain('[untrusted data from another agent\'s terminal:')
    expect(rawText).toContain('[end of untrusted data]')
    expect(rawText).not.toContain('supersecret999')

    const parsed = JSON.parse(rawText.slice(rawText.indexOf('{'), rawText.lastIndexOf('}') + 1)) as {
      ok: boolean
      result: { running: boolean; altScreen: boolean; mode: string; text: string }
    }
    expect(parsed.ok).toBe(true)
    expect(parsed.result.running).toBe(true)
    expect(parsed.result.altScreen).toBe(true)
    expect(parsed.result.mode).toBe('screen')

    // PaneScreen must place Row 1 above Row 2 ("ready", not "pendingready") above Row 3 (masked token).
    const lines = parsed.result.text.split('\n')
    expect(lines[0]).toContain('Header Café ✨')
    expect(lines[1]).toContain('Status: ready')
    expect(lines[1]).not.toContain('pending')
    expect(lines[2]).toContain('token=***')
  })
})
