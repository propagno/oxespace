import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClaudeConversationAdapter } from '../electron/main/services/conversation/claude-conversation'
import type { ThreadEvent } from '../shared/types/thread'

function fixture() {
  const turns: { data: (chunk: Uint8Array) => void; close: () => void; writes: Array<Record<string, unknown>>; closed: boolean }[] = []
  const adapter = new ClaudeConversationAdapter(() => {
    const turn = { data: (_chunk: Uint8Array) => {}, close: () => {}, writes: [] as Array<Record<string, unknown>>, closed: false }
    turns.push(turn)
    return {
      write: (text: string) => {
        const message = JSON.parse(text) as Record<string, unknown>
        turn.writes.push(message)
        if (message.type === 'control_request' && message.request_id === 'initialize') {
          turn.data(Buffer.from(JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: 'initialize', response: { commands: [], models: [] } } }) + '\n'))
        }
      },
      onData: (callback: (chunk: Uint8Array) => void) => { turn.data = callback },
      onClose: (callback: () => void) => { turn.close = callback },
      close: vi.fn(async () => { turn.closed = true; turn.close() })
    }
  })
  const events: ThreadEvent[] = []
  const emit = (event: unknown): void => turns[0].data(Buffer.from(JSON.stringify(event) + '\n'))
  return { adapter, turns, events, emit }
}

const interruptWrites = (turn: { writes: Array<Record<string, unknown>> }) =>
  turn.writes.filter((w) => w.type === 'control_request' && (w.request as { subtype?: string })?.subtype === 'interrupt')

describe('Claude cooperative interrupt', () => {
  beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }) })
  afterEach(() => { vi.useRealTimers() })

  it('asks the CLI to stop the turn and keeps the process alive', async () => {
    const f = fixture()
    await f.adapter.start({ rootPath: '/project', nativeSessionId: 'native' }, (event) => f.events.push(event))
    await f.adapter.send('Long task')

    const pending = f.adapter.interrupt()
    expect(interruptWrites(f.turns[0])).toHaveLength(1)
    // The CLI answers by ending the turn with an errored result.
    f.emit({ type: 'result', subtype: 'error_during_execution', is_error: true })
    await pending

    expect(f.turns[0].closed).toBe(false)
    const completed = f.events.filter((e) => e.type === 'completed')
    expect(completed).toHaveLength(1)
    expect(completed[0]).toMatchObject({ type: 'completed', status: 'interrupted' })
    await f.adapter.dispose()
  })

  it('falls back to ending the process when the CLI does not stop in time', async () => {
    const f = fixture()
    await f.adapter.start({ rootPath: '/project', nativeSessionId: 'native' }, (event) => f.events.push(event))
    await f.adapter.send('Stuck task')

    const pending = f.adapter.interrupt()
    expect(interruptWrites(f.turns[0])).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(2_100)
    await pending

    expect(f.turns[0].closed).toBe(true)
    expect(f.events.filter((e) => e.type === 'completed').at(-1)).toMatchObject({ status: 'interrupted' })
  })

  it('a later genuine failure is not relabelled as an interruption', async () => {
    const f = fixture()
    await f.adapter.start({ rootPath: '/project', nativeSessionId: 'native' }, (event) => f.events.push(event))
    await f.adapter.send('First')
    const pending = f.adapter.interrupt()
    f.emit({ type: 'result', subtype: 'error_during_execution', is_error: true })
    await pending

    await f.adapter.send('Second')
    f.emit({ type: 'result', subtype: 'error_during_execution', is_error: true })
    const completed = f.events.filter((e) => e.type === 'completed')
    expect(completed.at(-1)).toMatchObject({ status: 'failed' })
    await f.adapter.dispose()
  })

  it('does nothing when no turn is running', async () => {
    const f = fixture()
    await f.adapter.start({ rootPath: '/project', nativeSessionId: 'native' }, (event) => f.events.push(event))
    await f.adapter.send('Quick')
    f.emit({ type: 'result', subtype: 'success', is_error: false })
    await f.adapter.interrupt()
    expect(interruptWrites(f.turns[0])).toHaveLength(0)
    await f.adapter.dispose()
  })
})
