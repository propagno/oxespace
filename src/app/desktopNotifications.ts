import { QUOTA_NOTIFICATION_PANE_PREFIX, THREAD_NOTIFICATION_PANE_PREFIX } from '../hooks/notificationPrefixes'
import { useSettingsStore } from '../store/settings.store'

/** What the window lends a notification click: the active workspace and the ways to change what is on screen. */
export interface NotificationApp {
  activeWorkspaceId: string | null
  showCode(): void
  showThread(id: string): void
  activateWorkspace(id: string): void
  setActivePane(id: string): void
}

/** The pane id Settings › Notifications gives its test notification: a click on it leads nowhere. */
const TEST_NOTIFICATION_PANE = 'test'

/**
 * A desktop notification was clicked (OXE-368). The test notification and a quota alert change nothing; a conversation's
 * notification opens that conversation; a pane's notification brings Code, the pane's workspace and the pane.
 */
export function activateNotification(target: { paneId: string; workspaceId: string }, app: NotificationApp): void {
  const { paneId, workspaceId } = target
  if (paneId === TEST_NOTIFICATION_PANE || paneId.startsWith(QUOTA_NOTIFICATION_PANE_PREFIX)) return
  if (paneId.startsWith(THREAD_NOTIFICATION_PANE_PREFIX)) {
    app.showThread(paneId.slice(THREAD_NOTIFICATION_PANE_PREFIX.length))
    return
  }
  app.showCode()
  if (app.activeWorkspaceId !== workspaceId) app.activateWorkspace(workspaceId)
  app.setActivePane(paneId)
}

/**
 * Tells the main process whether Settings › Desktop notifications is on: now, and on each change. Main shows its own
 * notifications (approvals, agent notices), so the preference has to reach it. Returns the way to stop.
 */
export function startNotificationPreferenceSync(): () => void {
  const send = (enabled: boolean): void => {
    try { void window.oxe?.notifications?.setEnabled?.(enabled)?.catch(() => undefined) } catch { /* a window without the bridge */ }
  }
  send(useSettingsStore.getState().notificationsEnabled)
  return useSettingsStore.subscribe((state, previous) => {
    if (state.notificationsEnabled !== previous.notificationsEnabled) send(state.notificationsEnabled)
  })
}
