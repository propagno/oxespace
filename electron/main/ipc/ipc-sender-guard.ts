import { app, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { DESIGN_MODE_CHANNELS } from '../../../shared/types/design-mode'
import { recordIncident } from '../services/diagnostics/incident-sink'

/**
 * B12 · One sender guard for every IPC channel. Installed on `ipcMain` itself before the first registration, so every
 * `handle` / `on` from any module (lazy ones, the E2E mocks, a test's `app.evaluate`) goes through it. A call is
 * answered only when it comes from the main frame of a webContents the app trusted by identity (`trustAppWindow`).
 * The one exception: a preview guest (`trustPreviewGuest`) may send the Design Mode channels, and only those.
 */
export const IPC_SENDER_REFUSED = 'ipc.sender.refused'
/** Marks a listener the guard wrapped; the contract test checks every registration carries it. */
export const IPC_GUARDED = Symbol.for('oxespace.ipcSenderGuard')
/** What a preview guest's preload (design-guest.ts) sends to the main process. Nothing else is accepted from it. */
export const GUEST_CHANNELS: ReadonlySet<string> = new Set([DESIGN_MODE_CHANNELS.grab, DESIGN_MODE_CHANNELS.cancel])

const appWindows = new WeakSet<WebContents>()
const previewGuests = new WeakSet<WebContents>()
const guarded = new WeakSet<object>()

/** The app's own window: the only sender every channel answers. Returns the window so creation stays one expression. */
export function trustAppWindow<T extends { webContents: WebContents }>(window: T): T {
  appWindows.add(window.webContents)
  return window
}

/** A Browser preview tab's guest (WebContentsView). It may send GUEST_CHANNELS and nothing else. */
export function trustPreviewGuest(guest: WebContents): void {
  previewGuests.add(guest)
}

/** A refusal carries the C3 code as its message, never a sentence; the window that sent it is not trusted to show one. */
export class IpcSenderRefusedError extends Error {
  readonly code = IPC_SENDER_REFUSED
  constructor() { super(IPC_SENDER_REFUSED); this.name = 'IpcSenderRefusedError' }
}

export function isSenderAllowed(channel: string, event: Pick<IpcMainEvent | IpcMainInvokeEvent, 'sender' | 'senderFrame'>): boolean {
  const sender = event?.sender
  if (!sender || !event.senderFrame || event.senderFrame !== sender.mainFrame) return false
  return appWindows.has(sender) || (previewGuests.has(sender) && GUEST_CHANNELS.has(channel))
}

type Listener = (event: never, ...args: never[]) => unknown
const HANDLERS = ['handle', 'handleOnce'] as const
const LISTENERS = ['on', 'once', 'addListener', 'prependListener', 'prependOnceListener'] as const
type Registrar = Record<(typeof HANDLERS)[number] | (typeof LISTENERS)[number], (channel: string, listener: Listener) => unknown>

function wrap(channel: string, listener: Listener, invoke: boolean): Listener {
  const wrapped = (event: IpcMainEvent | IpcMainInvokeEvent, ...args: unknown[]): unknown => {
    if (isSenderAllowed(channel, event)) return (listener as (...values: unknown[]) => unknown)(event, ...args)
    recordIncident('incident.ipc.senderRefused', channel) // the channel only: no URL, path or payload
    if (invoke) throw new IpcSenderRefusedError()
    return undefined // a send has no caller to reject; it is dropped
  }
  // removeListener(channel, original) still finds it, as it finds Node's own once wrappers.
  return Object.assign(wrapped, { listener, [IPC_GUARDED]: true }) as unknown as Listener
}

/** Idempotent. Call before anything registers a channel. Also keeps guests from opening windows or nesting webviews. */
export function installIpcSenderGuard(target: object = ipcMain, application: Pick<typeof app, 'on'> | null = app): void {
  if (guarded.has(target)) return
  guarded.add(target)
  const registrar = target as Registrar
  for (const method of [...HANDLERS, ...LISTENERS]) {
    const original = registrar[method]
    if (typeof original !== 'function') continue
    const invoke = (HANDLERS as readonly string[]).includes(method)
    registrar[method] = function (this: unknown, channel: string, listener: Listener) {
      return original.call(this ?? target, channel, wrap(channel, listener, invoke))
    }
  }
  application?.on('web-contents-created', (_event: unknown, contents: WebContents) => {
    if (contents.getType() === 'window') return // the main window sets its own open and navigation rules
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('will-attach-webview', event => event.preventDefault())
    contents.on('will-navigate', (event, url) => { if (!/^https?:/i.test(url)) event.preventDefault() })
  })
}
