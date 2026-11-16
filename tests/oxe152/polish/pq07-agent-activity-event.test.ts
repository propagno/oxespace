// Frozen acceptance test for 1.5.2 Polimento · OxeQuery, backend (Jira OXE-220, PQ-07·7, CA-3). Written by the planner;
// the executor must not edit it. Backend gap named by MARCA: a live agent-activity push for AgentActivityBadge.
// Contract (agreed in the plan): IPC_CHANNELS.agentActivity.changed is 'agentActivity:changed' (main -> renderer).
// AgentActivity gains notifyChanged(change: { connectionId?: string }); registerAgentActivityIpc(activity) sends every
// change to each open window (a destroyed window is skipped). The preload exposes
// window.oxe.agentActivity.onChanged(listener) -> unsubscribe, which hands the payload to the listener. Main calls
// notifyChanged when an OxeQuery audit entry is written and when an approval for a connection is asked or answered;
// that wiring is proved in the built app by e2e/polish/pq-07-7.spec.ts.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const { sent, windows } = vi.hoisted(() => ({
  sent: [] as Array<{ channel: string; payload: unknown }>,
  windows: [] as Array<{ isDestroyed: () => boolean; webContents: { send: (channel: string, payload: unknown) => void } }>
}))
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn(), removeHandler: vi.fn() },
  BrowserWindow: { getAllWindows: () => windows }
}))

const { IPC_CHANNELS } = await import('../../../shared/types/ipc')
const { openInMemoryDatabase } = await import('../../../electron/main/db')
const { AgentActivity } = await import('../../../electron/main/services/agent-activity/read-model')
const { registerAgentActivityIpc } = await import('../../../electron/main/ipc/agent-activity.ipc')
const { preloadOxe } = await import('../../acceptance/f4/crf4-8-preload')

const win = (destroyed = false) => ({ isDestroyed: () => destroyed, webContents: { send: (channel: string, payload: unknown) => { if (destroyed) throw new Error('destroyed'); sent.push({ channel, payload }) } } })
beforeEach(() => { sent.length = 0; windows.length = 0 })
afterEach(() => vi.clearAllMocks())

describe('PQ-07·7 backend · agentActivity:changed from main to the renderer', () => {
  test('the channel is agentActivity:changed', () => {
    expect((IPC_CHANNELS.agentActivity as Record<string, string>).changed).toBe('agentActivity:changed')
  })

  test('a change main records reaches every open window on that channel, with the connection it concerns', () => {
    windows.push(win(), win(true), win())
    const db = openInMemoryDatabase()
    const activity = new AgentActivity(db) as InstanceType<typeof AgentActivity> & { notifyChanged: (change: { connectionId?: string }) => void }
    registerAgentActivityIpc(activity)
    activity.notifyChanged({ connectionId: 'c1' })
    expect(sent).toEqual([{ channel: 'agentActivity:changed', payload: { connectionId: 'c1' } }, { channel: 'agentActivity:changed', payload: { connectionId: 'c1' } }])
    db.close()
  })

  test('the preload hands each change to window.oxe.agentActivity.onChanged, until unsubscribed', () => {
    const { emit } = preloadOxe({})
    const api = (globalThis as unknown as { window: { oxe: { agentActivity: { onChanged?: (listener: (change: unknown) => void) => () => void } } } }).window.oxe.agentActivity
    expect(typeof api.onChanged).toBe('function')
    const seen: unknown[] = []
    const off = api.onChanged!(change => seen.push(change))
    emit('agentActivity.changed', { connectionId: 'c1' })
    off()
    emit('agentActivity.changed', { connectionId: 'c2' })
    expect(seen).toEqual([{ connectionId: 'c1' }])
  })
})
