/**
 * Removes secrets from text that leaves the app or outlives the moment: logs, diagnostics, exports and what shared
 * memory captures (roadmap C3). It recognizes credentials by their shape, so it errs on the side of removing a
 * value that only looks like one; the surrounding text stays readable.
 */
export const REDACTED = '[redacted]'

/** Tokens recognized by their provider's prefix. */
const TOKENS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bsk-(?:ant-)?[A-Za-z0-9_-]{16,}/g,                    // Anthropic, OpenAI
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g, // GitHub
  /\bglpat-[A-Za-z0-9_-]{20,}/g,                           // GitLab
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/g,                      // Slack
  /\bAIza[0-9A-Za-z_-]{35}\b/g,                            // Google API keys
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,                        // AWS access key ids
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}/g,        // Stripe
  /\bnpm_[A-Za-z0-9]{36}\b/g,                              // npm
  /\blin_(?:api|oauth)_[A-Za-z0-9]{32,}/g,                 // Linear
  /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g // JWT
]

/** `password=…`, `"api_key": "…"`, `Authorization: …`: the name stays, the value goes. */
const NAMED = /((?:password|passwd|pwd|secret|client[_-]?secret|api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|token|authorization)["']?\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|(?:Bearer|Basic)\s+[^\s,;"'}]+|[^\s,;"'}]+)/gi

export function redactSecrets(text: string): string {
  let value = text
  for (const pattern of TOKENS) value = value.replace(pattern, REDACTED)
  return value
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g, `$1 ${REDACTED}`)
    .replace(NAMED, `$1${REDACTED}`)
    // scheme://user:password@host keeps the user and the host.
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+):[^\s/@]+@/gi, `$1:${REDACTED}@`)
}

/** Variable names whose value is a secret whatever it looks like: DB_PASSWORD, SECRET_KEY_BASE, GITHUB_TOKEN… */
const SECRET_NAME = /pass|pwd|secret|token|key|auth|credential|cookie|session|salt|private|cert|signature|dsn|_url$|^url$|conn/i

/**
 * A container's environment for display (roadmap P6). A value is kept only when its name is harmless and
 * redactSecrets finds nothing in it; otherwise it is dropped entirely, not masked, so no part of it leaves.
 */
export function redactEnvironment(entries: readonly string[], limit = 200): Array<{ name: string; value?: string }> {
  const seen = new Set<string>()
  const out: Array<{ name: string; value?: string }> = []
  for (const entry of entries) {
    const index = entry.indexOf('=')
    const name = index < 0 ? entry : entry.slice(0, index)
    if (!name || seen.has(name)) continue
    seen.add(name)
    const value = index < 0 ? '' : entry.slice(index + 1)
    const safe = !SECRET_NAME.test(name) && redactSecrets(`${name}=${value}`) === `${name}=${value}`
    out.push(safe ? { name, value: value.slice(0, 500) } : { name })
    if (out.length >= limit) break
  }
  return out
}
