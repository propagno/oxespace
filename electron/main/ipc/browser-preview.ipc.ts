import { BrowserWindow, ipcMain, type WebContents } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import { DESIGN_MODE_CHANNELS, type DesignGrabPayload } from '../../../shared/types/design-mode'
import type { BrowserPreviewBounds, BrowserPreviewMount } from '../../../shared/types/browser-preview'

/**
 * The browser preview's channels, registered at boot. The service itself (tabs, views, captures) loads on the first
 * call, so the main entry does not carry it until a preview opens.
 */
export function registerBrowserPreviewIpc(): void {
  const service = () => import('../services/browser-preview.service').then(module => module.browserPreviewService)
  const windowFor = (sender: WebContents): BrowserWindow => {
    const window = BrowserWindow.fromWebContents(sender)
    if (!window || window.isDestroyed()) throw new Error('Browser window unavailable')
    return window
  }
  ipcMain.handle(IPC_CHANNELS.browserPreview.mount, async (event, input: BrowserPreviewMount) => { const window = windowFor(event.sender); return (await service()).mount(window, input) })
  ipcMain.handle(IPC_CHANNELS.browserPreview.session, async (event, input) => { const window = windowFor(event.sender); return (await service()).session(window, input) })
  ipcMain.handle(IPC_CHANNELS.browserPreview.bounds, async (event, input: BrowserPreviewBounds) => { const window = windowFor(event.sender); return (await service()).bounds(window, input) })
  ipcMain.handle(IPC_CHANNELS.browserPreview.setAccess, async (event, input) => { const window = windowFor(event.sender); return (await service()).setAccess(window, input) })
  ipcMain.handle(IPC_CHANNELS.browserPreview.designMode, async (event, input) => { const window = windowFor(event.sender); return (await service()).designMode(window, input) })
  ipcMain.handle(IPC_CHANNELS.browserPreview.setZoom, async (event, input) => { const window = windowFor(event.sender); return (await service()).setZoom(window, input) })
  ipcMain.handle(IPC_CHANNELS.browserPreview.reload, async (event, input) => { const window = windowFor(event.sender); return (await service()).reload(window, input) })
  ipcMain.handle(IPC_CHANNELS.browserPreview.back, async (event, input) => { const window = windowFor(event.sender); return (await service()).back(window, input) })
  ipcMain.handle(IPC_CHANNELS.browserPreview.forward, async (event, input) => { const window = windowFor(event.sender); return (await service()).forward(window, input) })
  ipcMain.handle(IPC_CHANNELS.browserPreview.captureElement, async (event, input) => { const window = windowFor(event.sender); return (await service()).captureElement(window, input) })
  ipcMain.handle(IPC_CHANNELS.browserPreview.captureClipboard, async (event, input) => { const window = windowFor(event.sender); return (await service()).captureClipboard(window, input) })
  ipcMain.handle(IPC_CHANNELS.browserPreview.close, async (event, input) => { const window = windowFor(event.sender); return (await service()).close(window, input) })
  // A grab before any preview opened has no tab to belong to; the service drops it either way.
  ipcMain.on(DESIGN_MODE_CHANNELS.grab, (event, payload: DesignGrabPayload) => { const sender = event.sender; void service().then(preview => preview.handleDesignMessage(sender, 'grab', payload)) })
  ipcMain.on(DESIGN_MODE_CHANNELS.cancel, event => { const sender = event.sender; void service().then(preview => preview.handleDesignMessage(sender, 'cancel')) })
}
