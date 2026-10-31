import { shell } from 'electron'
import { recordIncident } from '../services/diagnostics/incident-sink'
import { externalUrlRefusal } from './external-url'

// The main window imports the URL rules it navigates by from here, with the opener, in one line.
export { isAppNavigation, isLoopbackHttpUrl } from './external-url'

/** Refusals recorded per minute; past that, one rate-limited incident says a burst is going on. */
export const EXTERNAL_REFUSALS_PER_MINUTE = 20

let windowStart = Number.NEGATIVE_INFINITY
let recorded = 0
let burstNoted = false

/**
 * Hands a link from the main window to the system browser or mail app, or records why not. The incident carries the
 * reason only: never the URL, nor its host.
 */
export function openExternalOrRecord(url: string, now = Date.now()): boolean {
  const refusal = externalUrlRefusal(url)
  if (refusal === null) {
    void shell.openExternal(url)
    return true
  }
  if (now - windowStart >= 60_000) { windowStart = now; recorded = 0; burstNoted = false }
  if (recorded < EXTERNAL_REFUSALS_PER_MINUTE) {
    recorded++
    recordIncident('incident.external.refused', refusal)
  } else if (!burstNoted) {
    burstNoted = true
    recordIncident('incident.external.rateLimited')
  }
  return false
}

/** Tests only: starts a fresh minute. */
export function resetExternalRefusals(): void {
  windowStart = Number.NEGATIVE_INFINITY
  recorded = 0
  burstNoted = false
}
