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
