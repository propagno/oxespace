import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClaudeConversationAdapter } from '../electron/main/services/conversation/claude-conversation'
import { threadCapabilityManifest } from '../electron/main/services/conversation/thread-capabilities'
import type { ThreadEvent } from '../shared/types/thread'

function fixture() {
  const turns: { data: (c: Uint8Array) => void; writes: Array<Record<string, unknown>> }[] = []
  const adapter = new ClaudeConversationAdapter(() => {
    const turn = { data: (_c: Uint8Array) => {}, close: () => {}, writes: [] as Array<Record<string, unknown>> }
    turns.push(turn)
    return {
      write: (text: string) => {
        const m = JSON.parse(text) as Record<string, unknown>
        turn.writes.push(m)
        if (m.type === 'control_request' && m.request_id === 'initialize') turn.data(Buffer.from(JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: 'initialize', response: { commands: [], models: [] } } }) + '\n'))
      },
      onData: (cb: (c: Uint8Array) => void) => { turn.data = cb },
      onClose: (cb: () => void) => { turn.close = cb },
      close: vi.fn(async () => turn.close())
    }
  })
  const events: ThreadEvent[] = []
  const answer = (requestId: string, response: Record<string, unknown>) => turns[0].data(Buffer.from(JSON.stringify({ type: 'control_response', response: { request_id: requestId, ...response } }) + '\n'))
  const stopRequests = () => turns[0].writes.filter(w => (w.request as { subtype?: string } | undefined)?.subtype === 'stop_task')
  return { adapter, turns, events, answer, stopRequests }
}

describe('Claude background task stop', () => {
  beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }) })
  afterEach(() => { vi.useRealTimers() })

  it('sends stop_task for the task and resolves when the CLI accepts', async () => {
    const f = fixture()
    await f.adapter.start({ rootPath: '/p', nativeSessionId: 'n' }, e => f.events.push(e))
    await f.adapter.send('Start a watcher')
    const stopping = f.adapter.stopTask('bash_1')
    const [request] = f.stopRequests()
    expect(request.request).toEqual({ subtype: 'stop_task', task_id: 'bash_1' })
    f.answer(request.request_id as string, { subtype: 'success' })
    await expect(stopping).resolves.toBeUndefined()
    await f.adapter.dispose()
  })

  it('surfaces a refusal, a missing answer and an invalid id', async () => {
    const f = fixture()
    await f.adapter.start({ rootPath: '/p', nativeSessionId: 'n' }, e => f.events.push(e))
    await f.adapter.send('Go')
    const refused = f.adapter.stopTask('bash_2')
    f.answer(f.stopRequests()[0].request_id as string, { subtype: 'error', error: 'No such task' })
    await expect(refused).rejects.toThrow('No such task')

    const silent = f.adapter.stopTask('bash_3')
    const assertion = expect(silent).rejects.toThrow('did not confirm')
    await vi.advanceTimersByTimeAsync(5_100)
    await assertion

    await expect(f.adapter.stopTask('bad id; rm -rf')).rejects.toThrow('Invalid task identifier')
    await f.adapter.dispose()
  })

  it('pending stops fail when the session is disposed', async () => {
    const f = fixture()
    await f.adapter.start({ rootPath: '/p', nativeSessionId: 'n' }, e => f.events.push(e))
    await f.adapter.send('Go')
    const pending = f.adapter.stopTask('bash_4')
    await f.adapter.dispose()
    await expect(pending).rejects.toThrow('disposed')
  })

  it('the capability manifest reports task stop only for adapters that support it', () => {
    expect(threadCapabilityManifest('claude', { resume: true, approvals: true, attachments: true, modelSelection: true, stopTasks: true }).features.subagentLifecycle.enabled).toBe(true)
    expect(threadCapabilityManifest('codex', { resume: true, approvals: true, attachments: true, modelSelection: true }).features.subagentLifecycle.enabled).toBe(false)
  })
})
