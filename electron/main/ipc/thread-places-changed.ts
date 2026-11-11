import { BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import type { ThreadManager } from '../services/conversation/thread-manager'

/** CR-F4-7b: each places change of any conversation reaches every live window as { threadId }, nothing else. */
export function forwardPlacesChanged({ manager }: { manager: Promise<Pick<ThreadManager, 'subscribePlaces'>> }): void {
  void manager.then(service => service.subscribePlaces('*', threadId => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed() || window.webContents.isDestroyed()) continue
      window.webContents.send(IPC_CHANNELS.thread.placesChanged, { threadId })
    }
  }), () => undefined)
}
