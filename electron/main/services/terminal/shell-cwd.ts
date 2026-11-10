import { hostname } from 'node:os'
import { posix, win32 } from 'node:path'

/**
 * A18 (T79) · The shell's working directory, read passively from what the shell already prints:
 *   OSC 7 file://<host>/<percent-encoded path>   (host empty, localhost or this machine)
 *   OSC 633 ; P ; Cwd=<path>                     (VS Code shell integration; \x3b and \\ escaped)
 *   OSC 9 ; 9 ; <path or "path">                 (Windows Terminal)
 *   OSC 1337 ; CurrentDir=<path>                 (iTerm2)
 * ended by BEL or ESC \. A value counts only as a reported cwd would: absolute after decoding, no NUL, at most
 * SHELL_CWD_MAX_LENGTH characters, not a UNC share; it comes back through path.resolve.
 *
 * Cost: one indexOf(ESC + "]") per chunk while nothing is pending.
 */
export const SHELL_CWD_MAX_LENGTH = 4096
/** An unterminated sequence longer than this is dropped, so a stray ESC ] never grows memory. */
export const SHELL_CWD_MAX_PENDING = 8192

const ESC = '\u001b'
const BEL = '\u0007'
const OSC = `${ESC}]`

interface Terminated { body: number; next: number }
/** Where the sequence whose body starts at `from` ends; `next` alone when another escape cut it; null when open. */
function terminatorOf(text: string, from: number): Terminated | { body: -1; next: number } | null {
  const bel = text.indexOf(BEL, from)
  const esc = text.indexOf(ESC, from)
  if (bel >= 0 && (esc < 0 || bel < esc)) return { body: bel, next: bel + 1 }
  if (esc < 0) return null
  if (esc + 1 >= text.length) return null
  return text[esc + 1] === '\\' ? { body: esc, next: esc + 2 } : { body: -1, next: esc }
}

const isUnc = (value: string): boolean => /^[\\/]{2}/.test(value)
const unquote = (value: string): string => value.length >= 2 && value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value
/** VS Code escapes `\` as `\\` and `;` as `\x3b` in OSC 633 values. */
const unescapeVsCode = (value: string): string => value.replace(/\\(x3b|\\)/gi, (_match, what: string) => what === '\\' ? '\\' : ';')

function safeHostname(): string {
  try { return hostname() } catch { return '' }
}

export class ShellCwdScanner {
  private pending = ''

  constructor(private readonly platform: NodeJS.Platform = process.platform, private readonly host: string = safeHostname()) {}

  pendingLength(): number { return this.pending.length }

  /** The newest valid cwd completed in this chunk, or null. */
  push(chunk: string): string | null {
    let text: string
    if (this.pending) {
      text = this.pending + chunk
      this.pending = ''
    } else {
      const first = chunk.indexOf(OSC)
      if (first < 0) {
        // A chunk may end between ESC and ].
        if (chunk.endsWith(ESC)) this.pending = ESC
        return null
      }
      text = chunk.slice(first)
    }

    let found: string | null = null
    let at = 0
    while (at < text.length) {
      const start = text.indexOf(OSC, at)
      if (start < 0) {
        if (text.endsWith(ESC)) this.pending = ESC
        break
      }
      const end = terminatorOf(text, start + 2)
      if (!end) { this.keep(text.slice(start)); break }
      if (end.body >= 0) {
        const cwd = this.read(text.slice(start + 2, end.body))
        if (cwd) found = cwd
      }
      at = end.next
    }
    return found
  }

  private keep(rest: string): void {
    this.pending = rest.length > SHELL_CWD_MAX_PENDING ? '' : rest
  }

  private read(body: string): string | null {
    if (body.length > SHELL_CWD_MAX_LENGTH * 3 + 64) return null
    if (body.startsWith('7;')) return this.fromFileUrl(body.slice(2))
    if (body.startsWith('633;P;Cwd=')) {
      const raw = body.slice('633;P;Cwd='.length)
      return isUnc(raw) ? null : this.valid(unescapeVsCode(raw))
    }
    if (body.startsWith('9;9;')) return this.valid(unquote(body.slice(4)))
    if (body.startsWith('1337;CurrentDir=')) return this.valid(body.slice('1337;CurrentDir='.length))
    return null
  }

  private fromFileUrl(url: string): string | null {
    if (!/^file:\/\//i.test(url)) return null
    const rest = url.slice(7)
    const slash = rest.indexOf('/')
    if (slash < 0) return null
    if (!this.isLocalHost(rest.slice(0, slash))) return null
    let path: string
    try { path = decodeURIComponent(rest.slice(slash)) } catch { return null }
    if (this.platform === 'win32' && /^\/[A-Za-z]:/.test(path)) path = path.slice(1)
    return this.valid(path)
  }

  private isLocalHost(host: string): boolean {
    const name = host.toLowerCase()
    return name === '' || name === 'localhost' || (this.host !== '' && name === this.host.toLowerCase())
  }

  private valid(value: string): string | null {
    if (!value || value.length > SHELL_CWD_MAX_LENGTH || value.includes('\u0000') || isUnc(value)) return null
    const win = this.platform === 'win32'
    const absolute = win ? /^[A-Za-z]:[\\/]/.test(value) : value.startsWith('/')
    if (!absolute) return null
    const resolved = (win ? win32 : posix).resolve(value)
    return resolved.length > SHELL_CWD_MAX_LENGTH || isUnc(resolved) ? null : resolved
  }
}
