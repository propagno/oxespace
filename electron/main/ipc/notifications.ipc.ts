import { BrowserWindow, ipcMain, Notification } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { AgentNotificationPayload } from '../../../shared/types/ipc'
import { notificationsEnabled, setNotificationsEnabled } from '../services/notification-preference'
import { parseRecord, parseText } from './ipc-guards'

/** Read by the entry file's approval notifier, next to the registration it already imports. */
export { notificationsEnabled }

/**
 * Native desktop notifications for agent state changes (Horizon 1 · item 1).
 *
 * Fired from the renderer's useAgentNotifications hook when a non-focused pane
 * finishes / needs input / errors. Clicking the notification restores + focuses
 * the window and tells the renderer which pane to activate.
 *
 * The payload's `silent` picks the sound (OXE-130); without it, the system sound. The system's do-not-disturb mode
 * is never bypassed: no urgency, no timeout, no toast XML.
 *
 * OXE-368: `notifications:set-enabled` carries Settings › Desktop notifications to main (a boolean, nothing else).
 * With it off, nothing is shown here or by any other road of the main process.
 */
export function registerNotificationsIpc(): void {
  ipcMain.handle(IPC_CHANNELS.notifications.setEnabled, (_event, value: unknown) => {
    if (typeof value !== 'boolean') throw new Error('Desktop notifications must be true or false')
    setNotificationsEnabled(value)
  })
  ipcMain.handle(IPC_CHANNELS.notifications.notify, (event, value: unknown) => {
    const input = parseRecord(value, 'Notification')
    const payload: AgentNotificationPayload = { title: parseText(input.title, 'Title', 200), body: parseText(input.body, 'Body', 1000), paneId: parseText(input.paneId, 'Pane id', 200), workspaceId: parseText(input.workspaceId, 'Workspace id', 200), silent: input.silent === true }
    if (!notificationsEnabled() || !Notification.isSupported()) return false
    const notification = new Notification({
      title: payload.title,
      body: payload.body,
      silent: payload.silent === true
    })
    notification.on('click', () => {
      const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
      if (!win) return
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
      win.webContents.send(IPC_CHANNELS.notifications.onActivate, {
        paneId: payload.paneId,
        workspaceId: payload.workspaceId
      })
    })
    notification.show()
    return true
  })
}
