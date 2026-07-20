const SAFE_EXTERNAL_PROTOCOLS = new Set(['https:', 'http:', 'mailto:'])

export function isSafeExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return SAFE_EXTERNAL_PROTOCOLS.has(parsed.protocol)
  } catch {
    return false
  }
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
