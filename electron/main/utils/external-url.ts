const SAFE_EXTERNAL_PROTOCOLS = new Set(['https:', 'http:', 'mailto:'])
/** The longest URL handed to the system browser or mail app. */
export const EXTERNAL_URL_MAX_LENGTH = 2_048
export const EXTERNAL_URL_REFUSALS = ['protocol', 'length', 'credentials', 'malformed'] as const
export type ExternalUrlRefusal = typeof EXTERNAL_URL_REFUSALS[number]

/**
 * Why a URL may not leave the app, or null when it may: http, https and mailto only, at most
 * EXTERNAL_URL_MAX_LENGTH characters, no control characters and no user name or password in it.
 */
export function externalUrlRefusal(url: string): ExternalUrlRefusal | null {
  if (typeof url !== 'string') return 'malformed'
  if (url.length > EXTERNAL_URL_MAX_LENGTH) return 'length'
  if (/[\u0000-\u001f\u007f]/.test(url)) return 'malformed'
  let parsed: URL
  try { parsed = new URL(url) } catch { return 'malformed' }
  if (!SAFE_EXTERNAL_PROTOCOLS.has(parsed.protocol)) return 'protocol'
  if (parsed.username || parsed.password) return 'credentials'
  return null
}

export function isSafeExternalUrl(url: string): boolean {
  return externalUrlRefusal(url) === null
}

export function isLoopbackHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    const host = parsed.hostname.toLowerCase()
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1'
  } catch {
    return false
  }
}

/**
 * Whether a navigation of the main window stays inside the app: the dev server's origin, or the
 * renderer's own index.html (the hash may change; another file or any remote page may not).
 */
export function isAppNavigation(url: string, appUrl: string): boolean {
  try {
    const target = new URL(url)
    const app = new URL(appUrl)
    if (app.protocol === 'file:') return target.protocol === 'file:' && target.pathname === app.pathname
    return target.origin === app.origin
  } catch {
    return false
  }
}
