import { REMOTE_TEXT_LIMITS } from '../../../../shared/remote/protocol'
import { REDACTED, redactSecrets, SECRET_PATTERNS } from '../../../../shared/secrets'
import { normalizeRootPath, rootPathKey } from '../../../../shared/utils/path'

/**
 * What text goes through before it reaches a phone (C5 payloads): the app's redactor for secrets, absolute paths
 * (relative under a registered root, `…` anywhere else), and a cut to the contract's length. Pure functions, so every
 * topic filters the same way and the tests can check them alone.
 */

export const PATH_PLACEHOLDER = '…'

const occurrences = (text: string, needle: string): number => {
  let count = 0
  for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + needle.length)) count += 1
  return count
}

/** The redactor's text and how many values it replaced. */
export function redactCounted(text: string): { text: string; redacted: number } {
  const value = redactSecrets(text)
  return { text: value, redacted: Math.max(0, occurrences(value, REDACTED) - occurrences(text, REDACTED)) }
}

/** At most `limit` characters, never ending on half of a surrogate pair. */
export function cut(text: string, limit: number): { text: string; truncated: boolean } {
  if (text.length <= limit) return { text, truncated: false }
  let end = limit
  const code = text.charCodeAt(end - 1)
  if (code >= 0xd800 && code <= 0xdbff) end -= 1
  return { text: text.slice(0, end), truncated: true }
}

// ---- Paths --------------------------------------------------------------------------------------------------------

/** A character a path token may hold: anything but blanks, quotes, `<>|` and control characters. */
const PATH_CHAR = String.raw`[^\s"'` + '`' + String.raw`<>|\u0000-\u001f\u007f]`
/** An ANSI escape (colour, cursor) just before a token, as terminals print them. */
const ANSI = String.raw`\u001b\[[0-9;?]*[A-Za-z]`
/** Where a token starts: the start of the text, after a blank, a quote, an opening bracket, `=`, `,`, `;`, `>` or `:`. */
const AFTER = String.raw`(?<=^|[\s"'` + '`' + String.raw`(\[{=,;>:]|${ANSI})`
/** Same, without `:`, so the `//` of `https://` never starts a token. */
const AFTER_NO_COLON = String.raw`(?<=^|[\s"'` + '`' + String.raw`(\[{=,;>]|${ANSI})`
const NOT_IN_WORD = String.raw`(?:(?<![A-Za-z0-9_])|(?<=${ANSI}))`

/**
 * Every token that starts at a path root or a drive: `file:` URLs, UNC paths (`\\server\share`, `//server/share`),
 * drive paths (`C:\`, `d:/`), home paths (`~/`, `~user/`) and any POSIX path (`/anything`). A `/` inside a word
 * (`a/b`, `https://host/x`) or followed by nothing a path holds (`a / b`) starts none.
 */
const ABSOLUTE = new RegExp([
  `${NOT_IN_WORD}file:${PATH_CHAR}*`,
  String.raw`${AFTER}\\\\${PATH_CHAR}+`,
  `${AFTER_NO_COLON}//[^\\s/"'\`<>|\\u0000-\\u001f]${PATH_CHAR}*`,
  String.raw`${NOT_IN_WORD}[A-Za-z]:[\\/]${PATH_CHAR}*`,
  String.raw`${AFTER}~[A-Za-z0-9._-]*[\\/]${PATH_CHAR}*`,
  `${AFTER}/(?![/\\s"'\`<>|])${PATH_CHAR}*`
].join('|'), 'gi')

const TRAILING = /[.,;:!?)\]}]+$/

/** The app's separator rule (`normalizeRootPath`), with doubled separators inside the path collapsed. */
function normalized(path: string): string {
  const value = normalizeRootPath(path)
  const unc = value.startsWith('//') ? '//' : ''
  return unc + value.slice(unc.length).replace(/\/{2,}/g, '/')
}

export interface PathRoots { roots: readonly string[]; platform?: string }

/**
 * Where `path` lies under one of `roots`, by the app's own rules (`normalizeRootPath`, and case folded only where
 * the file system folds it, `rootPathKey`): `.` for the root itself, the rest with `/` otherwise. Undefined outside
 * every root, for a path that only shares a prefix with one (`/work/app-other` is not in `/work/app`), and for one
 * that climbs out with `..`.
 */
export function underRoot(path: string, roots: readonly string[], platform: string = process.platform): string | undefined {
  const target = normalized(path), key = rootPathKey(target, platform)
  let best: string | undefined, bestLength = -1
  for (const root of roots) {
    if (!root) continue
    const base = normalized(root), baseKey = rootPathKey(base, platform)
    if (baseKey.length <= bestLength) continue
    if (key === baseKey) { best = '.'; bestLength = baseKey.length; continue }
    const prefix = baseKey.endsWith('/') ? baseKey : `${baseKey}/`
    if (!key.startsWith(prefix)) continue
    const rest = target.slice(prefix.length)
    if (!rest || rest.split('/').some(segment => segment === '..')) continue
    best = rest
    bestLength = baseKey.length
  }
  return best
}

/**
 * No absolute path leaves the desktop: each one under a registered root becomes relative (`./src/a.ts`, or `.`),
 * every other one becomes `…`, whatever its top-level directory, drive or server.
 */
export function scrubPaths(text: string, roots: readonly string[], platform: string = process.platform): string {
  return text.replace(ABSOLUTE, (token: string) => {
    const trailing = TRAILING.exec(token)?.[0] ?? ''
    const path = trailing ? token.slice(0, -trailing.length) : token
    if (!path) return token
    if (/^(?:file:|~)/i.test(path)) return PATH_PLACEHOLDER + trailing
    const inside = underRoot(path, roots, platform)
    if (inside === undefined) return PATH_PLACEHOLDER + trailing
    return (inside === '.' ? '.' : `./${inside}`) + trailing
  })
}

/**
 * `target` relative to `root` with `/`, `.` for the root itself; undefined when it lies outside, climbs with `..`, or
 * is absolute somewhere else. A relative `target` is taken as relative to the root already.
 */
export function relativeTo(root: string, target: string, platform: string = process.platform): string | undefined {
  const path = normalized(target)
  if (!path) return undefined
  if (/^(?:[A-Za-z]:|\/|~)/.test(path)) return root ? underRoot(path, [root], platform) : undefined
  const rest = path.replace(/^\.\//, '')
  if (!rest || rest === '.') return '.'
  if (rest.split('/').some(segment => segment === '..' || segment === '') || /^[A-Za-z]:/.test(rest)) return undefined
  return rest
}

/** Everything a free-text field goes through: redaction (counted), paths, then the cut. */
export function clean(text: string | undefined, roots: readonly string[], limit: number): { text: string; truncated: boolean; redacted: number } {
  const redacted = redactCounted(text ?? '')
  const cutText = cut(scrubPaths(redacted.text, roots), limit)
  return { text: cutText.text, truncated: cutText.truncated, redacted: redacted.redacted }
}

// ---- Terminal output: a sliding window ----------------------------------------------------------------------------

/**
 * The longest text `pattern` can match, read from its source: literals and classes count one, `{n,m}` counts `m`, and
 * an open-ended repeat (`*`, `+`, `{n,}`) counts `unbounded`. Lookarounds and anchors count nothing.
 */
export function longestMatch(pattern: RegExp, unbounded: number): number {
  const source = pattern.source
  let at = 0
  const alternatives = (): number => {
    let best = sequence()
    while (source[at] === '|') { at += 1; best = Math.max(best, sequence()) }
    return best
  }
  const sequence = (): number => {
    let total = 0
    while (at < source.length && source[at] !== '|' && source[at] !== ')') {
      let unit: number
      const char = source[at]
      if (char === '(') {
        at += 1
        let lookaround = false
        if (source[at] === '?') {
          const head = source.slice(at, at + 4)
          lookaround = /^\?(?:=|!|<=|<!)/.test(head)
          if (head.startsWith('?<') && !lookaround) at = source.indexOf('>', at) + 1
          else at += head.startsWith('?<=') || head.startsWith('?<!') ? 3 : 2
        }
        const inner = alternatives()
        at += 1 // ')'
        unit = lookaround ? 0 : inner
      } else if (char === '[') {
        at += 1
        while (at < source.length && source[at] !== ']') at += source[at] === '\\' ? 2 : 1
        at += 1
        unit = 1
      } else if (char === '\\') {
        unit = source[at + 1] === 'b' || source[at + 1] === 'B' ? 0 : 1
        at += 2
      } else if (char === '^' || char === '$') {
        unit = 0
        at += 1
      } else {
        unit = 1
        at += 1
      }
      let times = 1
      const quantifier = /^(?:\*|\+|\?|\{(\d+)(,(\d*))?\})/.exec(source.slice(at))
      if (quantifier) {
        at += quantifier[0].length
        if (quantifier[0] === '*' || quantifier[0] === '+') times = unbounded
        else if (quantifier[0] === '?') times = 1
        else if (quantifier[2] === undefined) times = Number(quantifier[1])
        else times = quantifier[3] ? Number(quantifier[3]) : unbounded
        if (source[at] === '?') at += 1 // lazy
      }
      total += unit * times
    }
    return total
  }
  return alternatives()
}

/**
 * How much terminal output is carried from one batch to the next: the longest secret the redactor knows, computed from
 * its patterns. An open-ended repeat inside a secret is taken to run as long as one terminal chunk, so a private key
 * block or a JWT printed across two batches is still seen whole.
 */
export const TERMINAL_SECRET_WINDOW = Math.max(...SECRET_PATTERNS.map(pattern => longestMatch(pattern, REMOTE_TEXT_LIMITS.terminalChunk)))

export type TextFilter = (text: string) => { text: string; redacted: number }

/**
 * Per-subscription redaction of a terminal stream. Each batch is filtered together with the tail carried from the
 * previous one, so a secret cut in two by the PTY batcher is still redacted. Only output that cannot be the start of
 * a secret still being printed is released; the carried tail waits for the next batch, or for `flush()`. Output is
 * never released twice.
 */
export class TerminalWindow {
  private held = ''

  constructor(private readonly filter: TextFilter, private readonly window = TERMINAL_SECRET_WINDOW) {}

  /** Raw characters read but not released yet. */
  get heldLength(): number { return this.held.length }

  reset(): void { this.held = '' }

  /** Adds raw output; returns what may be sent now, filtered. With `final`, everything held is released. */
  take(raw: string, final = false): { text: string; redacted: number } {
    const all = this.held + raw
    const at = final ? all.length : this.safeCut(all)
    this.held = all.slice(at)
    if (!at) return { text: '', redacted: 0 }
    return this.filter(all.slice(0, at))
  }

  flush(): { text: string; redacted: number } { return this.take('', true) }

  /**
   * The last place to cut before the window, where filtering both sides apart gives what filtering them together
   * gives: no secret and no path is cut there. Each refusal moves the cut to the blank before it.
   */
  private safeCut(text: string): number {
    let at = Math.max(0, text.length - this.window)
    const whole = at > 0 ? this.filter(text).text : ''
    for (let attempt = 0; attempt < 64 && at > 0; attempt += 1) {
      const code = text.charCodeAt(at - 1)
      if (code >= 0xd800 && code <= 0xdbff) at -= 1
      if (at > 0 && this.filter(text.slice(0, at)).text + this.filter(text.slice(at)).text === whole) return at
      const blank = text.slice(0, at - 1).search(/\s(?=\S*$)/)
      at = blank >= 0 ? blank : 0
    }
    return 0
  }
}
