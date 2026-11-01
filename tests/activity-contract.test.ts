import { beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (event: unknown, ...args: unknown[]) => unknown
const handlers = new Map<string, Handler>()
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: Handler) => { handlers.set(channel, handler) } }
}))

import { createOxeApi, type PreloadIpc } from '../electron/preload/api'
import { registerActivityIpc } from '../electron/main/ipc/activity.ipc'
import { registerActivityMock } from '../electron/main/e2e/activity-mock'
import { MCP_COVERAGE } from '../shared/mcp-coverage'
import { isMessageCode } from '../shared/messages'
import { IPC_CHANNELS } from '../shared/types/ipc'
import { ACTIVITY_REFUSALS, type ActivityEntry } from '../shared/types/activity'
import type { AppDatabase } from '../electron/main/db'

beforeEach(() => { handlers.clear() })

const NOW = 1_800_000_000_000
const entry = (id: string, at: number, title = id): ActivityEntry => ({ source: 'thread', id, kind: 'finished', target: { type: 'thread', threadId: id }, title, at })

describe('activity contract (F30)', () => {
  it('uses four stable invoke channels in their own group', () => {
    expect(IPC_CHANNELS.activity).toEqual({ recent: 'activity:recent', record: 'activity:record', seen: 'activity:seen', resolve: 'activity:resolve' })
  })

  it('is forbidden to agents for 1.4', () => {
    const capability = MCP_COVERAGE['app.activity']
    expect('forbidden' in capability && !('tools' in capability)).toBe(true)
    expect(capability.ipc).toEqual(['activity.recent', 'activity.record', 'activity.seen', 'activity.resolve'])
  })

  it('refuses with message codes', () => {
    for (const refusal of ACTIVITY_REFUSALS) expect(isMessageCode(`activity.${refusal}`), refusal).toBe(true)
  })

  it('exposes the four calls through the preload', async () => {
    const ipc: PreloadIpc = { invoke: vi.fn().mockResolvedValue(undefined), on: vi.fn(), removeListener: vi.fn() }
    const activity = createOxeApi(ipc).activity!
    const entries = [entry('t1', NOW)]
    await activity.recent!()
    await activity.record!(entries)
    await activity.seen!(NOW)
    await activity.resolve!({ source: 'thread', id: 't1', kind: 'finished' })
    expect(vi.mocked(ipc.invoke).mock.calls).toEqual([[IPC_CHANNELS.activity.recent], [IPC_CHANNELS.activity.record, entries], [IPC_CHANNELS.activity.seen, NOW],
      [IPC_CHANNELS.activity.resolve, { source: 'thread', id: 't1', kind: 'finished' }]])
  })
})

describe('activity IPC (main)', () => {
  const db = { prepare: vi.fn(() => { throw new Error('the database must not be reached') }), transaction: vi.fn() } as unknown as AppDatabase

  it('refuses nonsense with its code before touching the database', async () => {
    registerActivityIpc({ db })
    await expect(handlers.get(IPC_CHANNELS.activity.record)!({}, 'not a list')).resolves.toEqual({ ok: false, refusal: 'invalid', message: { code: 'activity.invalid', params: {} } })
    await expect(handlers.get(IPC_CHANNELS.activity.seen)!({}, Date.now() + 120_000)).resolves.toMatchObject({ ok: false, refusal: 'future' })
    await expect(handlers.get(IPC_CHANNELS.activity.resolve)!({}, { source: 'thread', id: 't1' })).resolves.toMatchObject({ ok: false, refusal: 'invalid' })
    expect(db.prepare).not.toHaveBeenCalled()
  })
})

describe('activity E2E mock', () => {
  it('keeps state in memory with the shared validation and merge', async () => {
    registerActivityMock(() => NOW)
    const recent = handlers.get(IPC_CHANNELS.activity.recent)!
    const record = handlers.get(IPC_CHANNELS.activity.record)!
    const seen = handlers.get(IPC_CHANNELS.activity.seen)!
    expect(await recent({})).toEqual({ entries: [], lastSeenAt: null })
    expect(await record({}, [entry('a', NOW - 30), entry('b', NOW - 10), entry('a', NOW - 20, 'a again')])).toEqual({ ok: true, recorded: 2, ignored: 1 })
    expect(await record({}, [entry('c', NOW), { ...entry('d', NOW), title: 'password=' + 'hunter22' }])).toMatchObject({ ok: false, refusal: 'secret' })
    expect(await recent({})).toEqual({ entries: [entry('b', NOW - 10), entry('a', NOW - 20, 'a again')], lastSeenAt: null })
    expect(await seen({}, NOW - 5)).toEqual({ ok: true, lastSeenAt: NOW - 5 })
    expect(await seen({}, NOW - 50)).toEqual({ ok: true, lastSeenAt: NOW - 5 })
    expect(await seen({}, NOW + 61_000)).toMatchObject({ ok: false, refusal: 'future' })
    expect((await recent({}) as { lastSeenAt: number }).lastSeenAt).toBe(NOW - 5)
    const resolve = handlers.get(IPC_CHANNELS.activity.resolve)!
    expect(await resolve({}, { source: 'thread', id: 'a', kind: 'finished' })).toEqual({ ok: true, removed: true })
    expect(await resolve({}, { source: 'thread', id: 'a', kind: 'finished' })).toEqual({ ok: true, removed: false })
    expect(await resolve({}, { source: 'thread', id: 'b', kind: 'finished', extra: 1 })).toMatchObject({ ok: false, refusal: 'invalid' })
    expect((await recent({}) as { entries: ActivityEntry[] }).entries.map(item => item.id)).toEqual(['b'])
  })
})
