import { BrowserWindow, ipcMain, type WebContents } from 'electron'
import { IPC_CHANNELS } from '../../../shared/types/ipc'
import { DESIGN_MODE_CHANNELS, type DesignGrabPayload } from '../../../shared/types/design-mode'
import type { BrowserPreviewApi } from '../../../shared/types/browser-preview'
import { expectBoolean, expectRecord, parseBoundedId, parseText } from './validation'

type Input<K extends Exclude<keyof BrowserPreviewApi, 'onEvent'>> = Parameters<BrowserPreviewApi[K]>[0]

// Checked, then passed on as sent: the service keys its tabs by these exact strings, and checks ranges itself.
function owned(value: unknown): Record<string, unknown> {
  const input = expectRecord(value, 'browser-preview input')
  parseBoundedId(input.ownerKey, 'ownerKey')
  return input
}

/** The tab id may be empty: the panel has none until its session opens, and can already be granted access. */
function tabInput<T>(value: unknown): T {
  parseText(owned(value).tabId, 'tabId', 512)
  return value as T
}

function sessionInput(value: unknown): Input<'session'> {
  const input = owned(value)
  if (input.tabId !== undefined) parseText(input.tabId, 'tabId', 512)
  return value as Input<'session'>
}

function mountInput(value: unknown): Input<'mount'> {
  const input = expectRecord(tabInput(value), 'browser-preview:mount input')
  parseBoundedId(input.workspaceId, 'workspaceId')
  if (input.threadId !== undefined) parseText(input.threadId, 'threadId', 512)
  parseText(input.url, 'url', 65536)
  expectBoolean(input.allowExternal, 'allowExternal')
  expectBoolean(input.agentAccess, 'agentAccess')
  return value as Input<'mount'>
}

function accessInput(value: unknown): Input<'setAccess'> {
  const input = expectRecord(tabInput(value), 'browser-preview:set-access input')
  expectBoolean(input.agentAccess, 'agentAccess')
  expectBoolean(input.allowExternal, 'allowExternal')
  for (const key of ['grant', 'autoVerify']) if (input[key] !== undefined) expectBoolean(input[key], key)
  return value as Input<'setAccess'>
}

function closeInput(value: unknown): Input<'close'> {
  const input = expectRecord(tabInput(value), 'browser-preview:close input')
  if (input.lease !== undefined) parseText(input.lease, 'lease', 512)
  return value as Input<'close'>
}

function rectInput<T>(value: unknown): T {
  expectRecord(expectRecord(tabInput(value), 'browser-preview capture input').rect, 'rect')
  return value as T
}

/**
 * The browser preview's channels, registered at boot. The service itself (tabs, views, captures) loads on the first
 * valid call, so the main entry does not carry it until a preview opens.
 */
export function registerBrowserPreviewIpc(): void {
  const service = () => import('../services/browser-preview.service').then(module => module.browserPreviewService)
  type Preview = Awaited<ReturnType<typeof service>>
  const windowFor = (sender: WebContents): BrowserWindow => {
    const window = BrowserWindow.fromWebContents(sender)
    if (!window || window.isDestroyed()) throw new Error('Browser window unavailable')
    return window
  }
  const handle = <T>(channel: string, parse: (value: unknown) => T, run: (preview: Preview, window: BrowserWindow, input: T) => unknown): void => {
    ipcMain.handle(channel, async (event, value: unknown) => {
      const window = windowFor(event.sender)
      const input = parse(value)
      return run(await service(), window, input)
    })
  }
  const channels = IPC_CHANNELS.browserPreview
  handle(channels.mount, mountInput, (preview, window, input) => preview.mount(window, input))
  handle(channels.session, sessionInput, (preview, window, input) => preview.session(window, input))
  handle(channels.bounds, tabInput<Input<'bounds'>>, (preview, window, input) => preview.bounds(window, input))
  handle(channels.setAccess, accessInput, (preview, window, input) => preview.setAccess(window, input))
  handle(channels.designMode, tabInput<Input<'designMode'>>, (preview, window, input) => preview.designMode(window, input))
  handle(channels.setZoom, tabInput<Input<'setZoom'>>, (preview, window, input) => preview.setZoom(window, input))
  handle(channels.reload, tabInput<Input<'reload'>>, (preview, window, input) => preview.reload(window, input))
  handle(channels.back, tabInput<Input<'back'>>, (preview, window, input) => preview.back(window, input))
  handle(channels.forward, tabInput<Input<'forward'>>, (preview, window, input) => preview.forward(window, input))
  handle(channels.captureElement, rectInput<Input<'captureElement'>>, (preview, window, input) => preview.captureElement(window, input))
  handle(channels.captureElementFile, rectInput<Input<'captureElementFile'>>, (preview, window, input) => preview.captureElementFile(window, input))
  handle(channels.captureClipboard, tabInput<Input<'captureClipboard'>>, (preview, window, input) => preview.captureClipboard(window, input))
  handle(channels.captureSessionArtifact, tabInput<Input<'captureSessionArtifact'>>, (preview, window, input) => preview.captureSessionArtifact(window, input))
  handle(channels.close, closeInput, (preview, window, input) => preview.close(window, input))
  handle(channels.revokeGrant, tabInput<Input<'revokeGrant'>>, (preview, window, input) => preview.revokeGrant(window, input))
  handle(channels.setDevice, tabInput<Input<'setDevice'>>, (preview, window, input) => preview.setDevice(window, input))
  // A grab before any preview opened has no tab to belong to; the service drops it either way.
  ipcMain.on(DESIGN_MODE_CHANNELS.grab, (event, payload: DesignGrabPayload) => { const sender = event.sender; void service().then(preview => preview.handleDesignMessage(sender, 'grab', payload)) })
  ipcMain.on(DESIGN_MODE_CHANNELS.cancel, event => { const sender = event.sender; void service().then(preview => preview.handleDesignMessage(sender, 'cancel')) })
}
