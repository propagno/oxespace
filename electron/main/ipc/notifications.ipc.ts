import { BrowserWindow, ipcMain, Notification } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { AgentNotificationPayload } from '../../../shared/types/ipc'

/**
 * Native desktop notifications for agent state changes (Horizon 1 · item 1).
 *
 * Fired from the renderer's useAgentNotifications hook when a non-focused pane
 * finishes / needs input / errors. Clicking the notification restores + focuses
 * the window and tells the renderer which pane to activate.
 */
export function registerNotificationsIpc(): void {
  ipcMain.handle(IPC_CHANNELS.notifications.notify, (_event, payload: AgentNotificationPayload) => {
    if (!Notification.isSupported()) return false
    const notification = new Notification({
      title: payload.title,
      body: payload.body,
      silent: false
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
