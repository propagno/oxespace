/**
 * B19 / OXE-444 · `worktree.copyFiles` and `.worktreeinclude`: files from the main checkout (usually gitignored ones
 * such as `.env` or local configs) copied into a freshly created worktree, supporting order-sensitive `!negation`
 * rules, sensitive-pattern opt-in gating, and pure read-only dry-run planning.
 *
 * Bounds, all checked here and not trusted from the parser:
 * - a pattern (positive or `!negated`) is relative to the repository; absolute paths, drive letters, `..`, `.`, any
 *   `.git` segment, and the Windows spellings that can alias one (a `:` stream, a trailing dot or space, an 8.3
 *   `GIT~1`) are refused by name (C3) and copy nothing; so is a pattern too complex to match in bounded time;
 * - links are never followed, on either side: a matched link is reported, a directory link is not entered, and the
 *   real path of every source must be inside the repository, its segments passing the same rules (so an alias that
 *   resolves into `.git` is refused), and is the path the copy is written to; every destination folder is created
 *   one level at a time inside the worktree;
 * - nested repositories and worktrees (a folder holding `.git`) are never read, whether searched or named;
 * - only files git reports as ignored in the new worktree are copied, so a copy can never be committed by accident;
 * - sensitive files (`.env`, `.env.*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*credentials*`, `*secret*`, `id_rsa*`,
 *   `id_ed25519*`) are blocked fail-closed (`sensitive-opt-in-required`) unless explicitly approved for the repo;
 * - at most `INCLUDE_LIMITS.files` files and `INCLUDE_LIMITS.bytes` bytes (after applying `!negation` rules): above
 *   that nothing is copied and the report says so; the worktree exists either way;
 * - an existing destination is never overwritten (`COPYFILE_EXCL`).
 *
 * Nothing here throws: the worktree is already real when this runs, so every problem becomes a notice.
 */
import { constants, type Dirent } from 'node:fs'
import { copyFile, lstat, mkdir, readdir, realpath } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { MAIN_MESSAGE_PARAM_LIMITS, mainMessage, type MainMessage } from '../../../../shared/messages'
import type { WorktreeSkippedItem } from '../../../../shared/types/repo-config'

export const INCLUDE_LIMITS = { files: 200, bytes: 50 * 1024 * 1024, entries: 20_000, segments: 32, globstars: 8 } as const

export interface WorktreeIncludeReport {
  /** Repo-relative paths (with `/`) copied (or planned for copy in dryRun) into the worktree. */
  copied: string[]
  /** Deterministic list of skipped/blocked patterns and files with reason codes. */
  skipped: WorktreeSkippedItem[]
  /** Sensitive files blocked because explicit repository opt-in has not been approved. */
  sensitivePending: string[]
  /** What the person should read, in order: refused patterns, limits, the count copied, then skipped files. */
  notices: MainMessage[]
}

export interface CopyIncludedFilesOptions {
  /** Whether copying sensitive files has been explicitly approved for this repository. Defaults to false (fail-closed). */
  sensitiveApproved?: boolean
  /** Read-only dry-run: computes exact copied/skipped/sensitivePending without creating folders or copying files. */
  dryRun?: boolean
}

/** Which of these repo-relative paths git ignores in the new worktree (`git check-ignore`). */
/** `null` when git could not tell (it failed): then nothing is copied, and the report says git failed. */
export type IgnoredFilter = (paths: string[]) => Promise<Set<string> | null>

type Segment = RegExp | '**'

interface ParsedRule {
  negated: boolean
  raw: string
  segments: string[]
  matchers: Segment[]
  singleSegment: boolean
  directoryMatch: boolean
}

const DRIVE = /^[a-zA-Z]:/
const GLOB = /[*?]/

const SENSITIVE_BASENAME = /^(?:\.env(?:\.|$)|id_(?:rsa|ed25519)(?:\.|$))|\.(?:env|pem|key|p12|pfx)$/i
const SENSITIVE_SEGMENT = /credentials|secret/i
const SENSITIVE_PATTERN_SEGMENT = /^\.env|\.(?:env|pem|key|p12|pfx)(?:$|[*?])|credentials|secret|^id_(?:rsa|ed25519)/i

/** True when a concrete repo-relative file path names a sensitive secret/credential/key file. */
export function isSensitivePath(relativePath: string): boolean {
  const normalized = relativePath.trim().replace(/\\/g, '/').replace(/^\/+/, '')
  if (!normalized) return false
  const parts = normalized.split('/').filter(Boolean)
  const base = parts[parts.length - 1] ?? ''
  if (SENSITIVE_BASENAME.test(base)) return true
  return parts.some((part) => SENSITIVE_SEGMENT.test(part))
}

/** True when a declarative include pattern explicitly targets sensitive files (`.env*`, `*.key`, `*secret*`, etc.). */
export function isSensitivePattern(pattern: string): boolean {
  let body = pattern.trim().replace(/\\/g, '/')
  if (body.startsWith('!')) body = body.slice(1).trim()
  if (body.startsWith('./')) body = body.slice(2)
  body = body.replace(/\/+$/, '')
  if (!body) return false
  const parts = body.split('/').filter(Boolean)
  return parts.some((part) => SENSITIVE_PATTERN_SEGMENT.test(part))
}

/** Positive (non-negated) patterns from `patterns` that match sensitive targets, normalized and deduplicated. */
export function extractSensitivePatterns(patterns: readonly string[]): string[] {
  const out = new Set<string>()
  for (const raw of patterns) {
    const trimmed = raw.trim().replace(/\\/g, '/')
    if (!trimmed || trimmed.startsWith('!')) continue
    if (isSensitivePattern(trimmed)) out.add(trimmed)
  }
  return [...out]
}

/**
 * A segment that may not appear in an include path: `.`, `..`, `.git` in any case, and the Windows spellings that can
 * name another entry: a `:` (an NTFS stream such as `.git::$INDEX_ALLOCATION`), a trailing dot or space (stripped by
 * Windows), and the 8.3 short name of `.git` (`GIT~1`).
 */
function forbiddenSegment(segment: string): boolean {
  const lower = segment.toLowerCase()
  return segment === '' || segment === '.' || segment === '..' || lower === '.git' || segment.includes(':') ||
    /[. ]$/.test(segment) || /^git~\d+$/.test(lower)
}

/** The pattern's segments, or null when it may not be used. Runs of `**` count as one. */
export function includeSegments(pattern: string): string[] | null {
  let text = pattern.trim().replace(/\\/g, '/')
  if (text.startsWith('/') || DRIVE.test(text)) return null
  if (text.startsWith('./')) text = text.slice(2)
  text = text.replace(/\/+$/, '')
  if (!text) return null
  const segments = text.split('/').filter((s, i, all) => !(s === '**' && all[i - 1] === '**'))
  return segments.some(forbiddenSegment) ? null : segments
}

/** Whether a valid pattern stays within the matcher's bounds. */
function withinBounds(segments: string[]): boolean {
  return segments.length <= INCLUDE_LIMITS.segments && segments.filter((s) => s === '**').length <= INCLUDE_LIMITS.globstars
}

function segmentMatcher(segment: string): Segment {
  if (segment === '**') return '**'
  // `*` and `?` stay inside one segment; everything else is literal. One `*` run is one `[^/]*`.
  const body = segment.replace(/\*+/g, '*').split('').map((c) => (c === '*' ? '[^/]*' : c === '?' ? '[^/]' : c.replace(/[.+^${}()|[\]\\]/g, '\\$&'))).join('')
  return new RegExp(`^${body}$`)
}

/** Whether `path` matches `pattern`: a table over (pattern position, path position), so the cost is P × S. */
function matchesAll(pattern: Segment[], path: string[]): boolean {
  // reach[s] after step p: whether pattern[0..p) can match path[0..s).
  let reach = new Array<boolean>(path.length + 1).fill(false)
  reach[0] = true
  for (const head of pattern) {
    const next = new Array<boolean>(path.length + 1).fill(false)
    for (let s = 0; s <= path.length; s++) {
      if (head === '**') next[s] = reach[s] || (s > 0 && next[s - 1])
      else next[s] = s > 0 && reach[s - 1] && head.test(path[s - 1])
    }
    reach = next
  }
  return reach[path.length]
}

/** Whether some path below `dir` could still match: decides if a folder is worth entering. Linear in the pattern. */
function couldMatchBelow(pattern: Segment[], dir: string[]): boolean {
  for (let p = 0, s = 0; ; p++, s++) {
    if (s === dir.length) return p < pattern.length
    if (p === pattern.length) return false
    const head = pattern[p]
    if (head === '**') return true
    if (!head.test(dir[s])) return false
  }
}

function ruleMatches(rule: ParsedRule, path: string[]): boolean {
  if (matchesAll(rule.matchers, path)) return true
  if (rule.directoryMatch && matchesAll([...rule.matchers, '**'], path)) return true
  if (rule.negated) {
    // A negated directory prefix (e.g. `!certs/dev`) excludes everything under it.
    if (matchesAll([...rule.matchers, '**'], path)) return true
    // A single-segment negation without `/` (e.g. `!.env.production`) matches basename at any depth (.gitignore semantics).
    if (rule.singleSegment && rule.matchers[0] instanceof RegExp) {
      const rx = rule.matchers[0]
      if (rx.test(path[path.length - 1])) return true
      // Also allow excluding a directory name anywhere in the path (e.g. `!dist`).
      if (path.slice(0, -1).some((seg) => rx.test(seg))) return true
    }
  }
  return false
}

function inside(parent: string, child: string): boolean {
  const base = parent.endsWith(sep) ? parent : parent + sep
  return process.platform === 'win32' ? child.toLowerCase().startsWith(base.toLowerCase()) : child.startsWith(base)
}

function same(a: string, b: string): boolean {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

async function tryLstat(path: string) {
  try { return await lstat(path) } catch { return null }
}

async function tryReaddir(path: string): Promise<Dirent[]> {
  try { return await readdir(path, { withFileTypes: true }) } catch { return [] }
}

/** Caps a list to what a C3 parameter may carry. */
function capped(paths: string[]): string[] {
  const { listLength, textLength } = MAIN_MESSAGE_PARAM_LIMITS
  return paths.slice(0, listLength).map((p) => (p.length > textLength ? `…${p.slice(-(textLength - 1))}` : p))
}

interface Found {
  files: Map<string, { source: string; size: number }>
  links: Set<string>
  entries: number
  tooLarge: boolean
}

/** Whether `<rootReal>/<dir>` holds a `.git` (another repository, a submodule or a worktree). */
async function nestedRepository(rootReal: string, dir: string[]): Promise<boolean> {
  return dir.length > 0 && (await tryLstat(join(rootReal, ...dir, '.git'))) !== null
}

/** Adds what one positive rule matches under `rootReal`. Directory links are never entered; matched links are recorded. */
async function search(rootReal: string, rule: ParsedRule, found: Found): Promise<void> {
  const { segments } = rule
  const firstGlob = segments.findIndex((s) => s === '**' || GLOB.test(s))
  const literal = firstGlob < 0 ? segments : segments.slice(0, firstGlob)
  let pattern = rule.matchers

  // A named prefix never runs through another repository either: each of its folders is checked like the walk does.
  for (let depth = 1; depth < literal.length; depth++) if (await nestedRepository(rootReal, literal.slice(0, depth))) return

  const start = join(rootReal, ...literal)
  const startInfo = await tryLstat(start)
  if (literal.length > 0) {
    if (!startInfo) return
    // A literal prefix may run through a link the walk would never enter: its real place must stay in the repository.
    const real = await realpath(start).catch(() => null)
    if (startInfo.isSymbolicLink() || !real || !inside(rootReal, real)) { found.links.add(literal.join('/')); return }
    if (firstGlob < 0) {
      if (startInfo.isFile()) { found.files.set(literal.join('/'), { source: start, size: startInfo.size }); return }
      if (!startInfo.isDirectory() || (await nestedRepository(rootReal, literal))) return
      // A folder named on its own stands for everything under it.
      rule.directoryMatch = true
      pattern = [...pattern, '**']
    } else if (await nestedRepository(rootReal, literal)) {
      return
    }
  }

  const stack: string[][] = [literal]
  while (stack.length) {
    const dir = stack.pop()!
    for (const entry of await tryReaddir(join(rootReal, ...dir))) {
      if (++found.entries > INCLUDE_LIMITS.entries) { found.tooLarge = true; return }
      if (entry.name.toLowerCase() === '.git') continue
      const path = [...dir, entry.name]
      const rel = path.join('/')
      if (entry.isSymbolicLink()) {
        if (matchesAll(pattern, path)) found.links.add(rel)
        continue
      }
      if (entry.isDirectory()) {
        if (!couldMatchBelow(pattern, path)) continue
        // Another repository, a submodule or a worktree kept inside this one: not ours to copy from.
        if (await nestedRepository(rootReal, path)) continue
        stack.push(path)
      } else if (entry.isFile() && matchesAll(pattern, path) && !found.files.has(rel)) {
        const info = await tryLstat(join(rootReal, ...path))
        if (info?.isFile()) found.files.set(rel, { source: join(rootReal, ...path), size: info.size })
      }
    }
  }
}

/**
 * Creates each folder of a file's parent under `worktreeReal` one level at a time, refusing a level that is a link or
 * whose real place has left the worktree. `null` when the file may not be written there.
 */
async function destinationFolder(worktreeReal: string, parents: string[]): Promise<string | null> {
  let current = worktreeReal
  for (const name of parents) {
    const next = join(current, name)
    const info = await tryLstat(next)
    if (!info) {
      try { await mkdir(next) } catch { if (!(await tryLstat(next))?.isDirectory()) return null }
    } else if (info.isSymbolicLink() || !info.isDirectory()) {
      return null
    }
    const real = await realpath(next).catch(() => null)
    if (!real || !inside(worktreeReal, real)) return null
    current = real
  }
  return current
}

export async function copyIncludedFiles(
  rootPath: string,
  worktreePath: string,
  patterns: readonly string[],
  ignored?: IgnoredFilter,
  options: CopyIncludedFilesOptions = {}
): Promise<WorktreeIncludeReport> {
  const report: WorktreeIncludeReport = { copied: [], skipped: [], sensitivePending: [], notices: [] }
  if (patterns.length === 0) return report

  const dryRun = options.dryRun === true
  const sensitiveApproved = options.sensitiveApproved === true

  // Parse positive and `!negated` rules, refusing outside-repo and overly complex patterns by name.
  const rules: ParsedRule[] = []
  const outside: string[] = []
  const complex: string[] = []
  for (const pattern of patterns) {
    const trimmed = pattern.trim()
    const negated = trimmed.startsWith('!')
    const body = negated ? trimmed.slice(1).trim() : trimmed
    const segments = includeSegments(body)
    if (!segments) {
      outside.push(pattern)
      report.skipped.push({ path: pattern, kind: 'pattern', reason: 'outside-repo' })
    } else if (!withinBounds(segments)) {
      complex.push(pattern)
      report.skipped.push({ path: pattern, kind: 'pattern', reason: 'too-complex' })
    } else {
      rules.push({
        negated,
        raw: pattern,
        segments,
        matchers: segments.map(segmentMatcher),
        singleSegment: segments.length === 1 && !body.replace(/\\/g, '/').includes('/'),
        directoryMatch: false
      })
    }
  }
  if (outside.length) report.notices.push(mainMessage('worktree.copyFiles.outsideRepo', { patterns: capped(outside) }))
  if (complex.length) report.notices.push(mainMessage('worktree.copyFiles.tooComplex', { patterns: capped(complex) }))

  const positiveRules = rules.filter((r) => !r.negated)
  if (positiveRules.length === 0) return report

  const rootReal = await realpath(rootPath).catch(() => null)
  const worktreeReal = dryRun ? null : await realpath(worktreePath).catch(() => null)
  if (!rootReal) return report
  if (!dryRun && (!worktreeReal || same(rootReal, worktreeReal))) return report

  const found: Found = { files: new Map(), links: new Set(), entries: 0, tooLarge: false }
  for (const rule of positiveRules) {
    await search(rootReal, rule, found)
    if (found.tooLarge) {
      report.notices.push(mainMessage('worktree.copyFiles.searchTooLarge', { limit: INCLUDE_LIMITS.entries }))
      return report
    }
  }

  // Each source by its real place: the path it is checked by, and the path it is written to.
  const notFollowed: string[] = [...found.links]
  const sources = new Map<string, { real: string; size: number }>()
  for (const [rel, file] of found.files) {
    const real = await realpath(file.source).catch(() => null)
    const info = await tryLstat(file.source)
    const canonical = real && inside(rootReal, real) ? relative(rootReal, real).split(sep) : null
    if (!real || !info?.isFile() || !canonical || canonical.some(forbiddenSegment)) {
      notFollowed.push(rel)
      continue
    }
    const key = canonical.join('/')
    if (!sources.has(key)) sources.set(key, { real, size: info.size })
  }

  // Evaluate rules in declared order so `!negation` and later re-inclusions are strictly order-sensitive.
  const allCanonical = [...sources.keys()].sort((a, b) => a.localeCompare(b))
  const excludedByNegation: string[] = []
  let includedKeys: string[] = []
  for (const rel of allCanonical) {
    const parts = rel.split('/')
    let included = false
    for (const rule of rules) {
      if (ruleMatches(rule, parts)) included = !rule.negated
    }
    if (included) includedKeys.push(rel)
    else excludedByNegation.push(rel)
  }

  for (const rel of excludedByNegation) {
    report.skipped.push({ path: rel, kind: 'copy-file', reason: 'excluded-by-negation' })
  }

  const totalBytes = includedKeys.reduce((sum, rel) => sum + (sources.get(rel)?.size ?? 0), 0)
  if (includedKeys.length > INCLUDE_LIMITS.files || totalBytes > INCLUDE_LIMITS.bytes) {
    for (const rel of includedKeys) report.skipped.push({ path: rel, kind: 'copy-file', reason: 'over-limit' })
    report.notices.push(mainMessage('worktree.copyFiles.overLimit', {
      files: includedKeys.length,
      megabytes: Math.ceil(totalBytes / (1024 * 1024)),
      maxFiles: INCLUDE_LIMITS.files,
      maxMegabytes: INCLUDE_LIMITS.bytes / (1024 * 1024)
    }))
    return report
  }

  // Only what git ignores in the new worktree: anything else would show up as a change someone could commit.
  const notIgnored: string[] = []
  if (ignored && includedKeys.length) {
    const set = await ignored(includedKeys).catch(() => null)
    if (!set) {
      for (const rel of includedKeys) report.skipped.push({ path: rel, kind: 'copy-file', reason: 'ignore-check-failed' })
      report.notices.push(mainMessage('worktree.copyFiles.ignoreCheckFailed', {}))
      return report
    }
    notIgnored.push(...includedKeys.filter((rel) => !set.has(rel)))
    includedKeys = includedKeys.filter((rel) => set.has(rel))
  }
  for (const rel of notIgnored) {
    report.skipped.push({ path: rel, kind: 'copy-file', reason: 'not-ignored' })
  }

  // Sensitive-pattern opt-in gate (fail-closed until explicitly approved for the primary repo).
  const toCopy: string[] = []
  for (const rel of includedKeys) {
    if (isSensitivePath(rel) && !sensitiveApproved) {
      report.sensitivePending.push(rel)
      report.skipped.push({ path: rel, kind: 'copy-file', reason: 'sensitive-opt-in-required' })
    } else {
      toCopy.push(rel)
    }
  }

  const kept: string[] = []
  const failed: string[] = []
  if (dryRun) {
    report.copied.push(...toCopy)
  } else {
    for (const rel of toCopy) {
      const parts = rel.split('/')
      const folder = await destinationFolder(worktreeReal!, parts.slice(0, -1))
      if (!folder) { notFollowed.push(rel); continue }
      const target = join(folder, parts[parts.length - 1])
      if (await tryLstat(target)) { kept.push(rel); continue }
      try {
        await copyFile(sources.get(rel)!.real, target, constants.COPYFILE_EXCL)
        report.copied.push(rel)
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === 'EEXIST') kept.push(rel)
        else failed.push(rel)
      }
    }
  }

  const sortedNotFollowed = [...new Set(notFollowed)].sort((a, b) => a.localeCompare(b))
  for (const rel of kept) report.skipped.push({ path: rel, kind: 'copy-file', reason: 'target-exists' })
  for (const rel of sortedNotFollowed) report.skipped.push({ path: rel, kind: 'copy-file', reason: 'symlink-escape' })
  for (const rel of failed) report.skipped.push({ path: rel, kind: 'copy-file', reason: 'copy-failed' })

  if (report.copied.length) report.notices.push(mainMessage('worktree.copyFiles.copied', { count: report.copied.length }))
  if (report.sensitivePending.length) report.notices.push(mainMessage('worktree.copyFiles.sensitiveOptInRequired', { paths: capped(report.sensitivePending) }))
  if (kept.length) report.notices.push(mainMessage('worktree.copyFiles.notOverwritten', { paths: capped(kept) }))
  if (notIgnored.length) report.notices.push(mainMessage('worktree.copyFiles.notIgnored', { paths: capped(notIgnored) }))
  if (sortedNotFollowed.length) report.notices.push(mainMessage('worktree.copyFiles.notFollowed', { paths: capped(sortedNotFollowed) }))
  if (failed.length) report.notices.push(mainMessage('worktree.copyFiles.failed', { paths: capped(failed) }))
  return report
}
