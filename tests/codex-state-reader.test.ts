import { describe, expect, it, vi } from 'vitest'
import type { ConversationThread } from '../shared/types/thread'
import type { ConversationTransport } from '../electron/main/services/conversation/codex-conversation'
import { CodexStateReader } from '../electron/main/services/conversation/codex-state-reader'

const thread = { provider: 'codex', rootPath: process.cwd(), nativeSessionId: 'native-session' } as ConversationThread
function fixture(reply: (method: string, params: Record<string, unknown>) => unknown) {
  let receive: (chunk: Uint8Array) => void = () => {}
  const calls: Array<{ method: string; params: Record<string, unknown> }> = []
  const connection: ConversationTransport = { onData: callback => { receive = callback }, onClose: () => {}, close: vi.fn(async () => {}), write: line => {
    const message = JSON.parse(line); calls.push(message)
    if (message.id === undefined) return
    const result = message.method === 'initialize' ? {} : reply(message.method, message.params)
    if (result === undefined) return
    queueMicrotask(() => receive(Buffer.from(JSON.stringify({ id: message.id, result }) + '\n')))
  } }
  const transport = vi.fn(() => connection)
  return { reader: new CodexStateReader(() => 'codex', transport), calls, transport, connection }
}
const identity = (status = 'notLoaded') => ({ thread: { id: thread.nativeSessionId, cwd: thread.rootPath, status: { type: status } } })

describe('passive Codex state query', () => {
  it('recovers terminal command output and public messages in item order', async () => {
    const f = fixture(method => method === 'thread/read' ? identity() : method === 'thread/turns/list' ? { data: [{ id: 'expected', status: 'completed' }] }
      : { data: [{ turnId: 'expected', item: { type: 'commandExecution', id: 'cmd', status: 'completed', exitCode: 0, command: 'npm test', aggregatedOutput: 'Passed' } }, { turnId: 'expected', item: { type: 'agentMessage', id: 'answer', text: 'Done' } }], nextCursor: null })
    const result = await f.reader.recover(thread, 'expected')
    expect(result.recoveredItems).toMatchObject([{ type: 'tool', id: 'cmd', state: 'completed', output: 'Passed' }, { type: 'message', id: 'answer' }])
  })
  it('recovers public response pages for the exact terminal turn without leaking reasoning', async () => {
    const f = fixture((method, params) => method === 'thread/read' ? identity() : method === 'thread/turns/list' ? { data: [{ id: 'expected', status: 'completed' }] }
      : params.cursor ? { data: [{ turnId: 'expected', item: { type: 'agentMessage', id: 'second', text: 'Final answer' } }], nextCursor: null }
        : { data: [{ turnId: 'expected', item: { type: 'reasoning', content: ['private'] } }, { turnId: 'expected', item: { type: 'agentMessage', id: 'first', text: 'Public update' } }], nextCursor: 'page-2' })
    const result = await f.reader.recover(thread, 'expected')
    expect(result.recoveredMessages).toMatchObject([{ id: 'first', text: 'Public update' }, { id: 'second', text: 'Final answer' }])
    expect(JSON.stringify(result)).not.toContain('private')
    expect(f.calls.filter(call => call.method === 'thread/items/list')).toHaveLength(2)
  })
  it('recovers inline questions as historical evidence without creating an interactive request', async () => {
    const f = fixture(method => method === 'thread/read' ? identity() : method === 'thread/turns/list' ? { data: [{ id: 'expected', status: 'completed' }] }
      : { data: [{ turnId: 'expected', item: { type: 'agentMessage', id: 'answer', text: '', questions: [{ title: 'Which branch?', options: ['Current', 'New'] }] } }], nextCursor: null })
    const result = await f.reader.recover(thread, 'expected')
    expect(result.recoveredMessages).toEqual([{ type: 'message', id: 'answer', role: 'assistant', text: '', historicalQuestions: [{ title: 'Which branch?', options: ['Current', 'New'] }] }])
    expect(result.recoveredItems?.some(item => item.type === ('request' as string))).toBe(false)
  })
  it.each(['other-turn', 'repeated-cursor', 'question'])('does not return partial recovery for %s', async kind => {
    const f = fixture(method => method === 'thread/read' ? identity() : method === 'thread/turns/list' ? { data: [{ id: 'expected', status: 'completed' }] }
      : { data: [{ turnId: kind === 'other-turn' ? 'other' : 'expected', item: { type: 'agentMessage', id: 'answer', text: 'Partial answer', ...(kind === 'question' ? { questions: [{}] } : {}) } }], nextCursor: kind === 'repeated-cursor' ? 'same' : null })
    const result = await f.reader.recover(thread, 'expected')
    expect(result.state).toBe('completed')
    expect(result.recoveredMessages).toBeUndefined()
    expect(result.detail).toContain('could not be recovered')
  })
  it('finds an exact saved turn across pages without resuming or hydrating items', async () => {
    const f = fixture((method, params) => method === 'thread/read' ? identity() : params.cursor
      ? { data: [{ id: 'expected', status: 'completed' }] } : { data: [{ id: 'other', status: 'failed' }], nextCursor: 'next' })
    expect(await f.reader.observe(thread, 'expected')).toMatchObject({ state: 'completed', nativeTurnId: 'expected', source: 'codex-app-server' })
    expect(f.calls.map(call => call.method)).toEqual(['initialize', 'initialized', 'thread/read', 'thread/turns/list', 'thread/turns/list'])
    expect(f.calls[2].params).toEqual({ threadId: 'native-session', includeTurns: false })
    expect(f.calls[3].params.itemsView).toBe('notLoaded')
    expect(f.connection.close).toHaveBeenCalledOnce()
  })
  it.each(['interrupted', 'inProgress', 'unrecognized'])('keeps a provisional %s result unknown', async status => {
    const f = fixture(method => method === 'thread/read' ? identity() : { data: [{ id: 'expected', status }] })
    expect((await f.reader.observe(thread, 'expected')).state).toBe('unknown')
  })
  it('does not trust a terminal journal while the session is active', async () => {
    const f = fixture(method => method === 'thread/read' ? identity('active') : { data: [{ id: 'expected', status: 'completed' }] })
    expect((await f.reader.observe(thread, 'expected')).state).toBe('unknown')
  })
  it('rejects an unrelated directory before reading any turns', async () => {
    const f = fixture(() => ({ thread: { id: thread.nativeSessionId, cwd: '/unrelated' } }))
    expect((await f.reader.observe(thread, 'expected')).detail).toContain('did not match')
    expect(f.calls.map(call => call.method)).not.toContain('thread/turns/list')
  })
  it('bounds pagination and stops repeated cursors', async () => {
    const f = fixture(method => method === 'thread/read' ? identity() : { data: [], nextCursor: 'same' })
    expect((await f.reader.observe(thread, 'missing')).state).toBe('unknown')
    expect(f.calls.filter(call => call.method === 'thread/turns/list')).toHaveLength(2)
  })
  it('does not start a process without a turn ID or for Claude', async () => {
    const f = fixture(() => ({}))
    expect((await f.reader.observe(thread)).state).toBe('unknown')
    expect((await f.reader.observe({ ...thread, provider: 'claude' }, 'turn')).state).toBe('unknown')
    expect(f.transport).not.toHaveBeenCalled()
  })
  it('cancels pending queries on shutdown and prevents a new process', async () => {
    const f = fixture(() => undefined)
    const result = f.reader.observe(thread, 'expected')
    await f.reader.stop()
    expect((await result).state).toBe('unknown')
    await f.reader.observe(thread, 'expected')
    expect(f.transport).toHaveBeenCalledOnce()
  })
})
