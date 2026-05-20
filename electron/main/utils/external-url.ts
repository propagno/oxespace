const SAFE_EXTERNAL_PROTOCOLS = new Set(['https:', 'http:', 'mailto:'])

export function isSafeExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return SAFE_EXTERNAL_PROTOCOLS.has(parsed.protocol)
  } catch {
    return false
  }
}
