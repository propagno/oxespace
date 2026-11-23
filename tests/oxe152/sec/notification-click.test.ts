// Frozen acceptance test for OXE-368 A5, A6 (program 152sec, phase F1). Written by the planner; the executor must not edit it.
// Contract: src/app/desktopNotifications.ts exports
//   activateNotification(target: { paneId, workspaceId }, app: { activeWorkspaceId, showCode(), showThread(id), activateWorkspace(id), setActivePane(id) }): void
//   startNotificationPreferenceSync(): () => void   (sends the preference now and on each change)
// and src/App.tsx uses both.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { THREAD_NOTIFICATION_PANE_PREFIX } from '../../../src/hooks/useThreadAttention'
import { QUOTA_NOTIFICATION_PANE_PREFIX } from '../../../src/hooks/useQuotaAlerts'
import { useSettingsStore } from '../../../src/store/settings.store'

interface App { activeWorkspaceId: string | null; showCode(): void; showThread(id: string): void; activateWorkspace(id: string): void; setActivePane(id: string): void }
interface DesktopNotifications {
  activateNotification(target: { paneId: string; workspaceId: string }, app: App): void
  startNotificationPreferenceSync(): () => void
}
async function load(): Promise<DesktopNotifications> {
  const file = pathToFileURL(join(process.cwd(), 'src/app/desktopNotifications.ts')).href
  const found = await import(/* @vite-ignore */ file).then(module => module as DesktopNotifications, () => null)
  expect(found, 'src/app/desktopNotifications.ts').not.toBeNull()
  return found!
}
const fakeApp = (): App => ({ activeWorkspaceId: 'ws-1', showCode: vi.fn(), showThread: vi.fn(), activateWorkspace: vi.fn(), setActivePane: vi.fn() })
const original = window.oxe
afterEach(() => { useSettingsStore.setState({ notificationsEnabled: true }); window.oxe = original })

describe('OXE-368 · clicking a notification', () => {
  it('the test notification click changes nothing', async () => {
    const { activateNotification } = await load()
    const app = fakeApp()
    activateNotification({ paneId: 'test', workspaceId: 'test' }, app)
    for (const call of [app.showCode, app.showThread, app.activateWorkspace, app.setActivePane]) expect(call).not.toHaveBeenCalled()
  })

  it('a Code pane notification brings the Code view', async () => {
    const { activateNotification } = await load()
    const app = fakeApp()
    activateNotification({ paneId: 'pane-9', workspaceId: 'ws-2' }, app)
    expect(app.showCode).toHaveBeenCalledTimes(1)
    expect(app.activateWorkspace).toHaveBeenCalledWith('ws-2')
    expect(app.setActivePane).toHaveBeenCalledWith('pane-9')
  })

  it('conversation and quota notifications keep their destinations', async () => {
    const { activateNotification } = await load()
    const app = fakeApp()
    activateNotification({ paneId: `${QUOTA_NOTIFICATION_PANE_PREFIX}claude`, workspaceId: '' }, app)
    expect(app.showThread).not.toHaveBeenCalled()
    activateNotification({ paneId: `${THREAD_NOTIFICATION_PANE_PREFIX}t-7`, workspaceId: '' }, app)
    expect(app.showThread).toHaveBeenCalledWith('t-7')
    expect(app.showCode).not.toHaveBeenCalled()
    expect(app.setActivePane).not.toHaveBeenCalled()
  })

  it('the window sends the notification preference at start and on change', async () => {
    const { startNotificationPreferenceSync } = await load()
    const setEnabled = vi.fn(async (_enabled: boolean) => undefined)
    window.oxe = { ...original, notifications: { setEnabled } } as unknown as typeof window.oxe
    useSettingsStore.setState({ notificationsEnabled: false })
    const stop = startNotificationPreferenceSync()
    expect(setEnabled).toHaveBeenLastCalledWith(false)
    useSettingsStore.setState({ notificationsEnabled: true })
    expect(setEnabled).toHaveBeenLastCalledWith(true)
    stop()
    useSettingsStore.setState({ notificationsEnabled: false })
    expect(setEnabled).toHaveBeenCalledTimes(2)
  })

  it('the app uses both desktop notification helpers', () => {
    const app = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8')
    expect(app).toMatch(/activateNotification\(/)
    expect(app).toMatch(/startNotificationPreferenceSync/)
  })
})
