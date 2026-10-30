import { redactSecrets } from './secrets'

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
