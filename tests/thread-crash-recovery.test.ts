import { describe, expect, it, vi } from 'vitest'
import { continuePrompt, INTERRUPTED_TOOL_NOTE, interruptTool, pendingInterruptedTools, runCrashRecoveryCommand, type ToolEvent } from '../electron/main/services/conversation/thread-crash-recovery'
import { settleVolatileThreadSnapshot } from '../electron/main/services/conversation/thread-recovery.service'
import type { ThreadSnapshot } from '../shared/types/thread'

const tool = (id: string, state: ToolEvent['state'] = 'running'): ToolEvent => ({ type: 'tool', id, name: 'Bash', state, detail: `cmd ${id}` })
const snapshotWith = (...events: ToolEvent[]): ThreadSnapshot => ({ thread: { id: 't', status: 'running' } as ThreadSnapshot['thread'], events })

describe('tool crash recovery state transitions', () => {
  it('turns a running tool into an interrupted one, never a completed one', () => {
    const event = tool('a'); interruptTool(event, 9)
    expect(event).toMatchObject({ state: 'unknown', interrupted: true, completedAt: 9 })
    expect(event.output).toBe(INTERRUPTED_TOOL_NOTE)
  })
  it('only settles running tools and leaves finished ones alone', () => {
    const snapshot = snapshotWith(tool('a'), tool('b', 'completed'), tool('c', 'failed'))
    settleVolatileThreadSnapshot(snapshot, 'restart', 10)
    expect(snapshot.events.map(event => event.type === 'tool' && event.state)).toEqual(['unknown', 'completed', 'failed'])
    expect(pendingInterruptedTools(snapshot).map(event => event.id)).toEqual(['a'])
  })
  it('does not list a handled interruption again', () => {
    const snapshot = snapshotWith(tool('a'), tool('b')); settleVolatileThreadSnapshot(snapshot, 'restart', 10)
    ;(snapshot.events[0] as ToolEvent).interruptedHandled = 'dismissed'
    expect(pendingInterruptedTools(snapshot).map(event => event.id)).toEqual(['b'])
  })
  it('words the continue note as a check-first request', () => {
    const text = continuePrompt([tool('a')])
    expect(text).toMatch(/may or may not have taken effect/)
    expect(text).toMatch(/Do not repeat these actions blindly/)
  })
  it('ignores unrelated commands and resends nothing when nothing is pending', async () => {
    const send = vi.fn(async () => undefined), save = vi.fn()
    const host = { read: () => snapshotWith(), save, send }
    expect(await runCrashRecoveryCommand(host, 't', '/status')).toBeUndefined()
    await runCrashRecoveryCommand(host, 't', '/continue-interrupted')
    expect(send).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled()
  })
})
