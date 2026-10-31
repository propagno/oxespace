import { shell } from 'electron'
import type { DiagnosticsIncidentCode } from '../../../shared/types/diagnostics'
import { recordIncident } from '../services/diagnostics/incident-sink'
import { externalUrlRefusal, isAppNavigation } from './external-url'

// The main window imports the URL rules it navigates by from here, with the opener, in one line.
export { isAppNavigation, isLoopbackHttpUrl } from './external-url'

/** Refusals recorded per minute; past that, one rate-limited incident says a burst is going on. */
export const EXTERNAL_REFUSALS_PER_MINUTE = 20

let windowStart = Number.NEGATIVE_INFINITY
let recorded = 0
let burstNoted = false

/**
 * Every link incident of the main window (a refused link, a denied window.open, a denied navigation) shares one
 * per-minute budget, so a page that loops over any of them fills the journal with one line, not thousands.
 */
function recordLinkIncident(code: DiagnosticsIncidentCode, subject: string | undefined, now: number): void {
  if (now - windowStart >= 60_000) { windowStart = now; recorded = 0; burstNoted = false }
  if (recorded < EXTERNAL_REFUSALS_PER_MINUTE) {
    recorded++
    recordIncident(code, subject)
  } else if (!burstNoted) {
    burstNoted = true
    recordIncident('incident.window.externalRateLimited')
  }
}

/**
 * Hands a link from the main window to the system browser or mail app, or records why not. The incident carries the
 * reason only: never the URL, nor its host. Anything but a string is refused as malformed.
 */
export function openExternalOrRecord(url: unknown, now = Date.now()): boolean {
  const refusal = typeof url === 'string' ? externalUrlRefusal(url) : 'malformed'
  if (refusal === null) {
    // The system may have no handler (a mailto: with no mail app on Linux): journalled, still without the URL.
    shell.openExternal(url as string).catch(() => recordIncident('incident.window.externalOpenFailed'))
    return true
  }
  recordLinkIncident('incident.window.externalRefused', refusal, now)
  return false
}

/** The subset of WebContents the link guards use, so a test can hand in a fake. */
export interface LinkGuardedContents {
  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' }): void
  on(event: 'will-navigate', listener: (event: { preventDefault(): void }, url: string) => void): unknown
  on(event: 'will-redirect', listener: (event: { preventDefault(): void }, url: string) => void): unknown
}

/**
 * The main window never opens a link by itself: window.open and an outward navigation or redirect are denied and
 * journalled, and nothing leaves the app. The only way out is `app:open-external`, which the window calls after the
 * person confirmed the host. Neither incident names the URL or its host.
 */
export function guardMainWindowLinks(contents: LinkGuardedContents, appUrl: string, now: () => number = Date.now): void {
  contents.setWindowOpenHandler(() => {
    recordLinkIncident('incident.window.openDenied', undefined, now())
    return { action: 'deny' }
  })
  const keepInApp = (event: { preventDefault(): void }, url: string): void => {
    if (isAppNavigation(url, appUrl)) return
    event.preventDefault()
    recordLinkIncident('incident.window.navigationDenied', undefined, now())
  }
  contents.on('will-navigate', keepInApp)
  contents.on('will-redirect', keepInApp)
}

/** Tests only: starts a fresh minute. */
export function resetExternalRefusals(): void {
  windowStart = Number.NEGATIVE_INFINITY
  recorded = 0
  burstNoted = false
}
