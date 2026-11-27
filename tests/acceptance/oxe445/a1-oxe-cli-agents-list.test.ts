import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createLocalRpcServer } from '../../../electron/main/mcp-internal/local-rpc-server'
import { ExecutionRegistry } from '../../../electron/main/services/execution-registry'
import { AgentActions } from '../../../electron/main/services/agent-actions/agent-actions'
import type { PaneAgentState } from '../../../shared/types/agent-state'

const execFileAsync = promisify(execFile)
const CLI_PATH = resolve(process.cwd(), 'resources/mcp-bridge/oxe-cli.cjs')

function runCli(args: string[], env: Record<string, string>) {
  return execFileAsync(process.execPath, [CLI_PATH, ...args], {
    env: { PATH: process.env.PATH ?? '', ...env },
    timeout: 10_000
  })
}

describe('OXE-445 A1 · Local oxe CLI cross-provider discovery over 127.0.0.1 RPC', () => {
  const servers: Array<ReturnType<typeof createLocalRpcServer>> = []

  afterEach(async () => {
    while (servers.length) {
      await servers.pop()!.stop().catch(() => undefined)
    }
  })

  test('oxe CLI lists active multi-provider panes in JSON via local-rpc-server using env vars only', async () => {
    const executions = new ExecutionRegistry()
    const workspace = {
      id: 'ws-cli-1',
      name: 'OXESpace',
      rootPath: process.cwd(),
      isActive: true,
      panes: [
        { id: 'pane-agy', displayName: 'Antigravity', status: 'running', agentProfileId: 'prof-agy', rowIndex: 0, columnIndex: 0 },
        { id: 'pane-claude', displayName: 'Claude Reviewer', status: 'running', agentProfileId: 'prof-claude', rowIndex: 0, columnIndex: 1 }
      ]
    }
    const emptyWorkspace = { id: 'ws-empty', name: 'Empty', rootPath: process.cwd(), isActive: false, panes: [] }
    const states: PaneAgentState[] = [
      { paneId: 'pane-claude', workspaceId: 'ws-cli-1', agent: 'claude', state: 'idle', source: 'hook', seen: true, since: 1, stateChangeSeq: 1, completionSeq: 0 }
    ]

    const server = createLocalRpcServer({
      executions,
      agentActions: new AgentActions(),
      workspaceServ: {
        get: (id: string) => (id === workspace.id ? workspace : id === emptyWorkspace.id ? emptyWorkspace : null),
        list: () => [workspace, emptyWorkspace]
      } as never,
      github: {} as never,
      background: {} as never,
      fileSystem: {} as never,
      webPreview: {} as never,
      worktree: {} as never,
      app: {
        agents: {
          state: {
            list: (wsId?: string) => states.filter((s) => !wsId || s.workspaceId === wsId),
            get: (id: string) => states.find((s) => s.paneId === id) ?? null,
            explain: () => ({ state: null, hook: null, screen: null, pendingIdle: false }),
            waitFor: vi.fn(async () => ({ state: null, timedOut: false })),
            agentOf: (id: string) => (id === 'pane-agy' ? 'antigravity' : id === 'pane-claude' ? 'claude' : null)
          },
          terminal: {
            peek: (id: string) => (id === 'pane-agy' || id === 'pane-claude' ? { running: true, data: '', altScreen: false } : null),
            submit: vi.fn(async () => true),
            interrupt: vi.fn(async () => true),
            start: vi.fn(async () => undefined),
            stop: vi.fn()
          },
          profiles: () => [
            { agentProfileId: 'prof-agy', provider: 'antigravity', name: 'Antigravity', command: 'agy' },
            { agentProfileId: 'prof-claude', provider: 'claude', name: 'Claude', command: 'claude' }
          ] as never,
          resolve: () => ({ executable: 'claude', provider: 'claude' }),
          mcpArgs: () => [],
          createPane: vi.fn() as never,
          setPaneAgent: vi.fn() as never,
          closePane: vi.fn() as never,
          workspaceChanged: vi.fn()
        }
      }
    })
    servers.push(server)
    const mcpToken = 'oxe-mcp-secret-token-for-test-only'
    server.setToken(mcpToken)
    const { port } = await server.start(0)
    const execEnv = executions.register({ paneId: 'pane-agy', workspaceId: workspace.id, cwd: workspace.rootPath })

    const { stdout } = await runCli(['agents', 'list', '--json'], {
      OXESPACE_MCP_PORT: String(port),
      OXESPACE_MCP_TOKEN: mcpToken,
      ...execEnv
    })

    expect(stdout).not.toContain(mcpToken)
    expect(stdout).not.toContain(execEnv.OXESPACE_EXECUTION_TOKEN)

    const parsed = JSON.parse(stdout) as Array<{ paneId: string; provider: string; state: string; workspaceId: string }>
    expect(parsed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ paneId: 'pane-claude', provider: 'claude', state: 'idle', workspaceId: 'ws-cli-1' }),
        expect.objectContaining({ paneId: 'pane-agy', provider: 'antigravity', workspaceId: 'ws-cli-1' })
      ])
    )

    // Edge A1.e1: empty workspace returns [] cleanly.
    const emptyExecEnv = executions.register({ paneId: 'pane-empty', workspaceId: emptyWorkspace.id, cwd: emptyWorkspace.rootPath })
    const emptyRes = await runCli(['--json', 'agents', 'list'], {
      OXESPACE_MCP_PORT: String(port),
      OXESPACE_MCP_TOKEN: mcpToken,
      ...emptyExecEnv
    })
    expect(JSON.parse(emptyRes.stdout)).toEqual([])
  })

  test('oxe CLI rejects token flags in argv and fails cleanly when OXESPACE_MCP_PORT or TOKEN is missing', async () => {
    await expect(
      runCli(['agents', 'list', '--token', 'leaked-token-in-argv'], {
        OXESPACE_MCP_PORT: '12345',
        OXESPACE_MCP_TOKEN: 'env-token'
      })
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringMatching(/environment|argv|token/i)
    })

    await expect(
      runCli(['agents', 'list', '--json'], {})
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringMatching(/OXESPACE_MCP_PORT|OXESPACE_MCP_TOKEN/i)
    })
  })
})
