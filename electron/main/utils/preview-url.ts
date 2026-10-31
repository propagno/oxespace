/**
 * Where an agent's Web Preview URL points (B15), decided from the text the agent sent, not only from what a URL parser
 * makes of it:
 *
 *   local     http(s) to localhost, *.localhost, 127.0.0.1 or [::1], on any port, written in that exact form
 *   external  any other http(s) host: a person approves the exact URL first
 *   refused   every other scheme (file:, javascript:, data:, blob:, about:, chrome:, devtools:, mailto:, custom ones).
 *             file: is refused rather than asked for in 1.4: the preview loads http(s) only, so an approval could
 *             not lead anywhere.
 *
 * The WHATWG parser turns `http://2130706433`, `http://0x7f.1` and `http://LOCALHOST` into a loopback host. Those
 * spellings exist to slip past a check, so the host must already be written the way the parser writes it; anything
 * else asks. Credentials in the authority (`http://127.0.0.1@evil.com`) always ask.
 */
export type PreviewUrl =
  | { kind: 'local'; href: string }
  | { kind: 'external'; href: string }
  | { kind: 'refused' }

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])
const LOCALHOST_SUBDOMAIN = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+localhost$/
/** Characters the parser silently drops or trims: their presence means the text is not what will load. */
const HIDDEN_RANGES: ReadonlyArray<readonly [number, number]> = [[0x00, 0x20], [0x7f, 0xa0], [0xad, 0xad], [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x2064], [0xfeff, 0xfeff]]
function hasHidden(text: string): boolean {
  for (const char of text) {
    const point = char.codePointAt(0) ?? 0
    if (HIDDEN_RANGES.some(([low, high]) => point >= low && point <= high)) return true
  }
  return false
}

/** The host as written: after the scheme and its slashes, up to the port, path, query or fragment. */
function writtenHost(raw: string): { host: string; credentials: boolean } {
  const afterScheme = raw.slice(raw.indexOf(':') + 1).replace(/^[/\\]*/, '')
  const authority = afterScheme.split(/[/\\?#]/, 1)[0] ?? ''
  const credentials = authority.includes('@')
  if (authority.startsWith('[')) return { host: authority.slice(0, authority.indexOf(']') + 1), credentials }
  const colon = authority.lastIndexOf(':')
  return { host: colon === -1 ? authority : authority.slice(0, colon), credentials }
}

function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host) || LOCALHOST_SUBDOMAIN.test(host)
}

export function classifyPreviewUrl(raw: string): PreviewUrl {
  let url: URL
  try { url = new URL(raw) } catch { return { kind: 'refused' } }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { kind: 'refused' }
  const external: PreviewUrl = { kind: 'external', href: url.href }
  if (hasHidden(raw) || url.username || url.password) return external
  const written = writtenHost(raw)
  if (written.credentials || written.host !== url.hostname) return external
  return isLoopbackHost(url.hostname) ? { kind: 'local', href: url.href } : external
}
