import { describe, expect, it, vi } from 'vitest'
import { CodexConversationAdapter, type ConversationTransport } from '../electron/main/services/conversation/codex-conversation'
import { runThreadCommand, type CommandHost } from '../electron/main/services/conversation/kernel/command-router'
import type { ThreadSnapshot } from '../shared/types/thread'

/**
 * T40 (B20, TECH LEAD condition 2): a Codex conversation archived by the PR toast (archiveThread → "/archive confirm")
 * must resume on the provider after Restore (Sidebar › Archived or the toast: "/resume <id>"). Archiving is OXESpace's
 * own flag: the adapter is disposed and `thread/archive` never reaches Codex, so Restore's next connect resumes the
 * same native thread.
 */

/** A Codex app server that answers every request and records what it was asked. */
function codexServer() {
  let receive: (chunk: Uint8Array) => void = () => {}
  const requests: Array<{ method: string; params?: Record<string, unknown> }> = []
  const transport: ConversationTransport = {
    write: line => {
      const message = JSON.parse(line)
      requests.push(message)
      if (!message.method || message.id === undefined) return
      const result = message.method === 'thread/start' || message.method === 'thread/resume' ? { thread: { id: message.params?.threadId ?? 'native-new' } } : {}
      queueMicrotask(() => receive(Buffer.from(JSON.stringify({ id: message.id, result }) + '\n')))
    },
    onData: listener => { receive = listener },
    onClose: () => {},
    close: vi.fn(async () => {})
  }
  return { transport, requests }
}

function host() {
  const snapshot = { thread: { id: 't1', title: 'Fix login', provider: 'codex', nativeSessionId: 'native-41', rootPath: '/repo', workspaceId: 'w', projectId: 'p', archived: false }, events: [] } as unknown as ThreadSnapshot
  const server = codexServer()
  let adapter: CodexConversationAdapter | null = null
  const adapterCommand = vi.fn()
  const fake = {
    db: { prepare: () => ({ get: (id: string) => id === 't1' ? { id: 't1' } : undefined, all: () => [] }) },
    read: vi.fn(() => structuredClone(snapshot)),
    save: vi.fn((next: ThreadSnapshot) => { snapshot.thread.archived = next.thread.archived }),
    isBusy: vi.fn(() => false),
    isConfiguring: vi.fn(() => false),
    interrupt: vi.fn(async () => {}),
    withConfiguring: vi.fn(async (_id: string, run: () => Promise<unknown>) => run()),
    // The orchestrator connects the provider on the next turn after Restore: a Codex adapter over the fake server.
    connectAdapter: vi.fn(async () => {
      adapter = new CodexConversationAdapter(server.transport)
      await adapter.start({ rootPath: snapshot.thread.rootPath, nativeSessionId: snapshot.thread.nativeSessionId }, () => {})
      const command = adapter.command!.bind(adapter)
      adapter.command = async (name: string, argument: string) => { adapterCommand(name, argument); return command(name, argument) }
      return adapter
    }),
    disposeAdapter: vi.fn(async () => { await adapter?.dispose(); adapter = null })
  } as unknown as CommandHost
  return { fake, snapshot, server, adapterCommand }
}

describe('a Codex conversation archived by the PR toast and restored', () => {
  it('archives in OXESpace only: the adapter is disposed and Codex is never sent thread/archive', async () => {
    const { fake, snapshot, server, adapterCommand } = host()
    // Connected, as it is while the conversation is on screen.
    await fake.connectAdapter('t1', snapshot.thread)
    await expect(runThreadCommand(fake, 't1', '/archive confirm')).resolves.toEqual({ kind: 'navigate' })
    expect(snapshot.thread.archived).toBe(true)
    expect(fake.disposeAdapter).toHaveBeenCalledWith('t1')
    expect(adapterCommand).not.toHaveBeenCalled()
    expect(server.requests.map(request => request.method)).not.toContain('thread/archive')
  })

  it('Restore (/resume <id>) clears the flag, and the next connect resumes the same native Codex thread', async () => {
    const { fake, snapshot, server } = host()
    await runThreadCommand(fake, 't1', '/archive confirm')
    await expect(runThreadCommand(fake, 't1', '/resume t1')).resolves.toEqual({ kind: 'navigate', threadId: 't1' })
    expect(snapshot.thread.archived).toBe(false)
    await fake.connectAdapter('t1', snapshot.thread)
    expect(server.requests).toContainEqual(expect.objectContaining({ method: 'thread/resume', params: expect.objectContaining({ threadId: 'native-41' }) }))
    expect(server.requests.map(request => request.method)).not.toContain('thread/archive')
    expect(server.requests.map(request => request.method)).not.toContain('thread/start')
    await fake.disposeAdapter('t1')
  })
})
