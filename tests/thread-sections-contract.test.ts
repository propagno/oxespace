import { beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (event: unknown, ...args: unknown[]) => unknown
const handlers = new Map<string, Handler>()
vi.mock('electron', () => ({ ipcMain: { handle: (channel: string, handler: Handler) => { handlers.set(channel, handler) } } }))

import { createOxeApi, type PreloadIpc } from '../electron/preload/api'
import { registerThreadSectionsIpc } from '../electron/main/ipc/thread-sections.ipc'
import { registerThreadSectionsMock } from '../electron/main/e2e/thread-sections-mock'
import { MCP_COVERAGE } from '../shared/mcp-coverage'
import { isMessageCode } from '../shared/messages'
import { IPC_CHANNELS } from '../shared/types/ipc'
import { THREAD_SECTIONS_REFUSALS } from '../shared/types/thread-sections'
import type { AppDatabase } from '../electron/main/db'

beforeEach(() => handlers.clear())

describe('thread sections contract (F13)', () => {
  it('uses two stable invoke channels in the thread group', () => {
    expect([IPC_CHANNELS.thread.sections, IPC_CHANNELS.thread.saveSections]).toEqual(['thread:sections', 'thread:sections-save'])
  })

  it('is forbidden to agents for 1.4', () => {
    const capability = MCP_COVERAGE['thread.sections']
    expect('forbidden' in capability && !('tools' in capability)).toBe(true)
    expect(capability.ipc).toEqual(['thread.sections', 'thread.saveSections'])
  })

  it('refuses with message codes', () => {
    for (const refusal of THREAD_SECTIONS_REFUSALS) expect(isMessageCode(`thread.sections.${refusal}`), refusal).toBe(true)
  })

  it('exposes both calls through the preload', async () => {
    const ipc: PreloadIpc = { invoke: vi.fn().mockResolvedValue(undefined), on: vi.fn(), removeListener: vi.fn() }
    const thread = createOxeApi(ipc).thread!
    const state = { sections: [{ id: 's1', name: 'Work', order: 0 }], assignments: { t1: 's1' } }
    await thread.sections!('thread:p1')
    await thread.saveSections!('thread:p1', state)
    expect(vi.mocked(ipc.invoke).mock.calls).toEqual([[IPC_CHANNELS.thread.sections, 'thread:p1'], [IPC_CHANNELS.thread.saveSections, 'thread:p1', state]])
  })
})

describe('thread sections IPC (main)', () => {
  const db = { prepare: vi.fn(() => { throw new Error('the database must not be reached') }) } as unknown as AppDatabase

  // Only the app window's main frame reaches these handlers: the central sender guard (B12) refuses every other sender
  // on every channel, these included (tests/unit/ipc-sender-guard.test.ts).

  it('refuses a nonsensical workspace id with its code, before touching the store', async () => {
    registerThreadSectionsIpc({ db })
    await expect(async () => handlers.get(IPC_CHANNELS.thread.sections)!({}, 42)).rejects.toThrow('thread.sections.invalid')
    await expect(handlers.get(IPC_CHANNELS.thread.saveSections)!({}, '', { sections: [], assignments: {} }))
      .resolves.toEqual({ ok: false, refusal: 'invalid', message: { code: 'thread.sections.invalid', params: {} } })
  })
})

describe('thread sections E2E mock', () => {
  it('keeps state in memory with the shared validation', async () => {
    registerThreadSectionsMock(id => id === 'code-1')
    const list = handlers.get(IPC_CHANNELS.thread.sections)!
    const save = handlers.get(IPC_CHANNELS.thread.saveSections)!
    expect(await list({}, 'thread:p1')).toEqual({ sections: [], assignments: {} })
    expect(await save({}, 'thread:p1', { sections: [{ id: 'b', name: ' Later ', order: 9 }, { id: 'a', name: 'First', order: 2 }], assignments: { t1: 'b' } })).toEqual({ ok: true, state: {
      sections: [{ id: 'a', name: 'First', order: 0, collapsed: false }, { id: 'b', name: 'Later', order: 1, collapsed: false }], assignments: { t1: 'b' }
    } })
    expect(await save({}, 'thread:p1', { sections: [{ id: 'a', name: 'X', order: 0 }, { id: 'b', name: 'x', order: 1 }], assignments: {} })).toMatchObject({ ok: false, refusal: 'nameDuplicate' })
    expect((await list({}, 'thread:p1') as { sections: unknown[] }).sections).toHaveLength(2)
    expect(await save({}, 'code-1', { sections: [], assignments: {} })).toMatchObject({ ok: true })
    expect(await save({}, 'code-2', { sections: [], assignments: {} })).toMatchObject({ ok: false, refusal: 'unknownWorkspace' })
    await expect(async () => list({}, 'code-2')).rejects.toThrow('thread.sections.unknownWorkspace')
  })
})
