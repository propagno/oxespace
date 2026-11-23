// @vitest-environment node
// Frozen acceptance test for OXE-368 A5 (program 152sec, phase F1). Written by the planner; the executor must not edit it.
// Contract: the window tells main through `notifications:set-enabled` (preload notifications.setEnabled). With it off,
// main shows no desktop notification by any of its four roads. The taskbar flash of a waiting approval stays.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const main = vi.hoisted(() => ({
  created: [] as Array<Record<string, unknown>>,
  flashed: 0,
  center: null as null | { attention: () => void },
  handlers: new Map<string, (event: unknown, value?: unknown) => unknown>()
}))
vi.mock('electron', () => ({
  app: { getPath: () => '', isPackaged: true, on: () => undefined, once: () => undefined },
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, value?: unknown) => unknown) => { main.handlers.set(channel, handler) },
    on: () => undefined
  },
  BrowserWindow: {
    getAllWindows: () => [{
      isDestroyed: () => false, isFocused: () => false, flashFrame: (on: boolean) => { if (on) main.flashed += 1 }, once: () => undefined,
      webContents: { isDestroyed: () => false, isCrashed: () => false, send: () => undefined }
    }],
    fromWebContents: () => null
  },
  Notification: class {
    static isSupported(): boolean { return true }
    constructor(options: Record<string, unknown>) { main.created.push(options) }
    on(): void {}
    show(): void {}
  }
}))
vi.mock('../../../electron/main/i18n', () => ({ tMain: (key: string) => key, mainLanguage: () => 'en' }))
vi.mock('../../../electron/main/services/approvals/approval-center', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ApprovalCenter: class { constructor(deps: { attention: () => void }) { main.center = deps } }
}))

// vi.mock is hoisted above these imports.
import { registerNotificationsIpc } from '../../../electron/main/ipc/notifications.ipc'
import { showAgentNotice } from '../../../electron/main/services/approvals/wiring'
import { approvalCenter } from '../../../electron/main/services/approvals/index'

const requester = { kind: 'agent', id: 'thread:t1', label: { code: 'approvals.requester.preview', params: {} } } as never
const event = { sender: {} }
function setEnabled(enabled: boolean): void {
  const handler = main.handlers.get('notifications:set-enabled')
  expect(handler, 'main takes the Desktop notifications preference').toBeTypeOf('function')
  handler!(event, enabled)
}
const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 20))

beforeEach(() => { main.created.length = 0; main.flashed = 0; main.handlers.clear(); registerNotificationsIpc() })
afterEach(() => { main.handlers.get('notifications:set-enabled')?.(event, true) })

describe('OXE-368 · Desktop notifications off', () => {
  it('an agent notice is not shown with desktop notifications off', () => {
    setEnabled(false)
    expect(showAgentNotice(requester, 'Done', 'All green')).toBe(false)
    expect(main.created).toEqual([])
  })

  it('a waiting approval flashes the window without a notification with desktop notifications off', async () => {
    setEnabled(false)
    expect(approvalCenter).toBeDefined()
    main.center!.attention()
    await settle()
    expect(main.created).toEqual([])
    expect(main.flashed).toBe(1)
  })

  it('the notify channel shows nothing with desktop notifications off', () => {
    setEnabled(false)
    expect(main.handlers.get('notifications:notify')!(event, { title: 'Claude', body: 'Finished', paneId: 'p', workspaceId: 'w' })).toBe(false)
    expect(main.created).toEqual([])
  })

  it('desktop notifications return when the preference is on again', async () => {
    setEnabled(false)
    setEnabled(true)
    main.center!.attention()
    await settle()
    expect(main.created).toHaveLength(1)
  })

  it('only a boolean changes the preference', () => {
    setEnabled(false)
    try { main.handlers.get('notifications:set-enabled')!(event, 'yes') } catch { /* refusing by throwing is fine */ }
    expect(showAgentNotice(requester, 'Done', '')).toBe(false)
  })

  it('the approval notifier of the main process reads the preference', () => {
    const source = readFileSync(join(process.cwd(), 'electron/main/index.ts'), 'utf8')
    const notifier = source.slice(source.indexOf('new ApprovalNotifier('), source.indexOf('openRequest: requestId', source.indexOf('new ApprovalNotifier(')))
    expect(notifier).not.toMatch(/enabled:\s*\(\)\s*=>\s*true/)
    expect(notifier).toMatch(/enabled:.*notificationsEnabled/)
  })
})
