/**
 * H2 (FINDING on #243) · Closing a pane withdraws every internal-MCP confirm its execution is still asking, through
 * the same chain the app runs: `workspace:close-pane` → the terminal lifecycle stops the pane's PTY → onLaunchExit ends
 * the pane's execution (index.ts) → the internal MCP's ApprovalBroker cancels that execution's asks → the approval center
 * records each one as cancelled and closes its native dialog. The other pane's asks stay.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createFakeIpcMain, type FakeIpcMain } from '../helpers/fake-ipc-main'
import type { ApprovalRequest } from '../../shared/types/approvals'

const ipcMain: FakeIpcMain = createFakeIpcMain()
vi.mock('electron', () => ({
  ipcMain, app: { getPath: () => '' }, Notification: { isSupported: () => false },
  BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null }, dialog: { showOpenDialog: vi.fn() }
}))

const { openInMemoryDatabase } = await import('../../electron/main/db/index')
const { WorkspaceService } = await import('../../electron/main/services/workspace.service')
const { RtkService } = await import('../../electron/main/services/rtk.service')
const { TerminalManager } = await import('../../electron/main/services/terminal.service')
const { registerWorkspaceIpc } = await import('../../electron/main/ipc/workspace.ipc')
const { ExecutionRegistry } = await import('../../electron/main/services/execution-registry')
const { ApprovalBroker } = await import('../../electron/main/services/agent-actions/approval-broker')
const { centerApprovalPrompter } = await import('../../electron/main/services/agent-actions/approval-prompter')
const { AgentActions } = await import('../../electron/main/services/agent-actions/agent-actions')
const { ApprovalCenter } = await import('../../electron/main/services/approvals/approval-center')
const { APP_MANAGE_TOOLS } = await import('../../electron/main/mcp-internal/app-manage-tools')

beforeEach(() => { vi.spyOn(RtkService.prototype, 'ensureRtk').mockResolvedValue('/test/rtk/bin') })
afterEach(() => { vi.restoreAllMocks() })

function fakePtys() {
  const envs: Array<Record<string, string>> = []
  return {
    envs,
    spawn: vi.fn((_file: string, _args: string[], options: { env: Record<string, string> }) => {
      envs.push(options.env)
      return { pid: 1, write: vi.fn(), resize: vi.fn(), kill: vi.fn(), onData: vi.fn(() => ({ dispose: vi.fn() })), onExit: vi.fn(() => ({ dispose: vi.fn() })) }
    })
  }
}

describe('H2 · closing a pane withdraws its pending internal-MCP confirms', () => {
  test('workspace:close-pane cancels the closed pane\'s 25 asks (native dialog included) and keeps the other pane\'s 25', async () => {
    const db = openInMemoryDatabase()
    const nativeSignals: AbortSignal[] = []
    const center = new ApprovalCenter({
      send: () => {}, hasWindow: () => true,
      // HML's double: a system dialog nobody answers, closed only by its signal.
      native: (_request: ApprovalRequest, _reason, signal) => new Promise<string | null>(() => { nativeSignals.push(signal) })
    })
    const executions = new ExecutionRegistry()
    const broker = new ApprovalBroker(centerApprovalPrompter(center), Date.now, 20)
    const pty = fakePtys()
    // The same two hooks index.ts gives the terminal manager.
    const terminal = new TerminalManager(db, {
      pty, platform: 'linux',
      executionEnvironment: input => executions.register(input),
      onLaunchExit: paneId => executions.end(paneId)
    } as never)
    const workspaces = new WorkspaceService(db)
    registerWorkspaceIpc(db, { watchWorkspace: vi.fn(), unwatchWorkspace: vi.fn() } as never, terminal, { workspaceService: workspaces })
    try {
      const workspace = workspaces.create({ rootPath: 'C:/repo', layout: '1x2', autoStart: false })
      const [paneA, paneB] = workspace.panes
      await terminal.start({ workspaceId: workspace.id, paneId: paneA.id, disableRtk: true })
      await terminal.start({ workspaceId: workspace.id, paneId: paneB.id, disableRtk: true })
      const [envA, envB] = pty.envs
      expect(envA.OXESPACE_EXECUTION_ID).not.toBe(envB.OXESPACE_EXECUTION_ID)

      const skills = APP_MANAGE_TOOLS.find(tool => tool.descriptor.name === 'oxespace_skills_change')!
      const agentActions = new AgentActions({ broker, ratePerMinute: 1_000 })
      const call = (env: Record<string, string>, name: string) => skills.handler({ action: 'create', name, description: 'acceptance', body: 'never approved' }, {
        executions, executionId: env.OXESPACE_EXECUTION_ID, executionToken: env.OXESPACE_EXECUTION_TOKEN, workspaceId: env.OXESPACE_WORKSPACE_ID, agentActions, workspaceServ: workspaces
      } as never)
      const replies = await Promise.all([
        ...Array.from({ length: 25 }, (_, i) => call(envA, `acc-a-${i}`)),
        ...Array.from({ length: 25 }, (_, i) => call(envB, `acc-b-${i}`))
      ])
      expect(replies.every(reply => JSON.stringify(reply).includes('approval-pending'))).toBe(true)
      expect(center.list()).toHaveLength(50)
      // Every one of them is also in a native dialog, the worst case for withdrawing.
      for (const request of center.list()) center.unavailable({ id: request.id, generation: request.generation })
      expect(nativeSignals).toHaveLength(50)

      await ipcMain.invoke('workspace:close-pane', paneB.id)
      await new Promise(resolve => setTimeout(resolve, 0))

      const cancelled = center.history().filter(entry => entry.by === 'cancelled')
      expect(cancelled).toHaveLength(25)
      expect(cancelled.every(entry => entry.requester.id === `pane:${paneB.id}`)).toBe(true)
      expect(nativeSignals.filter(signal => signal.aborted)).toHaveLength(25)
      // The other pane's asks are untouched: still open, their dialogs too.
      expect(center.history()).toHaveLength(25)
      expect(nativeSignals.filter(signal => !signal.aborted)).toHaveLength(25)
    } finally { terminal.stopAll(); db.close() }
  })
})
