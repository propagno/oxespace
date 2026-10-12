import { session, type Session, type WebContents } from 'electron'

export const WEB_PREVIEW_PARTITION_PREFIX = 'oxe-webpreview-'
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
