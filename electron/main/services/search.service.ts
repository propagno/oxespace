import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { rgPath as BUNDLED_RG_PATH } from '@vscode/ripgrep'
import type {
  SearchInput,
  SearchMatch,
  SearchFileResult,
  SearchResult,
  SearchSubmatch
} from '../../../shared/types/search'

// Safety rails — find-in-files must never flood the renderer. A search across a
// huge tree (or a pathological regex) can match millions of lines; we cap what
// we surface and kill ripgrep once a cap is hit, marking the result truncated.
const MAX_FILES = 500
const MAX_MATCHES_PER_FILE = 200
const MAX_TOTAL_MATCHES = 5_000
const MAX_LINE_LENGTH = 1_000
const SPAWN_TIMEOUT_MS = 20_000
const RESOLVE_TIMEOUT_MS = 5_000
const MAX_CONTEXT_LINES = 5

// Cache the resolved ripgrep command the same way GitService caches git: positive
// resolutions are memoized forever (the binary doesn't move at runtime), a null
// (not found) is treated as "unknown for now" so a later call retries.
let cachedRgCommand: string | undefined
let rgResolveInFlight: Promise<string | null> | null = null

/** In a packaged app the module path points inside `app.asar`, but the binary
 *  is `asarUnpack`'d — rewrite to the unpacked location. No-op in dev. */
function bundledRgPath(): string | null {
  const path = BUNDLED_RG_PATH.includes('app.asar')
    ? BUNDLED_RG_PATH.replace('app.asar', 'app.asar.unpacked')
    : BUNDLED_RG_PATH
  return existsSync(path) ? path : null
}

function probe(command: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const done = (ok: boolean) => { if (!settled) { settled = true; resolve(ok) } }
    try {
      const child = spawn(command, args, { shell: false, windowsHide: true })
      const timer = setTimeout(() => { try { child.kill() } catch { /* gone */ } done(false) }, RESOLVE_TIMEOUT_MS)
      child.on('error', () => { clearTimeout(timer); done(false) })
      child.on('close', (code) => { clearTimeout(timer); done(code === 0) })
    } catch {
      done(false)
    }
  })
}

async function resolveRgCommand(): Promise<string | null> {
  if (cachedRgCommand !== undefined) return cachedRgCommand
  const bundled = bundledRgPath()
  if (bundled) { cachedRgCommand = bundled; return bundled }
  if (rgResolveInFlight) return rgResolveInFlight

  rgResolveInFlight = (async () => {
    if (await probe('rg', ['--version'])) return 'rg'
    if (process.platform === 'win32' && (await probe('where.exe', ['rg']))) return 'rg'
    return null
  })()

  try {
    const resolved = await rgResolveInFlight
    if (resolved !== null) cachedRgCommand = resolved
    return resolved
  } finally {
    rgResolveInFlight = null
  }
}

/** Test-only: reset the resolved ripgrep command cache. */
export function __resetRgCommandCacheForTests(): void {
  cachedRgCommand = undefined
  rgResolveInFlight = null
}

function buildArgs(input: SearchInput): string[] {
  const args = ['--json']
  args.push(input.caseSensitive ? '-s' : '-S') // smart-case by default
  if (!input.isRegex) args.push('-F') // fixed-string unless regex requested
  if (input.includeIgnored) args.push('--no-ignore', '--hidden')
  const ctx = Math.min(Math.max(Math.trunc(input.contextLines ?? 0), 0), MAX_CONTEXT_LINES)
  if (ctx > 0) args.push('-C', String(ctx))
  for (const glob of input.globs ?? []) {
    if (glob.trim()) args.push('-g', glob)
  }
  // Cap per-file matches and drop the text of absurdly long lines at the rg level
  // so a minified bundle can't stream megabytes per match.
  args.push('-m', String(MAX_MATCHES_PER_FILE))
  args.push('-M', String(MAX_LINE_LENGTH))
  // `-e` lets the pattern start with `-`; `.` searches the cwd so paths stay relative.
  args.push('-e', input.query, '.')
  return args
}

function normalizePath(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null
  let path = value.replace(/\\/g, '/')
  if (path.startsWith('./')) path = path.slice(2)
  return path
}

interface RgMatchData {
  line_number?: number
  lines?: { text?: string }
  submatches?: Array<{ match?: { text?: string }; start?: number; end?: number }>
}

function toMatch(data: RgMatchData): SearchMatch | null {
  const lineNumber = typeof data.line_number === 'number' ? data.line_number : null
  if (lineNumber === null) return null

  const submatches: SearchSubmatch[] = Array.isArray(data.submatches)
    ? data.submatches.map((s) => ({
        text: typeof s.match?.text === 'string' ? s.match.text : '',
        start: typeof s.start === 'number' ? s.start : 0,
        end: typeof s.end === 'number' ? s.end : 0
      }))
    : []

  let line = typeof data.lines?.text === 'string' ? data.lines.text.replace(/\r?\n$/, '') : ''
  // rg drops the line text when it exceeds `-M`; fall back to the matched snippet.
  if (!line && submatches.length > 0) line = submatches.map((s) => s.text).join(' … ')
  if (line.length > MAX_LINE_LENGTH) line = `${line.slice(0, MAX_LINE_LENGTH)}…`

  return { lineNumber, line, submatches }
}

function emptyResult(startedAt: number, error?: string): SearchResult {
  return { files: [], totalMatches: 0, totalFiles: 0, truncated: false, elapsedMs: Date.now() - startedAt, error }
}

export class SearchService {
  private currentChild: ChildProcess | null = null

  /** Cancel any in-flight search (new search supersedes the old, or panel closed). */
  cancel(): void {
    if (this.currentChild) {
      try { this.currentChild.kill() } catch { /* already exited */ }
      this.currentChild = null
    }
  }

  async search(input: SearchInput): Promise<SearchResult> {
    const startedAt = Date.now()
    this.cancel()

    if (!input.query || input.query.trim().length === 0) return emptyResult(startedAt)
    if (!existsSync(input.rootPath)) return emptyResult(startedAt, 'Search root does not exist')

    const rg = await resolveRgCommand()
    if (!rg) return emptyResult(startedAt, 'ripgrep executable not found')

    return new Promise<SearchResult>((resolve) => {
      let child: ChildProcess
      try {
        child = spawn(rg, buildArgs(input), { cwd: input.rootPath, shell: false, windowsHide: true })
      } catch (err) {
        resolve(emptyResult(startedAt, err instanceof Error ? err.message : String(err)))
        return
      }
      this.currentChild = child

      const files: SearchFileResult[] = []
      const fileByPath = new Map<string, SearchFileResult>()
      let totalMatches = 0
      let truncated = false
      let settled = false
      let buffer = ''

      const finish = (error?: string): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (this.currentChild === child) this.currentChild = null
        resolve({
          files,
          totalMatches,
          totalFiles: files.length,
          truncated,
          elapsedMs: Date.now() - startedAt,
          error
        })
      }

      const stopEarly = (): void => { try { child.kill() } catch { /* already exited */ } }

      const timer = setTimeout(() => {
        truncated = true
        stopEarly()
        finish()
      }, SPAWN_TIMEOUT_MS)

      child.stdout?.setEncoding('utf8')
      child.stdout?.on('data', (chunk: string) => {
        if (truncated) return
        buffer += chunk
        let nl: number
        while ((nl = buffer.indexOf('\n')) !== -1) {
          const raw = buffer.slice(0, nl)
          buffer = buffer.slice(nl + 1)
          if (!raw) continue

          let event: { type?: string; data?: RgMatchData & { path?: { text?: string } } }
          try { event = JSON.parse(raw) } catch { continue }
          if (event.type !== 'match' || !event.data) continue

          const rel = normalizePath(event.data.path?.text)
          if (!rel) continue

          let fileResult = fileByPath.get(rel)
          if (!fileResult) {
            if (files.length >= MAX_FILES) { truncated = true; stopEarly(); break }
            fileResult = { path: rel, matches: [], truncated: false }
            fileByPath.set(rel, fileResult)
            files.push(fileResult)
          }

          if (fileResult.matches.length >= MAX_MATCHES_PER_FILE) { fileResult.truncated = true; continue }

          const match = toMatch(event.data)
          if (!match) continue
          fileResult.matches.push(match)
          totalMatches += 1
          if (totalMatches >= MAX_TOTAL_MATCHES) { truncated = true; stopEarly(); break }
        }
      })

      child.on('error', (err) => finish(err.message))
      child.on('close', () => finish())
    })
  }
}
