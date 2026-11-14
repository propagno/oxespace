import { describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
vi.mock('electron', () => ({ clipboard: {}, ipcMain: { handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => { handlers.set(channel, handler) } } }))

describe('clipboard:edit, the Edit menu\'s command on the focused field', () => {
  it('runs the six editing commands on the window that asked and nothing else', async () => {
    const { registerEditCommandIpc } = await import('../../electron/main/ipc/clipboard.ipc')
    const { EDIT_COMMANDS, IPC_CHANNELS } = await import('../../shared/types/ipc')
    registerEditCommandIpc()
    const handler = handlers.get(IPC_CHANNELS.clipboard.edit)!
    const sender = { undo: vi.fn(), redo: vi.fn(), cut: vi.fn(), copy: vi.fn(), paste: vi.fn(), selectAll: vi.fn(), reload: vi.fn(), openDevTools: vi.fn(), executeJavaScript: vi.fn() }
    for (const command of EDIT_COMMANDS) {
      expect(handler({ sender }, command)).toBe(true)
      expect(sender[command]).toHaveBeenCalledTimes(1)
    }
    // A method of the window that is not an editing command is never reached through this channel.
    for (const other of ['reload', 'openDevTools', 'executeJavaScript', 'constructor', '', undefined, 3, { command: 'paste' }]) expect(handler({ sender }, other)).toBe(false)
    expect(sender.reload).not.toHaveBeenCalled()
    expect(sender.openDevTools).not.toHaveBeenCalled()
    expect(sender.executeJavaScript).not.toHaveBeenCalled()
  })
})
