/**
 * What an MCP server's config looked like when the person trusted it, with no secret in it (F25): kept with the
 * guard (electron/main/services/mcp-pin.ts) and shown next to the current config when a moved config quarantines
 * the server. Pure and shared, so the window can put the current config through the same function and compare like
 * with like.
 *
 * - Environment variables and headers: names only, sorted. Values never enter the snapshot.
 * - URL: origin and path only. User info, query and fragment are dropped whole, which is safer than redacting the
 *   query values one by one: a credential in a parameter whose name looks harmless cannot survive.
 * - Arguments: the value of a flag whose name looks like a secret (`--token=abc`, `--api-key abc`) becomes
 *   `[redacted]` and the flag name stays; so does the value of a `NAME=value` argument with a secret-looking name.
 *   Every argument, and the command, then goes through the app's secret shapes (shared/secrets.ts), and any
 *   environment or header value that also appears in them is masked.
 */
import { looksSecret } from './env-scrub'
import { REDACTED, redactSecrets } from './secrets'
import type { McpServerConfig, McpTrustedSnapshot } from './types/mcp'

/** env-scrub's secret words, plus `bearer`, which names a token on a command line though not in an environment. */
const secretName = (name: string): boolean => looksSecret(name) || /bearer/i.test(name)

const FLAG = /^(--?)([A-Za-z][\w.-]*)(?:=([\s\S]*))?$/
const ASSIGNMENT = /^([A-Za-z_][\w.-]*)=([\s\S]*)$/

/** Origin and path; anything that does not parse as a URL is not shown at all. */
export function trustedUrl(url: string): string {
  try {
    const parsed = new URL(url.trim())
    const origin = parsed.origin !== 'null' ? parsed.origin : `${parsed.protocol}//${parsed.host}`
    return redactSecrets(`${origin}${parsed.pathname}`)
  } catch { return REDACTED }
}

/** Arguments with the values of secret-looking flags and assignments replaced; flag names stay. */
export function trustedArgs(args: readonly string[], known: readonly string[] = []): string[] {
  const out: string[] = []
  for (let index = 0; index < args.length; index++) {
    const arg = String(args[index])
    const flag = FLAG.exec(arg)
    if (flag && secretName(flag[2])) {
      if (flag[3] !== undefined) { out.push(`${flag[1]}${flag[2]}=${REDACTED}`); continue }
      out.push(arg)
      // `--token abc`: the next argument is the value unless it is another flag.
      const next = args[index + 1]
      if (next !== undefined && !String(next).startsWith('-')) { out.push(REDACTED); index++ }
      continue
    }
    const assignment = flag ? null : ASSIGNMENT.exec(arg)
    if (assignment && secretName(assignment[1])) { out.push(`${assignment[1]}=${REDACTED}`); continue }
    out.push(clean(/^[a-z][a-z0-9+.-]*:\/\//i.test(arg) ? trustedUrl(arg) : arg, known))
  }
  return out
}

/** The snapshot kept when a person trusts a server. */
export function trustedSnapshot(config: McpServerConfig): McpTrustedSnapshot {
  if (config.transport === 'stdio') {
    const env = config.env ?? {}
    const known = Object.values(env)
    return { transport: 'stdio', command: clean(String(config.command ?? '').trim(), known), args: trustedArgs(config.args ?? [], known), envKeys: Object.keys(env).sort() }
  }
  const headers = config.headers ?? {}
  return { transport: config.transport, url: clean(trustedUrl(String(config.url ?? '')), Object.values(headers)), headerKeys: Object.keys(headers).sort() }
}

/** A snapshot read back from storage, only when it has the shape this file writes; anything else is dropped. */
export function storedSnapshot(value: unknown): McpTrustedSnapshot | undefined {
  if (!value || typeof value !== 'object') return undefined
  const item = value as Record<string, unknown>
  const strings = (list: unknown): list is string[] => Array.isArray(list) && list.every(entry => typeof entry === 'string')
  if (item.transport === 'stdio' && typeof item.command === 'string' && strings(item.args) && strings(item.envKeys)) {
    return { transport: 'stdio', command: item.command, args: [...item.args], envKeys: [...item.envKeys] }
  }
  if ((item.transport === 'http' || item.transport === 'sse') && typeof item.url === 'string' && strings(item.headerKeys)) {
    return { transport: item.transport, url: item.url, headerKeys: [...item.headerKeys] }
  }
  return undefined
}

/** Secret shapes out, and any known secret value (4 characters or more) masked wherever it appears. */
function clean(text: string, known: readonly string[]): string {
  let value = redactSecrets(text)
  for (const secret of [...known].filter(item => typeof item === 'string' && item.length >= 4).sort((a, b) => b.length - a.length)) {
    value = value.split(secret).join(REDACTED)
  }
  return value
}
