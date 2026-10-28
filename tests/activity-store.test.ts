import { beforeEach, describe, expect, it } from 'vitest'
import { ACTIVITY_LIMIT, activityGroup, summarizeAttention, unreadActivityCount, useActivityStore, type ActivityInput } from '../src/store/activity.store'
import { connectAttentionFeed } from '../src/store/activity.feed'
import { recordJobOutcome } from '../src/store/background.store'
import { useThreadStore } from '../src/store/thread.store'
import { useWorkspaceStore } from '../src/store/workspace.store'
import { useTerminalStore } from '../src/store/terminal.store'
import { updateActivity } from '../src/hooks/useActivitySources'
import type { BackgroundJob } from '../shared/types/background'

const thread = (id: string, kind: ActivityInput['kind'] = 'finished', at = 1): ActivityInput =>
  ({ source: 'thread', id, kind, target: { type: 'thread', threadId: id }, title: `Thread ${id}`, at })

const job = (status: BackgroundJob['status'], exitCode: number | null = null): BackgroundJob =>
  ({ id: 'job', workspaceId: 'ws', label: 'Build', command: 'npm run build', cwd: '/repo', status, exitCode, startedAtMs: 1, finishedAtMs: null })

describe('activity store', () => {
  beforeEach(() => useActivityStore.getState().reset())

  it('keeps one entry per subject, newest first, unread', () => {
    const { record } = useActivityStore.getState()
    record(thread('a', 'needs-you', 1))
    record(thread('b', 'finished', 2))
    record(thread('a', 'finished', 3))
    const items = useActivityStore.getState().items
    expect(items.map(item => [item.id, item.kind])).toEqual([['a', 'finished'], ['b', 'finished']])
    expect(items.every(item => !item.read)).toBe(true)
  })

  it('keeps only the last 50 of the session', () => {
    for (let index = 0; index < ACTIVITY_LIMIT + 5; index += 1) useActivityStore.getState().record(thread(String(index), 'finished', index))
    const items = useActivityStore.getState().items
    expect(items).toHaveLength(ACTIVITY_LIMIT)
    expect(items[0].id).toBe(String(ACTIVITY_LIMIT + 4))
    expect(items.some(item => item.id === '0')).toBe(false)
  })

  it('drops a request once it no longer waits, and leaves other outcomes alone', () => {
    const { record, resolve } = useActivityStore.getState()
    record(thread('a', 'needs-you'))
    record(thread('b', 'failed'))
    resolve('thread', 'a')
    resolve('thread', 'b')
    expect(useActivityStore.getState().items.map(item => item.id)).toEqual(['b'])
  })

  it('marks one or all as read', () => {
    const { record, markRead, markAllRead } = useActivityStore.getState()
    record(thread('a'))
    record(thread('b'))
    markRead('thread', 'a')
    expect(unreadActivityCount(useActivityStore.getState().items)).toBe(1)
    markAllRead()
    expect(unreadActivityCount(useActivityStore.getState().items)).toBe(0)
  })

  it('groups kinds into Needs you, Finished and Updates', () => {
    expect(activityGroup('needs-you')).toBe('needs-you')
    expect(activityGroup('failed')).toBe('finished')
    expect(activityGroup('finished')).toBe('finished')
    expect(activityGroup('quota')).toBe('updates')
    expect(activityGroup('update')).toBe('updates')
  })
})

describe('attention derived from the activity store', () => {
  beforeEach(() => {
    useActivityStore.getState().reset()
    connectAttentionFeed()
    useWorkspaceStore.setState({ workspaces: [] })
    useThreadStore.setState({ threads: [], unreadIds: [] })
  })

  it('counts from live state alone', () => {
    expect(summarizeAttention({ code: { p: 'needs-you', q: 'working' }, thread: { a: 'failed' } }))
      .toEqual({ code: { needsYou: 1, failed: 0, working: 1 }, thread: { needsYou: 0, failed: 1, working: 0 } })
  })

  it('follows the Thread store, counting a failure only until it is seen', () => {
    useThreadStore.setState({ threads: [{ id: 'a', status: 'approval' }, { id: 'b', status: 'failed' }, { id: 'c', status: 'running' }] as never, unreadIds: ['b'] })
    expect(useActivityStore.getState().live.thread).toEqual({ a: 'needs-you', b: 'failed', c: 'working' })
    useThreadStore.getState().markRead('b')
    expect(useActivityStore.getState().live.thread).toEqual({ a: 'needs-you', c: 'working' })
  })

  it('follows terminal panes in every workspace', () => {
    useWorkspaceStore.setState({ workspaces: [{ id: 'ws', panes: [{ id: 'p', type: 'terminal' }, { id: 'q', type: 'terminal' }, { id: 'w', type: 'web-preview' }] }] as never })
    useTerminalStore.setState({ panes: { p: { status: 'error', error: 'boom' }, q: { status: 'running', agentState: 'working' } } as never })
    expect(useActivityStore.getState().live.code).toEqual({ p: 'failed', q: 'working' })
  })
})

describe('activity producers', () => {
  beforeEach(() => useActivityStore.getState().reset())

  it('records a background job that ends on its own, and not one the person stopped', () => {
    recordJobOutcome(job('running'), job('killed'))
    expect(useActivityStore.getState().items).toEqual([])
    recordJobOutcome(job('running'), job('exited', 0))
    expect(useActivityStore.getState().items[0]).toMatchObject({ source: 'background', kind: 'finished', title: 'Build', target: { type: 'background', jobId: 'job' } })
    recordJobOutcome(job('running'), job('exited', 2))
    expect(useActivityStore.getState().items[0]).toMatchObject({ kind: 'failed', detail: 'Background job failed with exit code 2.' })
    // A repeated update about a job that already ended says nothing new.
    useActivityStore.getState().reset()
    recordJobOutcome(job('exited', 0), job('exited', 0))
    expect(useActivityStore.getState().items).toEqual([])
  })

  it('announces an app update when one is available or ready', () => {
    expect(updateActivity({ status: 'checking', availableVersion: null })).toBeNull()
    expect(updateActivity({ status: 'available', availableVersion: '1.4.0' })?.title).toBe('OXESpace 1.4.0 is available')
    expect(updateActivity({ status: 'downloaded', availableVersion: '1.4.0' })?.title).toBe('OXESpace 1.4.0 is ready')
    expect(updateActivity({ status: 'downloading', availableVersion: '1.4.0' })).toBeNull()
  })
})
