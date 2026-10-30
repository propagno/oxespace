import { describe, expect, it, vi } from 'vitest'
import { createOxeApi, type PreloadIpc } from '../electron/preload/api'
import { MCP_COVERAGE } from '../shared/mcp-coverage'
import { IPC_CHANNELS } from '../shared/types/ipc'
import { TERMINAL_PRESENCE_STATES } from '../shared/types/ipc/terminal'

describe('terminal presence contract (B2.3)', () => {
  it('names the three states and a stable, window-only channel', () => {
    expect(TERMINAL_PRESENCE_STATES).toEqual(['focused', 'visible', 'hidden'])
    expect(IPC_CHANNELS.terminal.setPresence).toBe('terminal:set-presence')
    const input = MCP_COVERAGE['code.terminal_input']
    expect('excluded' in input && !('tools' in input)).toBe(true)
    expect(input.ipc).toContain('terminal.setPresence')
  })

  it('sends presence through the preload', async () => {
    const ipc: PreloadIpc = { invoke: vi.fn().mockResolvedValue(undefined), on: vi.fn(), removeListener: vi.fn() }
    await createOxeApi(ipc).terminal.setPresence!({ paneId: 'pane-1', state: 'hidden' })
    expect(ipc.invoke).toHaveBeenCalledWith(IPC_CHANNELS.terminal.setPresence, { paneId: 'pane-1', state: 'hidden' })
  })
})
