// Frozen acceptance test for 1.5.0 A19 (OXE program, phase F6): the conversation header's "now" line, the `activity`
// field T90, built in main from the conversation's own state, for conversations only. Values, never sentences (C3): the
// window words each kind (DESIGN's NowLine table). Redacted, with paths relative to the project.
// Written by the planner; the executor must not edit it.
// CCR: docs/roadmap-1.5/ccr-f6-conversation.md §A19; DESIGN 1.5.0-f6-design.md U6.1.
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { threadActivity, type ThreadActivityInput } from '../../../electron/main/services/agent-state/thread-activity'
import type { ConversationThread, ThreadEvent, ThreadRequest, ThreadTurn } from '../../../shared/types/thread'

const ROOT = process.platform === 'win32' ? 'C:\\work\\shop' : '/work/shop'
const SECRET = `sk-ant-${'z'.repeat(40)}`
const NOW = 1_000_000

function input(over: { thread?: Partial<ConversationThread>; events?: ThreadEvent[]; requests?: Partial<ThreadRequest>[]; turns?: Partial<ThreadTurn>[]; changedFiles?: number } = {}): ThreadActivityInput {
  return {
    thread: { id: 't1', rootPath: ROOT, provider: 'claude', status: 'idle', title: 'Fix login', ...over.thread } as ConversationThread,
    events: over.events ?? [],
    requests: (over.requests ?? []).map((request, index) => ({ id: `r${index}`, nativeId: `n${index}`, nativeMethod: 'm', kind: 'approval', title: 'run npm test', generation: 1, createdAt: NOW - 1000, state: 'pending', ...request }) as ThreadRequest),
    turns: (over.turns ?? []).map((turn, index) => ({ id: `turn-${index}`, sequence: index, status: 'completed', startedAt: NOW - 60_000, ...turn }) as ThreadTurn),
    changedFiles: over.changedFiles ?? 0,
    now: NOW
  }
}
const running = (events: ThreadEvent[]) => input({ thread: { status: 'running' }, turns: [{ status: 'running', startedAt: NOW - 120_000 }], events })

describe('A19 · the activity line (T90)', () => {
  test('A19: a pending approval is needs-you with what it asks, first of all, even while a tool runs', () => {
    const activity = threadActivity(input({
      thread: { status: 'approval' }, turns: [{ status: 'running' }], requests: [{ kind: 'approval', title: 'run npm publish', id: 'req-1' }],
      events: [{ type: 'tool', id: 'x', name: 'Bash', state: 'running', detail: 'npm publish' }]
    }))
    expect(activity).toMatchObject({ kind: 'needs-you', text: 'run npm publish', requestId: 'req-1' })
  })

  test('A19: a pending question is question with the number of questions', () => {
    const activity = threadActivity(input({ thread: { status: 'approval' }, requests: [{ kind: 'question', title: 'Pick one', questions: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] as never }] }))
    expect(activity).toMatchObject({ kind: 'question', count: 3 })
  })

  test('A19: working names the running tool by verb and target, relative to the project, since the turn began', () => {
    const file = join(ROOT, 'src', 'login.ts')
    const activity = threadActivity(running([{ type: 'tool', id: 'e1', name: 'Edit', state: 'running', detail: file, files: [{ path: file, kind: 'update', source: 'tool-input', state: 'running' }] }]))
    expect(activity).toMatchObject({ kind: 'working', verb: 'edit', since: NOW - 120_000 })
    expect(activity.text?.replace(/\\/g, '/')).toBe('src/login.ts')
  })

  test('A19: working with no tool running is thinking; a running command is run, its text redacted', () => {
    expect(threadActivity(running([{ type: 'reasoning', id: 'r', text: 'hmm', startedAt: NOW - 5000 }]))).toMatchObject({ kind: 'working', verb: 'think' })
    const run = threadActivity(running([{ type: 'tool', id: 'b1', name: 'Bash', state: 'running', detail: `curl -H "Authorization: Bearer ${SECRET}" https://api.example.com` }]))
    expect(run).toMatchObject({ kind: 'working', verb: 'run' })
    expect(JSON.stringify(run)).not.toContain(SECRET)
  })

  test('A19: a stopped turn is paused; a failed one is error with its reason code', () => {
    expect(threadActivity(input({ thread: { lastTurnStatus: 'interrupted' }, turns: [{ status: 'interrupted' }] }))).toMatchObject({ kind: 'paused' })
    const failed = threadActivity(input({ thread: { lastTurnStatus: 'failed' }, turns: [{ status: 'failed' }], events: [{ type: 'completed', status: 'failed', errorCode: 'rate-limited' as never, error: 'Too many requests' }] }))
    expect(failed).toMatchObject({ kind: 'error', reason: 'rate-limited' })
  })

  test('A19: a completed task with changes is ready, without changes done; both carry the last answer\'s first sentence as the summary', () => {
    const events: ThreadEvent[] = [{ type: 'message', id: 'a1', role: 'assistant', text: `Fixed the login redirect in ${join(ROOT, 'src', 'login.ts')}. Then I also ran the tests, which pass.` }, { type: 'completed', status: 'completed' }]
    const ready = threadActivity(input({ thread: { lastTurnStatus: 'completed' }, turns: [{ status: 'completed' }], events, changedFiles: 2 }))
    expect(ready).toMatchObject({ kind: 'ready' })
    expect(ready.text?.replace(/\\/g, '/')).toBe('Fixed the login redirect in src/login.ts.')
    expect(threadActivity(input({ thread: { lastTurnStatus: 'completed' }, turns: [{ status: 'completed' }], events, changedFiles: 0 }))).toMatchObject({ kind: 'done' })
  })

  test('A19: the summary is bounded and redacted', () => {
    const long = `${'word '.repeat(200)}${SECRET}.`
    const done = threadActivity(input({ thread: { lastTurnStatus: 'completed' }, turns: [{ status: 'completed' }], events: [{ type: 'message', id: 'a', role: 'assistant', text: long }] }))
    expect((done.text ?? '').length).toBeLessThanOrEqual(200)
    expect(JSON.stringify(done)).not.toContain(SECRET)
  })

  test('A19: every activity has a time, and none carries an English sentence of the app\'s own (C3)', () => {
    const all = [
      threadActivity(input()), threadActivity(running([])),
      threadActivity(input({ thread: { lastTurnStatus: 'interrupted' }, turns: [{ status: 'interrupted' }] }))
    ]
    for (const activity of all) {
      expect(typeof activity.at).toBe('number')
      expect(JSON.stringify(activity)).not.toMatch(/Needs you|Working|Paused|Ready for review|Done\./)
    }
  })
})
