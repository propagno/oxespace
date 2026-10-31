import { describe, expect, it, vi } from 'vitest'
import { createOxeApi, type PreloadIpc } from '../electron/preload/api'
import { MCP_COVERAGE } from '../shared/mcp-coverage'
import { threadArchiveWithChildren, threadConfirmation } from '../shared/threadConfirmations'
import { IPC_CHANNELS } from '../shared/types/ipc'
import { THREAD_PARENT_VIA } from '../shared/types/thread'

describe('nested conversations contract (B1.3)', () => {
  it('names how a conversation was started by another one', () => {
    expect(THREAD_PARENT_VIA).toEqual(['thread_create', 'work', 'delegation'])
  })

  it('reads a conversation\'s children through a stable, read-only channel', async () => {
    expect(IPC_CHANNELS.thread.children).toBe('thread:children')
    expect(MCP_COVERAGE['thread.read'].ipc).toContain('thread.children')
    const ipc: PreloadIpc = { invoke: vi.fn().mockResolvedValue(undefined), on: vi.fn(), removeListener: vi.fn() }
    await createOxeApi(ipc).thread!.children!('thread-A')
    expect(ipc.invoke).toHaveBeenCalledWith(IPC_CHANNELS.thread.children, 'thread-A')
  })

  it('asks once more before archiving a conversation whose children still work, and takes them along', () => {
    const plain = threadConfirmation('archive', 'Plan')
    expect(plain.command).toBe('/archive confirm')
    expect(plain.childConversations).toBeUndefined()
    const many = threadArchiveWithChildren({ active: 2, total: 3 }, 'Plan')
    expect(many).toMatchObject({ command: '/archive confirm-with-children', childConversations: { active: 2, total: 3 } })
    expect(many.description).toContain('2 conversations it started are still working')
    expect(threadArchiveWithChildren({ active: 1, total: 1 }).description).toContain('One conversation it started is still working')
    // A client that only knows /archive confirm runs the command the confirmation carries, so it keeps working.
    expect(many.command).not.toBe(plain.command)
  })
})
