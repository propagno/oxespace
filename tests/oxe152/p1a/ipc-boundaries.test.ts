// @vitest-environment node
// Frozen acceptance test for OXE-361 A9, A12 (program 152p1a, phase F1). Written by the planner; the executor must not edit it.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import { MCP_COVERAGE } from '../../../shared/mcp-coverage'

const main = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  sent: [] as Array<{ channel: string; payload: unknown }>,
  preview: { setAccess: vi.fn(), mount: vi.fn(), close: vi.fn() }
}))
vi.mock('electron', () => {
  const window = { isDestroyed: () => false, webContents: { send: (channel: string, payload: unknown) => { main.sent.push({ channel, payload }) } } }
  return {
    ipcMain: { handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => { main.handlers.set(channel, handler) }, on: () => undefined },
    BrowserWindow: { getAllWindows: () => [window], fromWebContents: () => window }
  }
})
vi.mock('../../../electron/main/services/browser-preview.service', () => ({ browserPreviewService: main.preview }))
vi.mock('../../../electron/main/services/oxequery/audit-log', () => ({ auditWritten: {} }))

import { registerGitIpc } from '../../../electron/main/ipc/git.ipc'
import { registerDelegationIpc } from '../../../electron/main/ipc/delegation.ipc'
import { registerAgentActivityIpc } from '../../../electron/main/ipc/agent-activity.ipc'
import { registerBrowserPreviewIpc } from '../../../electron/main/ipc/browser-preview.ipc'

const event = { sender: {} }
/** A handler's refusal, whether it throws or rejects; null when it accepted. */
async function refusal(channel: string, ...args: unknown[]): Promise<unknown> {
  try { await main.handlers.get(channel)!(event, ...args); return null } catch (error) { return error ?? new Error('refused') }
}
beforeEach(() => {
  main.handlers.clear()
  main.sent.length = 0
  for (const mock of Object.values(main.preview)) mock.mockReset()
})

describe('OXE-361 · IPC', () => {
  it('a pushed diff names the root it was computed for', async () => {
    let emit: ((diff: unknown) => void) | null = null
    const diff = { files: [], base: 'origin/main', includeUncommitted: true, compiledAt: 1 }
    registerGitIpc({ buildDiff: async () => diff, watchDiff: (_root: string, send: (value: unknown) => void) => { emit = send } } as never)
    await main.handlers.get(IPC_CHANNELS.git.getDiff)!(event, { workspaceId: 'wb', rootPath: '/repo-b', base: 'origin/main', includeUncommitted: true })
    ;(emit as unknown as (value: unknown) => void)(diff)
    expect(main.sent.at(-1)).toMatchObject({ channel: IPC_CHANNELS.git.onDiffUpdate, payload: { rootPath: '/repo-b' } })
  })

  it('delegation channels refuse malformed input before the service', async () => {
    const service = { configureTarget: vi.fn(), configure: vi.fn(), status: vi.fn(), preview: vi.fn(), control: vi.fn() }
    registerDelegationIpc(service as never)
    const d = IPC_CHANNELS.delegation
    expect(await refusal(d.configureTarget, 'ws', { path: 'x' }, true, false)).not.toBeNull()
    expect(await refusal(d.configureTarget, 'ws', '/repo', 'yes', false)).not.toBeNull()
    expect(await refusal(d.configure, 'ws', 'yes')).not.toBeNull()
    expect(await refusal(d.preview, 'ws', { objective: 1 }, undefined)).not.toBeNull()
    for (const method of [service.configureTarget, service.configure, service.preview]) expect(method).not.toHaveBeenCalled()
  })

  it('agent activity channels refuse malformed input before the service', async () => {
    const activity = { list: vi.fn(), detail: vi.fn(), badge: vi.fn(), onChanged: vi.fn(), notifyChanged: vi.fn() }
    registerAgentActivityIpc(activity as never)
    const a = IPC_CHANNELS.agentActivity
    expect(await refusal(a.list, 'everything')).not.toBeNull()
    expect(await refusal(a.detail, { id: 1 })).not.toBeNull()
    expect(await refusal(a.badge, { connectionId: 'x'.repeat(5000) })).not.toBeNull()
    for (const method of [activity.list, activity.detail, activity.badge]) expect(method).not.toHaveBeenCalled()
  })

  it('browser preview channels refuse malformed input before the service', async () => {
    registerBrowserPreviewIpc()
    const p = IPC_CHANNELS.browserPreview
    for (const channel of [p.mount, p.setAccess, p.close]) {
      expect(await refusal(channel, null), channel).not.toBeNull()
      expect(await refusal(channel, { ownerKey: { nested: true }, tabId: 'x' }), channel).not.toBeNull()
    }
    for (const method of Object.values(main.preview)) expect(method).not.toHaveBeenCalled()
  })

  it('the obsolete capture channel is gone from IPC, preload and coverage', () => {
    expect(Object.values(IPC_CHANNELS.mcpInternal)).not.toContain('mcp-internal:capture-web-preview')
    expect(JSON.stringify(MCP_COVERAGE)).not.toContain('mcpInternal.captureWebPreview')
    expect(readFileSync(join(process.cwd(), 'electron/preload/api.ts'), 'utf8')).not.toContain('captureWebPreview')
  })

  // rigor: source-assertion — registerThreadIpc needs the whole app to build; the opener it must use is tested on its own.
  it('the account login opens links through the guarded opener', () => {
    const source = readFileSync(join(process.cwd(), 'electron/main/ipc/thread.ipc.ts'), 'utf8')
    expect(source).toMatch(/openExternalOrRecord\(/)
    expect(source).not.toMatch(/shell\.openExternal\(/)
  })
})
