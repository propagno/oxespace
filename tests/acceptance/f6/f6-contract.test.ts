// Frozen acceptance test for 1.5.0 F6 (OXE program): the contract of the conversation's backend pieces. The thread
// channels for steering a queued message, the tool tabs and the background shells; the agents row's activity; the C3
// code; preload through createOxeApi; MCP coverage. Written by the planner; the executor must not edit it.
// CCR: docs/roadmap-1.5/ccr-f6-conversation.md §Contract.
import { describe, expect, test, vi } from 'vitest'
import { createOxeApi, type PreloadIpc } from '../../../electron/preload/api'
import { MESSAGE_CODES } from '../../../shared/messages'
import { MCP_COVERAGE } from '../../../shared/mcp-coverage'
import { IPC_CHANNELS } from '../../../shared/types/ipc'

const claims = (key: string) => Object.values(MCP_COVERAGE).filter(capability => capability.ipc?.includes(key) || capability.ipc?.includes(`${key.split('.')[0]}.*`))

describe('F6 · contract', () => {
  test('F6: the thread channels for steering a queued message, the tool tabs and the background shells', () => {
    expect(IPC_CHANNELS.thread).toMatchObject({
      steerQueued: 'thread:queue-steer',
      toolTabs: 'thread:tool-tabs',
      toolTabsChanged: 'thread:tool-tabs-changed',
      background: 'thread:background',
      backgroundChanged: 'thread:background-changed'
    })
    // Send now and Stop already exist.
    expect(IPC_CHANNELS.thread).toMatchObject({ sendQueuedNow: 'thread:queue-send-now', interrupt: 'thread:interrupt' })
  })

  test('F6: the preload calls each channel with what the window passes', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined)
    const on = vi.fn()
    const api = createOxeApi({ invoke, on, removeListener: vi.fn() } as PreloadIpc)
    const thread = api.thread as unknown as Record<string, (...args: unknown[]) => unknown>
    await thread.steerQueued('t1', 'q1')
    await thread.toolTabs('t1')
    await thread.background('t1')
    thread.onToolTabsChanged(() => undefined)
    thread.onBackgroundChanged(() => undefined)
    expect(invoke.mock.calls).toEqual([[IPC_CHANNELS.thread.steerQueued, 't1', 'q1'], [IPC_CHANNELS.thread.toolTabs, 't1'], [IPC_CHANNELS.thread.background, 't1']])
    expect(on).toHaveBeenCalledWith(IPC_CHANNELS.thread.toolTabsChanged, expect.any(Function))
    expect(on).toHaveBeenCalledWith(IPC_CHANNELS.thread.backgroundChanged, expect.any(Function))
  })

  test('F6: MCP coverage: steering a queued message is a thread write like steer; the tabs and the background list are excluded read models', () => {
    const steer = claims('thread.steerQueued')
    expect(steer).toHaveLength(1)
    expect(claims('thread.steer')[0]).toBe(steer[0])
    for (const key of ['thread.toolTabs', 'thread.toolTabsChanged', 'thread.background', 'thread.backgroundChanged']) {
      const found = claims(key)
      expect(found, key).toHaveLength(1)
      expect(found[0], key).toHaveProperty('excluded')
    }
  })

  test('F6: the C3 code for a steer that cannot happen now', () => {
    expect(MESSAGE_CODES as readonly string[]).toContain('thread.steer.unavailable')
  })
})
