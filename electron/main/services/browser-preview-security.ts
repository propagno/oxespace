import { app, session, type Session, type WebContents } from 'electron'
import { GUEST_PROBE_ARGUMENT } from '../../../shared/types/design-mode'

export const WEB_PREVIEW_PARTITION_PREFIX = 'oxe-webpreview-'

/**
 * B12, E2E only: arms the guest preload's probe (GUEST_PROBE_ARGUMENT) so e2e/ipc-sender-guard.spec.ts can call
 * channels from a real guest. Empty on a packaged build, whatever the environment says, and empty unless the run
 * sets OXESPACE_E2E_GUEST_PROBE=1. Nothing else about the guest changes: its iframes still get no preload.
 */
export function guestProbeWebPreferences(env: NodeJS.ProcessEnv = process.env, packaged = app.isPackaged): Pick<Electron.WebPreferences, 'additionalArguments'> {
  if (packaged || env.OXESPACE_E2E_GUEST_PROBE !== '1') return {}
  return { additionalArguments: [GUEST_PROBE_ARGUMENT] }
}
const securedPreviewSessions = new WeakSet<Session>()

/** Every preview profile is ephemeral and has the same deny-by-default rules. */
export function securePreviewSession(previewSession: Session): void {
  if (securedPreviewSessions.has(previewSession)) return
  securedPreviewSessions.add(previewSession)
  previewSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  previewSession.setPermissionCheckHandler(() => false)
  previewSession.on('will-download', event => event.preventDefault())
  previewSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const requestHeaders = { ...details.requestHeaders }
    delete requestHeaders.Referer
    delete requestHeaders.referer
    callback({ requestHeaders })
  })
}

export function previewSessionFor(ownerKey: string): Session {
  if (!/^[a-zA-Z0-9:-]{1,100}$/.test(ownerKey)) throw new Error('Invalid browser owner')
  const previewSession = session.fromPartition(`${WEB_PREVIEW_PARTITION_PREFIX}${ownerKey}`)
  securePreviewSession(previewSession)
  return previewSession
}

export function securePreviewGuest(guest: WebContents): void {
  // A page cannot silently escape the embedded browser. The user's explicit
  // "Open in browser" control is the only route to the system browser.
  guest.setWindowOpenHandler(() => ({ action: 'deny' }))
}
