/** Redaction for what OxePost stores or shows: history, errors, and responses that echo a secret back. */

export const REDACTED = '[redacted]'
const SENSITIVE_NAME = /(^|[-_.\s])(authorization|cookie|set-cookie|token|secret|password|passwd|pwd|api[-_]?key|apikey|key|signature|sig|credential|session|auth)([-_.\s]|$)/i

/** Names whose value is a credential: Authorization, Cookie, X-API-Key, access_token, client_secret… */
export function isSensitiveName(name: string): boolean {
  return SENSITIVE_NAME.test(name.trim()) || /^proxy-authorization$/i.test(name.trim())
}

export function redactHeaders<T extends { name: string; value: string }>(headers: readonly T[]): T[] {
  return headers.map(header => isSensitiveName(header.name) ? { ...header, value: REDACTED } : { ...header })
}

/** Hides the value of credential-looking query parameters and the user info of a URL. */
export function redactUrl(url: string): string {
  const hash = url.indexOf('#')
  const base = hash >= 0 ? url.slice(0, hash) : url
  const fragment = hash >= 0 ? url.slice(hash) : ''
  const mark = base.indexOf('?')
  const head = (mark >= 0 ? base.slice(0, mark) : base).replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@\s]*@/i, `$1${REDACTED}@`)
  if (mark < 0) return head + fragment
  const query = base.slice(mark + 1).split('&').map(pair => {
    const eq = pair.indexOf('=')
    if (eq < 0) return pair
    const name = safeDecode(pair.slice(0, eq))
    return isSensitiveName(name) ? `${pair.slice(0, eq)}=${REDACTED}` : pair
  }).join('&')
  return `${head}?${query}${fragment}`
}

function safeDecode(value: string): string {
  try { return decodeURIComponent(value) } catch { return value }
}

/** Replaces every occurrence of the given secret values (4 characters or more) by a label. */
export function maskValues(text: string, secrets: ReadonlyArray<{ name: string; value: string }>): string {
  let result = text
  // Longest first, so a secret that contains another is hidden whole.
  for (const secret of [...secrets].filter(item => item.value.length >= 4).sort((a, b) => b.value.length - a.value.length)) {
    result = result.split(secret.value).join(`[secret:${secret.name}]`)
  }
  return result
}
