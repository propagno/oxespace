// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

/**
 * B10 · The approval center lives outside the main entry and loads on first use. The very first request, before
 * anything else imported the center, must still reach the window.
 */
const send = vi.fn()
const showMessageBox = vi.fn(async () => { throw new Error('a native dialog opened while the app window exists') })
vi.mock('electron', () => ({
  app: { isReady: () => true, getLocale: () => 'en' },
  BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { isDestroyed: () => false, isCrashed: () => false, send } }], getFocusedWindow: () => null },
  dialog: { showMessageBox }
}))
vi.mock('electron-log/main.js', () => ({ default: { warn: vi.fn() } }))

describe('the first approval request (B10)', () => {
  it('awaits the center\'s import and reaches the window', async () => {
    const { appApprovalPrompter } = await import('../../electron/main/services/agent-actions/approval-prompter')
    const { ApprovalBroker } = await import('../../electron/main/services/agent-actions/approval-broker')
    const { AgentActions } = await import('../../electron/main/services/agent-actions/agent-actions')
    const actions = new AgentActions({ broker: new ApprovalBroker(appApprovalPrompter, Date.now, 5_000) })
    const result = actions.run({ key: 'first', label: 'pane:p1', workspaceId: 'w1', authenticated: true }, { tool: 'oxespace_git_change', action: 'push', level: 'confirm', target: '/repo', text: 'git push' }, async () => 'pushed')
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith('approvals:requested', expect.objectContaining({ kind: 'mcp-confirm' })))
    const request = send.mock.calls.find(([channel]) => channel === 'approvals:requested')![1] as { id: string; generation: number }
    const { approvalCenter } = await import('../../electron/main/services/approvals')
    expect(approvalCenter.respond({ id: request.id, generation: request.generation, optionId: 'allow-once' })).toMatchObject({ ok: true })
    await expect(result).resolves.toBe('pushed')
    expect(showMessageBox).not.toHaveBeenCalled()
  })
})
