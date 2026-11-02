// The one way the window opens a link outside the app. Every caller (agent and file markdown, terminal links,
// GitHub, Linear, the web preview and the app's own fixed links) comes through here, so the same rules hold for all:
// only http, https and mailto, at most 2,048 characters, no credentials in the URL, and a confirmation that shows the
// real host when the visible text names another place or the host was never opened before. The main process checks again
// and is the only one that opens anything (app:open-external): it refuses window.open and every outward navigation.
import { i18n } from '../i18n'
import { toast } from '../ui/Toast'
import { toUnicodeHost } from './punycode'

export type ExternalLinkSource = 'markdown' | 'terminal' | 'github' | 'linear' | 'preview' | 'app'
export interface ExternalLinkOptions {
  /** What the person saw and clicked, when it is text (a markdown label, the terminal's match). */
  text?: string
  /** `app` is for OXESpace's own fixed links: they are validated, never confirmed. */
  source: ExternalLinkSource
}
export interface ExternalLinkPrompt {
  url: string
  host: string
  /** The Unicode form, when the host is an IDN whose ASCII (`xn--`) form differs. */
  unicodeHost?: string
  /** The visible text, when it says something other than the URL itself. */
  text?: string
  source: ExternalLinkSource
}

export const MAX_EXTERNAL_URL_LENGTH = 2048
export const SEEN_HOSTS_KEY = 'oxe.externalLinks.seenHosts'
const ALLOWED = new Set(['http:', 'https:', 'mailto:'])
/** Fired when the seen-hosts list changes, so Settings can update its count. */
export const SEEN_HOSTS_EVENT = 'oxe:external-links-seen'
const safeDecode = (value: string): string => { try { return decodeURIComponent(value) } catch { return value } }

/** The URL when it may leave the app; null otherwise. */
export function parseExternalUrl(raw: string): URL | null {
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (!value || value.length > MAX_EXTERNAL_URL_LENGTH) return null
  let url: URL
  try { url = new URL(value) } catch { return null }
  if (!ALLOWED.has(url.protocol)) return null
  if (url.username || url.password) return null
  if (url.protocol !== 'mailto:' && !url.hostname) return null
  return url
}

/** The host a link reaches, lower case and in ASCII: the server for web links, the mail domain for mailto. */
export function linkHost(url: URL): string {
  if (url.protocol !== 'mailto:') return url.hostname.toLowerCase()
  const address = safeDecode(url.pathname.split(/[?,]/)[0] ?? '')
  const at = address.lastIndexOf('@')
  return at >= 0 ? address.slice(at + 1).toLowerCase() : ''
}

const sameHost = (a: string, b: string): boolean => a.replace(/^www\./, '') === b.replace(/^www\./, '')
// A link or a bare host inside the text: "https://a.example/x", "a.example", "a.example/x", "me@a.example".
const ADDRESS = /(?:\b[a-z][a-z\d+.-]*:\/\/)?(?:[^\s@/:]+@)?(?:[\p{L}\p{N}-]+\.)+\p{L}{2,}(?::\d+)?(?:\/\S*)?/giu
// File names read like hosts ("notes.md", "main.go"); a bare one is a file, not a place. With a scheme it is a host.
const FILE_ENDINGS = new Set(['md', 'txt', 'json', 'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'py', 'rs', 'go', 'sh', 'yml', 'yaml', 'toml', 'lock', 'log', 'css', 'html', 'java', 'kt', 'rb', 'php', 'sql', 'xml', 'csv'])

/** The hosts the visible text names, lower case and in ASCII. */
export function textHosts(text: string): string[] {
  return [...text.matchAll(ADDRESS)].flatMap(([match]) => {
    const schemed = /^[a-z][a-z\d+.-]*:\/\//i.test(match)
    if (!schemed && !match.includes('/') && FILE_ENDINGS.has(match.split('.').pop()!.toLowerCase())) return []
    try {
      const host = new URL(schemed ? match : `https://${match}`).hostname.toLowerCase()
      return host ? [host] : []
    } catch { return [] }
  })
}

/** True when the visible text names a link or host other than where the link goes. Plain words never do. */
export function textMisleads(url: URL, text: string | undefined): boolean {
  if (!text || !text.trim()) return false
  const host = linkHost(url)
  return textHosts(text).some(shown => !sameHost(shown, host))
}

/** True when the visible text is the address or its host, so it already says where the link goes. */
export function textIsAddress(url: URL, text: string | undefined): boolean {
  const value = text?.trim() ?? ''
  if (!value || /\s/.test(value)) return false
  const hosts = textHosts(value)
  return hosts.length === 1 && sameHost(hosts[0], linkHost(url))
}

export function seenHosts(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SEEN_HOSTS_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((host): host is string => typeof host === 'string') : []
  } catch { return [] }
}
function rememberHost(host: string): void {
  try {
    const hosts = seenHosts()
    if (!hosts.includes(host)) localStorage.setItem(SEEN_HOSTS_KEY, JSON.stringify([...hosts, host].slice(-500)))
  } catch { /* Remembering is a convenience; the next link asks again. */ }
}
/** Forgets every opened host; returns how many there were. */
export function clearSeenHosts(): number {
  const count = seenHosts().length
  try { localStorage.removeItem(SEEN_HOSTS_KEY) } catch { /* Nothing stored. */ }
  window.dispatchEvent(new Event(SEEN_HOSTS_EVENT))
  return count
}
/** What the confirmation shows, or null when the link may open straight away. */
export function linkPrompt(url: URL, options: ExternalLinkOptions, seen: readonly string[] = seenHosts()): ExternalLinkPrompt | null {
  if (options.source === 'app') return null
  const host = linkHost(url)
  const misleads = textMisleads(url, options.text)
  if (!misleads && seen.includes(host)) return null
  const unicodeHost = toUnicodeHost(host)
  return { url: url.href, host, source: options.source, ...(unicodeHost !== host ? { unicodeHost } : {}), ...(misleads ? { text: options.text!.trim() } : {}) }
}

/**
 * Opens a link in the system browser after the checks above, through the main process. Resolves true when main
 * handed it to the browser. Never throws: a refused or failed link shows a message and resolves false.
 */
export async function openExternalLink(raw: string, options: ExternalLinkOptions): Promise<boolean> {
  const url = parseExternalUrl(raw)
  if (!url) {
    toast({ title: i18n.t('links.refused', { ns: 'common' }), description: i18n.t('links.refusedHint', { ns: 'common' }), intent: 'warning' })
    return false
  }
  const prompt = linkPrompt(url, options)
  if (prompt) {
    let confirmed: boolean
    try {
      const { confirmExternalLink } = await import('../components/ExternalLinks/ExternalLinkDialog')
      confirmed = await confirmExternalLink(prompt)
    } catch { confirmed = false }
    if (!confirmed) return false
  }
  const opened = await window.oxe?.app?.openExternal?.(url.href).then(result => result?.opened === true, () => false) ?? false
  if (!opened) {
    toast({ title: i18n.t('links.notOpened', { ns: 'common' }), description: i18n.t('links.notOpenedHint', { ns: 'common' }), intent: 'warning' })
    return false
  }
  // Only a site that really opened is remembered.
  if (options.source !== 'app') { rememberHost(linkHost(url)); window.dispatchEvent(new Event(SEEN_HOSTS_EVENT)) }
  return true
}

/** The host a markdown link shows next to its text, so the label cannot hide where it goes. */
export function displayHost(href: string | undefined): string | null {
  const url = href ? parseExternalUrl(href) : null
  return url ? linkHost(url) || null : null
}
