import { describe, expect, it, vi } from 'vitest'
import { runThreadCommand, type CommandHost } from '../electron/main/services/conversation/kernel/command-router'
import type { ThreadSnapshot } from '../shared/types/thread'

function host(provider: 'claude' | 'codex') {
  const snapshot = { thread: { id: 't1', title: 'Old', provider, nativeSessionId: 'native', rootPath: '/repo', workspaceId: 'w', projectId: 'p' }, events: [] } as unknown as ThreadSnapshot
  const command = vi.fn(async () => {})
  const fake = {
    read: vi.fn(() => structuredClone(snapshot)),
    save: vi.fn((next: ThreadSnapshot) => { snapshot.thread.title = next.thread.title }),
    isBusy: vi.fn(() => true),
    isConfiguring: vi.fn(() => false),
    connectAdapter: vi.fn(async () => ({ command }))
  } as unknown as CommandHost
  return { fake, snapshot, command }
}

describe('Thread commands during an active turn', () => {
  it('renames a conversation while its turn is running', async () => {
    const { fake, snapshot } = host('claude')
    await expect(runThreadCommand(fake, 't1', '/rename Auth follow-up')).resolves.toEqual({ kind: 'applied' })
    expect(snapshot.thread.title).toBe('Auth follow-up')
  })

  it('keeps the Codex native rename for an idle session only, and still saves the local name', async () => {
    const { fake, snapshot, command } = host('codex')
    await runThreadCommand(fake, 't1', '/rename Busy name')
    expect(command).not.toHaveBeenCalled()
    expect(snapshot.thread.title).toBe('Busy name')
  })

  it('still refuses commands that act on the session', async () => {
    const { fake } = host('claude')
    await expect(runThreadCommand(fake, 't1', '/new')).rejects.toThrow('Finish the active operation')
  })
})
