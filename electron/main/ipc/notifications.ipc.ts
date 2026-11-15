import { BrowserWindow, ipcMain, Notification } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { AgentNotificationPayload } from '../../../shared/types/ipc'
import { parseRecord, parseText } from './ipc-guards'

/**
 * Native desktop notifications for agent state changes (Horizon 1 · item 1).
 *
 * Fired from the renderer's useAgentNotifications hook when a non-focused pane
 * finishes / needs input / errors. Clicking the notification restores + focuses
 * the window and tells the renderer which pane to activate.
 *
 * The payload's `silent` picks the sound (OXE-130); without it, the system sound. The system's do-not-disturb mode
 * is never bypassed: no urgency, no timeout, no toast XML.
 */
export function registerNotificationsIpc(): void {
  ipcMain.handle(IPC_CHANNELS.notifications.notify, (event, value: unknown) => {
    const input = parseRecord(value, 'Notification')
    const payload: AgentNotificationPayload = { title: parseText(input.title, 'Title', 200), body: parseText(input.body, 'Body', 1000), paneId: parseText(input.paneId, 'Pane id', 200), workspaceId: parseText(input.workspaceId, 'Workspace id', 200), silent: input.silent === true }
    if (!Notification.isSupported()) return false
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
