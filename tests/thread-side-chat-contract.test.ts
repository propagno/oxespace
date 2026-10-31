import { describe, expect, it, vi } from 'vitest'
import { createOxeApi, type PreloadIpc } from '../electron/preload/api'
import { MCP_COVERAGE } from '../shared/mcp-coverage'
import { isMessageCode } from '../shared/messages'
import { IPC_CHANNELS } from '../shared/types/ipc'

describe('side chat contract (B1.2)', () => {
  it('uses stable channels, kept with the window', () => {
    expect([IPC_CHANNELS.thread.sideOpen, IPC_CHANNELS.thread.sideSend, IPC_CHANNELS.thread.sideClose, IPC_CHANNELS.thread.onSideEvent])
      .toEqual(['thread:side-open', 'thread:side-send', 'thread:side-close', 'thread:side-event'])
    const side = MCP_COVERAGE['thread.side_chat']
    expect('excluded' in side && !('tools' in side)).toBe(true)
    expect(side.ipc).toEqual(['thread.sideOpen', 'thread.sideSend', 'thread.sideClose'])
  })

  it('says why a side chat cannot open, as message codes', () => {
    expect(isMessageCode('thread.side.unavailable')).toBe(true)
    expect(isMessageCode('thread.side.noSession')).toBe(true)
  })

  it('exposes the calls through the preload', async () => {
    const ipc: PreloadIpc = { invoke: vi.fn().mockResolvedValue(undefined), on: vi.fn(), removeListener: vi.fn() }
    const thread = createOxeApi(ipc).thread!
    await thread.sideOpen!('thread-A')
    await thread.sideSend!('side-1', 'What did it decide?')
    await thread.sideClose!('side-1')
    expect(vi.mocked(ipc.invoke).mock.calls).toEqual([[IPC_CHANNELS.thread.sideOpen, 'thread-A'], [IPC_CHANNELS.thread.sideSend, 'side-1', 'What did it decide?'], [IPC_CHANNELS.thread.sideClose, 'side-1']])
    thread.onSideEvent!(vi.fn())
    expect(ipc.on).toHaveBeenCalledWith(IPC_CHANNELS.thread.onSideEvent, expect.any(Function))
  })
})
