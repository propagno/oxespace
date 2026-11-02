/**
 * The E2E agent-state hook as an E2E run gets it: `registerE2eMockIpcHandlers` with the flag on, a pane of a mock
 * workspace, and the events the window receives on the production channels.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeIpcMain } from '../helpers/fake-ipc-main'
import { IPC_CHANNELS } from '../../shared/types/ipc'
import type { Workspace } from '../../shared/types/workspace'
import type { E2eAgentStateFn } from '../../electron/main/e2e/agent-state-hook'

const electron = vi.hoisted(() => {
  const sent: Array<{ channel: string; payload: unknown }> = []
  const window = { isDestroyed: () => false, webContents: { send: (channel: string, payload: unknown) => { sent.push({ channel, payload }) } } }
  return { sent, window, ipc: null as null | ReturnType<typeof createFakeIpcMain>, packaged: false }
})

vi.mock('electron', async () => {
  const { createFakeIpcMain: create } = await import('../helpers/fake-ipc-main')
  electron.ipc ??= create()
  return {
    ipcMain: electron.ipc,
    app: { get isPackaged() { return electron.packaged }, getPath: () => mkdtempSync(join(tmpdir(), 'e2ea-')), getVersion: () => '0.0.0' },
    BrowserWindow: { getAllWindows: () => [electron.window], fromWebContents: () => electron.window },
    safeStorage: { isEncryptionAvailable: () => false },
    shell: {},
    dialog: {}
  }
})

const hook = () => (globalThis as Record<string, unknown>).__oxeE2eAgentState as E2eAgentStateFn | undefined
const sentOn = (channel: string) => electron.sent.filter(item => item.channel === channel).map(item => item.payload)

describe('E2E agent-state hook through the E2E mock registration', () => {
  const saved = { mock: process.env.OXESPACE_E2E_MOCK_NATIVE, flag: process.env.OXESPACE_E2E_AGENT_STATE }

  beforeEach(() => {
    vi.resetModules()
    electron.sent.length = 0
    for (const channel of electron.ipc?.channels() ?? []) electron.ipc!.removeHandler(channel)
    delete (globalThis as Record<string, unknown>).__oxeE2eAgentState
    process.env.OXESPACE_E2E_MOCK_NATIVE = '1'
  })
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__oxeE2eAgentState
    if (saved.mock === undefined) delete process.env.OXESPACE_E2E_MOCK_NATIVE; else process.env.OXESPACE_E2E_MOCK_NATIVE = saved.mock
    if (saved.flag === undefined) delete process.env.OXESPACE_E2E_AGENT_STATE; else process.env.OXESPACE_E2E_AGENT_STATE = saved.flag
  })

  it('without its flag, an E2E run has no hook', async () => {
    delete process.env.OXESPACE_E2E_AGENT_STATE
    const { registerE2eMockIpcHandlers } = await import('../../electron/main/e2e/mock-ipc')
    registerE2eMockIpcHandlers()
    expect(hook()).toBeUndefined()
  })

  it('injects blocked, then done, on a real mock pane: production events and explain each time', async () => {
    process.env.OXESPACE_E2E_AGENT_STATE = '1'
    const { registerE2eMockIpcHandlers } = await import('../../electron/main/e2e/mock-ipc')
    registerE2eMockIpcHandlers()
    const ipc = electron.ipc!
    const workspace = await ipc.invoke(IPC_CHANNELS.workspace.create, { rootPath: tmpdir(), layoutPreset: 1 }) as Workspace
    const paneId = workspace.panes[0].id
    const set = hook()!
    expect(typeof set).toBe('function')

    // Blocked on the person's decision.
    const blocked = set({ paneId, state: 'waiting', hookEvent: 'PermissionRequest' })
    expect(blocked).toMatchObject({ ok: true, explain: { state: { paneId, workspaceId: workspace.id, agent: 'claude', state: 'blocked', source: 'hook' } } })
    expect(sentOn(IPC_CHANNELS.agentState.onChanged).at(-1)).toMatchObject({ paneId, state: 'blocked', source: 'hook' })
    expect(sentOn(IPC_CHANNELS.agentHooks.onStatus).at(-1)).toMatchObject({ paneId, agent: 'claude-code', state: 'waiting', event: 'PermissionRequest' })
    expect(await ipc.invoke(IPC_CHANNELS.agentState.explain, paneId)).toEqual(blocked.ok && blocked.explain)

    // The person answers, the turn goes on and finishes: done, waiting for the next prompt.
    expect(set({ paneId, state: 'working' })).toMatchObject({ ok: true, explain: { state: { state: 'working' } } })
    const done = set({ paneId, state: 'done' })
    expect(done).toMatchObject({ ok: true, explain: { state: { state: 'done', source: 'hook', seen: false, completionSeq: 1 } } })
    expect(sentOn(IPC_CHANNELS.agentState.onChanged).at(-1)).toMatchObject({ paneId, state: 'done', source: 'hook', completionSeq: 1 })
    expect(await ipc.invoke(IPC_CHANNELS.agentState.explain, paneId)).toEqual(done.ok && done.explain)
    expect(await ipc.invoke(IPC_CHANNELS.agentState.list)).toEqual([expect.objectContaining({ paneId, state: 'done' })])

    // Looking at the pane turns done into idle, through the production markSeen handler.
    await ipc.invoke(IPC_CHANNELS.agentState.markSeen, paneId)
    expect(sentOn(IPC_CHANNELS.agentState.onChanged).at(-1)).toMatchObject({ paneId, state: 'idle', seen: true })

    expect(set({ paneId: 'not-a-pane', state: 'waiting' })).toEqual({ ok: false, refusal: 'unknown-pane' })
  })

  it('a packaged build has no hook, even with both flags', async () => {
    process.env.OXESPACE_E2E_AGENT_STATE = '1'
    electron.packaged = true
    try {
      const { registerE2eMockIpcHandlers } = await import('../../electron/main/e2e/mock-ipc')
      registerE2eMockIpcHandlers()
      expect(hook()).toBeUndefined()
    } finally { electron.packaged = false }
  })
})
