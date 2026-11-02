import { existsSync, promises as fsp, watch as fsWatch, type FSWatcher } from 'node:fs'
import { spawn, type SpawnOptions } from 'node:child_process'
import { join, resolve as resolvePath } from 'node:path'
import { prepareGit, runGit } from '../utils/safe-git'
import type { GitBranchStatus, GitCompareMode, GitControlFile, GitControlStatus, GitDiff, GitDiffFile, GitDiffInput, GitDiffSummary, GitDiffSummaryFile, GitFileOriginal, GitSummaryStatus } from '../../../shared/types/git'

export interface SpawnGitResult {
  stdout: string
  stderr: string
  status: number | null
}

export type SpawnGitFn = (args: string[], cwd: string) => Promise<SpawnGitResult>

interface WatchEntry {
  watcher: FSWatcher
  timeout: NodeJS.Timeout | null
}

// Safety rails — review on a thousand-file diff is unusable in the UI and just
// causes the renderer to die under React render cost. We surface what fits and
// drop the rest with a synthetic "too many files" entry so the user knows.
const MAX_FILES = 300
const MAX_LINES_PER_FILE = 2000
const SPAWN_TIMEOUT_MS = 30_000
// New files an agent creates are untracked, so `git diff` never lists them. They are
// added to the summary, bounded: how many are read for a line count and how large.
const MAX_UNTRACKED_FILES = 500
const MAX_UNTRACKED_COUNT_BYTES = 1024 * 1024
const RESOLVE_TIMEOUT_MS = 5_000
// Cache strategy: cache POSITIVE resolutions forever (git path doesn't move
// at runtime). Negative results (git not found) cache only for the duration
// of the in-flight resolve and are NOT persisted — the user may install git
// while the app is running and we want the next call to retry. Previously
// `cachedGitCommand = null` was persisted, leaving the entire UI permanently
// reporting "branch unavailable" even after git became available.
let cachedGitCommand: string | undefined
let gitResolveInFlight: Promise<string | null> | null = null

function spawnCommandAsync(command: string, args: string[], cwd: string, timeoutMs: number, maxOutputBytes = Infinity, env?: NodeJS.ProcessEnv): Promise<SpawnGitResult> {
  return new Promise((resolve) => {
    const opts: SpawnOptions = { cwd, shell: false, windowsHide: true, ...(env ? { env } : {}) }
    const child = spawn(command, args, opts)
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try { child.kill() } catch { /* already exited */ }
      resolve({ stdout, stderr: stderr || `${command} ${args[0]} timed out after ${timeoutMs}ms`, status: null })
    }, timeoutMs)

    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      if (settled) return
      if (Buffer.byteLength(stdout) + Buffer.byteLength(chunk) > maxOutputBytes) {
        settled = true
        clearTimeout(timer)
        try { child.kill() } catch { /* already exited */ }
        resolve({ stdout: '', stderr: 'Git status exceeds the display limit; narrow the worktree changes and refresh.', status: null })
        return
      }
      stdout += chunk
    })
    child.stderr?.on('data', (chunk: string) => { stderr += chunk })
    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ stdout, stderr: stderr || err.message, status: null })
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ stdout, stderr, status: code })
    })
  })
}

async function resolveGitCommand(cwd: string): Promise<string | null> {
  if (cachedGitCommand !== undefined) return cachedGitCommand
  if (gitResolveInFlight) return gitResolveInFlight

  gitResolveInFlight = (async () => {
    const direct = await runGit(cwd, ['--version'], { timeout: RESOLVE_TIMEOUT_MS })
    if (direct.ok) return 'git'

    if (process.platform === 'win32') {
      const where = await spawnCommandAsync('where.exe', ['git'], cwd, RESOLVE_TIMEOUT_MS)
      const found = where.status === 0
        ? where.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean)
        : null
      if (found) return found

      const candidates = [
        process.env.ProgramFiles ? join(process.env.ProgramFiles, 'Git', 'cmd', 'git.exe') : '',
        process.env.ProgramFiles ? join(process.env.ProgramFiles, 'Git', 'bin', 'git.exe') : '',
        process.env['ProgramFiles(x86)'] ? join(process.env['ProgramFiles(x86)']!, 'Git', 'cmd', 'git.exe') : '',
        process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Programs', 'Git', 'cmd', 'git.exe') : ''
      ].filter(Boolean)

      for (const candidate of candidates) {
        if (existsSync(candidate)) return candidate
      }
    }

    return null
  })()

  try {
    const resolved = await gitResolveInFlight
    // Only memoize success. Returning null is treated as "unknown for now"
    // so a subsequent call (after the user installs git, after a Windows
    // PATH refresh, etc.) gets a fresh attempt.
    if (resolved !== null) cachedGitCommand = resolved
    return resolved
  } finally {
    gitResolveInFlight = null
  }
}

/** Test-only: reset the resolved git command cache so each test gets a fresh
 *  resolution attempt. Not exported in production paths. */
export function __resetGitCommandCacheForTests(): void {
  cachedGitCommand = undefined
  gitResolveInFlight = null
}

async function spawnGitAsync(args: string[], cwd: string): Promise<SpawnGitResult> {
  const git = await resolveGitCommand(cwd)
  if (!git) {
    return { stdout: '', stderr: 'Git executable not found', status: null }
  }
  // A porcelain status must not take the index lock an agent's own git may be waiting on.
  const porcelain = args.includes('--porcelain=v2')
  let prepared
  try { prepared = await prepareGit(cwd, porcelain ? ['--no-optional-locks', ...args] : args, { git }) }
  catch (error) { return { stdout: '', stderr: error instanceof Error ? error.message : String(error), status: null } }
  return spawnCommandAsync(prepared.command, prepared.args, cwd, SPAWN_TIMEOUT_MS, porcelain ? 4 * 1024 * 1024 : Infinity, prepared.env)
}

/** Parse one bounded porcelain-v2 snapshot. NUL records preserve unusual file names. */
export function parseGitControlStatus(raw: string): GitControlStatus {
  const files: GitControlFile[] = []
  let branch: string | null = null, upstream: string | null = null, ahead = 0, behind = 0
  const records = raw.split('\0')
  for (let index = 0; index < records.length && files.length < 1000; index++) {
    const record = records[index]
    if (record.startsWith('# branch.head ')) { branch = record.slice(14) || null; continue }
    if (record.startsWith('# branch.upstream ')) { upstream = record.slice(18) || null; continue }
    if (record.startsWith('# branch.ab ')) {
      const match = /^# branch\.ab \+(\d+) -(\d+)/.exec(record)
      if (match) { ahead = Number(match[1]); behind = Number(match[2]) }
      continue
    }
    if (record.startsWith('? ')) { files.push({ path: record.slice(2), staged: false, unstaged: true, untracked: true, conflicted: false, status: '?' }); continue }
    if (!/^[12u] /.test(record)) continue
    const fields = record.split(' ')
    const kind = record[0], xy = fields[1] ?? '..'
    const pathOffset = kind === '1' ? 8 : kind === '2' ? 9 : 10
    const path = fields.slice(pathOffset).join(' ')
    if (kind === '2') index++ // the following NUL record is the original rename path
    if (!path) continue
    files.push({ path, staged: kind === 'u' || xy[0] !== '.', unstaged: kind === 'u' || xy[1] !== '.', untracked: false, conflicted: kind === 'u', status: xy })
  }
  return { branch, upstream, ahead, behind, files, checkedAt: Date.now(), ...(files.length >= 1000 ? { truncated: true } : {}) }
}

export function parseDiffOutput(raw: string): GitDiffFile[] {
  const files: GitDiffFile[] = []
  if (!raw) return files

  let current: GitDiffFile | null = null
  let oldLineNo = 0
  let newLineNo = 0
  let truncated = false

  for (const line of raw.split('\n')) {
    if (line.startsWith('diff --git ')) {
      if (current) files.push(current)
      const match = /^diff --git a\/.+ b\/(.+)$/.exec(line)
      current = { path: match?.[1] ?? '', additions: 0, deletions: 0, hunks: [], mtime: null }
      oldLineNo = 0
      newLineNo = 0
      truncated = false
      continue
    }

    if (!current) continue
    if (truncated) continue

    if (line.startsWith('@@ ')) {
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
      oldLineNo = m ? parseInt(m[1], 10) : 0
      newLineNo = m ? parseInt(m[2], 10) : 0
      current.hunks.push({ header: line, lines: [] })
      continue
    }

    const hunk = current.hunks[current.hunks.length - 1]
    if (!hunk) continue

    // Per-file cap — a single 50k-line lockfile would otherwise produce a
    // table the renderer can't paint without freezing.
    const totalLines = current.additions + current.deletions
    if (totalLines >= MAX_LINES_PER_FILE) {
      if (!truncated) {
        truncated = true
        hunk.lines.push({
          type: 'context',
          oldLineNo: null,
          newLineNo: null,
          content: `… file truncated at ${MAX_LINES_PER_FILE} changed lines — open it in the editor to view the rest`
        })
      }
      continue
    }

    if (line.startsWith('+') && !line.startsWith('+++')) {
      hunk.lines.push({ type: 'added', oldLineNo: null, newLineNo: newLineNo++, content: line.slice(1) })
      current.additions++
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      hunk.lines.push({ type: 'removed', oldLineNo: oldLineNo++, newLineNo: null, content: line.slice(1) })
      current.deletions++
    } else if (line.startsWith(' ')) {
      hunk.lines.push({ type: 'context', oldLineNo: oldLineNo++, newLineNo: newLineNo++, content: line.slice(1) })
    }
  }

  if (current) files.push(current)
  return files
}

function mergeFiles(a: GitDiffFile[], b: GitDiffFile[]): GitDiffFile[] {
  const map = new Map<string, GitDiffFile>()
  for (const f of a) map.set(f.path, f)
  for (const f of b) {
    const existing = map.get(f.path)
    if (existing) {
      map.set(f.path, {
        ...existing,
        additions: existing.additions + f.additions,
        deletions: existing.deletions + f.deletions,
        hunks: [...existing.hunks, ...f.hunks]
      })
    } else {
      map.set(f.path, f)
    }
  }
  return [...map.values()]
}

/**
 * One-shot batch mtime fetch. Instead of `git log -1 -- <path>` per file
 * (which used to fan out N spawns and block the main process for seconds on
 * larger diffs), we ask for a single log stream with `--name-only` and a
 * `%ct` marker per commit. As we walk the output, every file we haven't
 * seen yet gets the current commit's timestamp; older commits don't
 * overwrite. Stops as soon as every path has been matched.
 */
async function batchMtime(rootPath: string, paths: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (paths.length === 0) return out
  const wanted = new Set(paths)
  // Cap commits walked so a 1M-commit repo doesn't drag this on forever.
  const res = await spawnGitAsync(['log', '--name-only', '--format=__GIT_LOG__%ct', '--max-count=2000'], rootPath)
  if (res.status !== 0) return out
  let currentMtime: number | null = null
  for (const line of res.stdout.split('\n')) {
    if (line.startsWith('__GIT_LOG__')) {
      currentMtime = parseInt(line.slice('__GIT_LOG__'.length), 10) || null
      continue
    }
    if (!line || currentMtime === null) continue
    if (wanted.has(line) && !out.has(line)) {
      out.set(line, currentMtime)
      if (out.size === wanted.size) break
    }
  }
  return out
}

/** Largest base-side file returned to the renderer (bytes). */
const MAX_ORIGINAL_BYTES = 2 * 1024 * 1024

/** `git diff --numstat -z`: `added<TAB>deleted<TAB>path<NUL>`, renames as `added<TAB>deleted<TAB><NUL>old<NUL>new<NUL>`. */
export function parseNumstat(raw: string): Map<string, { additions: number; deletions: number; binary: boolean }> {
  const out = new Map<string, { additions: number; deletions: number; binary: boolean }>()
  const records = raw.split('\0')
  for (let index = 0; index < records.length; index++) {
    const record = records[index]
    if (!record) continue
    const match = /^(-|\d+)\t(-|\d+)\t([\s\S]*)$/.exec(record)
    if (!match) continue
    const binary = match[1] === '-' || match[2] === '-'
    let path = match[3]
    if (!path) { path = records[index + 2] ?? ''; index += 2 }
    if (path) out.set(path, { additions: binary ? 0 : Number(match[1]), deletions: binary ? 0 : Number(match[2]), binary })
  }
  return out
}

/** `git diff --name-status -z -M`: `M<NUL>path<NUL>`, `R087<NUL>old<NUL>new<NUL>`. */
export function parseNameStatus(raw: string): Array<{ status: GitSummaryStatus; path: string; oldPath?: string }> {
  const out: Array<{ status: GitSummaryStatus; path: string; oldPath?: string }> = []
  const records = raw.split('\0')
  for (let index = 0; index < records.length; index++) {
    const code = records[index]
    if (!code) continue
    const letter = code[0]
    if (letter === 'R' || letter === 'C') {
      const oldPath = records[index + 1], path = records[index + 2]
      index += 2
      if (path) out.push({ status: 'R', path, oldPath })
    } else {
      const path = records[index + 1]
      index += 1
      if (path) out.push({ status: letter === 'A' ? 'A' : letter === 'D' ? 'D' : 'M', path })
    }
  }
  return out
}

export function buildDiffSummaryFiles(nameStatus: string, numstat: string): GitDiffSummaryFile[] {
  const counts = parseNumstat(numstat)
  return parseNameStatus(nameStatus).map(entry => {
    const count = counts.get(entry.path)
    return { path: entry.path, oldPath: entry.oldPath, status: entry.status, additions: count?.additions ?? 0, deletions: count?.deletions ?? 0, binary: count?.binary ?? false }
  })
}

export class GitService {
  private readonly spawnGit: SpawnGitFn
  private readonly watchers = new Map<string, WatchEntry>()

  constructor(options?: { spawnGit?: SpawnGitFn }) {
    this.spawnGit = options?.spawnGit ?? spawnGitAsync
  }

  async getStatus(rootPath: string): Promise<GitControlStatus> {
    const result = await this.spawnGit(['-c', 'core.quotePath=false', 'status', '--porcelain=v2', '--branch', '-z', '--untracked-files=normal'], rootPath)
    if (result.status !== 0) return { branch: null, ahead: 0, behind: 0, files: [], checkedAt: Date.now(), error: result.stderr || 'Git status is unavailable.' }
    return parseGitControlStatus(result.stdout)
  }

  async getBranch(rootPath: string): Promise<GitBranchStatus> {
    const inside = await this.spawnGit(['rev-parse', '--is-inside-work-tree'], rootPath)
    if (inside.status !== 0 || inside.stdout.trim() !== 'true') {
      return {
        branch: null,
        detached: false,
        shortSha: null,
        error: inside.stderr || 'Not inside a Git work tree'
      }
    }

    const branchCommands = [
      ['branch', '--show-current'],
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      ['symbolic-ref', '--quiet', '--short', 'HEAD']
    ]

    for (const args of branchCommands) {
      const branch = await this.spawnGit(args, rootPath)
      const name = branch.status === 0 ? branch.stdout.trim() : ''
      if (name && name !== 'HEAD') {
        return { branch: name, detached: false, shortSha: null, error: null }
      }
    }

    const sha = await this.spawnGit(['rev-parse', '--short', 'HEAD'], rootPath)
    const shortSha = sha.status === 0 ? sha.stdout.trim() : ''
    return {
      branch: null,
      detached: Boolean(shortSha),
      shortSha: shortSha || null,
      error: shortSha ? null : sha.stderr || 'Unable to read Git branch'
    }
  }

  async buildDiff(rootPath: string, base: string, includeUncommitted: boolean, head?: string, mode: GitCompareMode = 'merge-base'): Promise<GitDiff> {
    // Side B as a ref is its committed state, so the work tree has nothing to add.
    if (head) includeUncommitted = false
    const target = head ?? 'HEAD'
    const range = mode === 'direct' ? [base, target] : [`${base}...${target}`]
    // Run the two diff spawns in parallel — they're independent and the
    // committed one in particular can be slow on big histories.
    const [committedRaw, uncommittedRaw] = await Promise.all([
      this.spawnGit(['diff', ...range, '--unified=3', '--', '.'], rootPath),
      includeUncommitted
        ? this.spawnGit(['diff', 'HEAD', '--unified=3', '--', '.'], rootPath)
        : Promise.resolve<SpawnGitResult>({ stdout: '', stderr: '', status: 0 })
    ])

    // An unknown ref used to come back as an empty diff, which reads as "no changes".
    if (committedRaw.status !== 0) throw new Error(committedRaw.stderr.trim() || `Git could not compare ${range.join(' ')}.`)
    const committedFiles = parseDiffOutput(committedRaw.stdout)
    const uncommittedFiles = includeUncommitted ? parseDiffOutput(uncommittedRaw.stdout) : []
    let files = includeUncommitted ? mergeFiles(committedFiles, uncommittedFiles) : committedFiles

    // Hard cap on file count — keep the diff usable even on massive PRs.
    if (files.length > MAX_FILES) {
      const dropped = files.length - MAX_FILES
      files = files.slice(0, MAX_FILES)
      files.push({
        path: `__truncated__/+${dropped}-more-files`,
        additions: 0,
        deletions: 0,
        mtime: null,
        hunks: [{
          header: `@@ truncated @@`,
          lines: [{ type: 'context', oldLineNo: null, newLineNo: null, content: `… ${dropped} more changed file(s) hidden — use the search filter or narrow the diff base to see them` }]
        }]
      })
    }

    // Batch mtime resolution (single git log instead of N).
    const mtimes = await batchMtime(rootPath, files.map((f) => f.path).filter((p) => !p.startsWith('__truncated__/')))
    for (const file of files) {
      file.mtime = mtimes.get(file.path) ?? null
    }

    return { files, base, includeUncommitted, compiledAt: Date.now() }
  }

  /**
   * Uncapped change list: the work tree (or HEAD) against the merge base of
   * `base`. Large repositories stay cheap because only numstat/name-status run;
   * file contents are fetched one file at a time by `getFileOriginal`.
   */
  async getDiffSummary(rootPath: string, base: string, includeUncommitted: boolean, head?: string, mode: GitCompareMode = 'merge-base'): Promise<GitDiffSummary> {
    if (head || mode === 'direct') return this.getComparisonSummary(rootPath, base, includeUncommitted, head, mode)
    const empty = { files: [], additions: 0, deletions: 0, base, mergeBase: null as string | null, includeUncommitted, compiledAt: Date.now() }
    const mergeBase = await this.spawnGit(['merge-base', base, 'HEAD'], rootPath)
    const from = mergeBase.status === 0 && mergeBase.stdout.trim() ? mergeBase.stdout.trim() : null
    if (!from) {
      // Unknown base: fall back to the work tree against HEAD.
      const head = await this.spawnGit(['rev-parse', '--verify', 'HEAD'], rootPath)
      if (head.status !== 0) return { ...empty, error: `Base “${base}” could not be resolved and the repository has no commits.`, messageCode: { code: 'git.base.unresolved', params: { base } } }
    }
    const range = [from ?? 'HEAD', ...(includeUncommitted ? [] : ['HEAD'])]
    const common = ['-c', 'core.quotePath=false', 'diff', '-M', '-z']
    const [names, numbers] = await Promise.all([
      this.spawnGit([...common, '--name-status', ...range, '--'], rootPath),
      this.spawnGit([...common, '--numstat', ...range, '--'], rootPath)
    ])
    if (names.status !== 0) return { ...empty, mergeBase: from, error: names.stderr || 'Git diff is unavailable.' }
    const files = buildDiffSummaryFiles(names.stdout, numbers.stdout)
    if (includeUncommitted) {
      const known = new Set(files.map(file => file.path))
      for (const added of await this.untrackedSummary(rootPath)) if (!known.has(added.path)) files.push(added)
    }
    return {
      files,
      additions: files.reduce((sum, file) => sum + file.additions, 0),
      deletions: files.reduce((sum, file) => sum + file.deletions, 0),
      base, mergeBase: from, includeUncommitted, compiledAt: Date.now()
    }
  }

  /**
   * A chosen pair of sides. Side B is a ref when `head` is set (its committed state; the work tree is
   * ignored), else the work tree of `rootPath`. Unlike the default comparison, a ref that does not resolve
   * is an error: falling back to HEAD would show a comparison the user did not ask for.
   */
  private async getComparisonSummary(rootPath: string, base: string, includeUncommitted: boolean, head: string | undefined, mode: GitCompareMode): Promise<GitDiffSummary> {
    const worktreeSide = !head
    const empty = { files: [], additions: 0, deletions: 0, base, mergeBase: null as string | null, includeUncommitted: worktreeSide && includeUncommitted, head, mode, compiledAt: Date.now() }
    if (head && !(await this.resolveCommit(rootPath, head))) return { ...empty, error: `“${head}” could not be resolved.` }
    const from = await this.compareFrom(rootPath, base, head ?? 'HEAD', mode)
    if (!from) return { ...empty, error: mode === 'direct' ? `“${base}” could not be resolved.` : `“${base}” and “${head ?? 'HEAD'}” have no common ancestor, or one of them could not be resolved.` }
    const range = head ? [from, head] : [from, ...(includeUncommitted ? [] : ['HEAD'])]
    const common = ['-c', 'core.quotePath=false', 'diff', '-M', '-z']
    const [names, numbers] = await Promise.all([
      this.spawnGit([...common, '--name-status', ...range, '--'], rootPath),
      this.spawnGit([...common, '--numstat', ...range, '--'], rootPath)
    ])
    if (names.status !== 0) return { ...empty, mergeBase: from, error: names.stderr || 'Git diff is unavailable.' }
    const files = buildDiffSummaryFiles(names.stdout, numbers.stdout)
    if (worktreeSide && includeUncommitted) {
      const known = new Set(files.map(file => file.path))
      for (const added of await this.untrackedSummary(rootPath)) if (!known.has(added.path)) files.push(added)
    }
    return {
      ...empty,
      files,
      additions: files.reduce((sum, file) => sum + file.additions, 0),
      deletions: files.reduce((sum, file) => sum + file.deletions, 0),
      mergeBase: from
    }
  }

  /** Commit side A starts from: the common ancestor of A and B, or A itself in `direct` mode. */
  private async compareFrom(rootPath: string, base: string, head: string, mode: GitCompareMode): Promise<string | null> {
    if (mode === 'direct') return this.resolveCommit(rootPath, base)
    const mergeBase = await this.spawnGit(['merge-base', base, head], rootPath)
    return mergeBase.status === 0 && mergeBase.stdout.trim() ? mergeBase.stdout.trim() : null
  }

  private async resolveCommit(rootPath: string, ref: string): Promise<string | null> {
    const resolved = await this.spawnGit(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], rootPath)
    return resolved.status === 0 && resolved.stdout.trim() ? resolved.stdout.trim() : null
  }

  /** Untracked, non-ignored files as added files, with a line count when they are small text files. */
  private async untrackedSummary(rootPath: string): Promise<GitDiffSummaryFile[]> {
    const listed = await this.spawnGit(['-c', 'core.quotePath=false', 'ls-files', '--others', '--exclude-standard', '-z'], rootPath)
    if (listed.status !== 0) return []
    const paths = listed.stdout.split('\0').filter(Boolean)
    const out: GitDiffSummaryFile[] = []
    for (const path of paths.slice(0, MAX_UNTRACKED_FILES)) {
      let additions = 0
      let binary: boolean
      try {
        const absolute = resolvePath(rootPath, path)
        const stat = await fsp.stat(absolute)
        if (!stat.isFile()) continue
        if (stat.size > MAX_UNTRACKED_COUNT_BYTES) binary = true
        else {
          const content = await fsp.readFile(absolute)
          binary = content.subarray(0, 8000).includes(0)
          if (!binary && content.length > 0) {
            for (const byte of content) if (byte === 10) additions++
            if (content[content.length - 1] !== 10) additions++
          }
        }
      } catch { continue }
      out.push({ path, status: 'A', additions, deletions: 0, binary })
    }
    return out
  }

  /** Base-side content for one file (`git show <mergeBase>:<path>`). */
  async getFileOriginal(rootPath: string, base: string, path: string, oldPath?: string, head?: string, mode: GitCompareMode = 'merge-base'): Promise<GitFileOriginal> {
    const from = await this.compareFrom(rootPath, base, head ?? 'HEAD', mode) ?? (head || mode === 'direct' ? null : 'HEAD')
    if (!from) return { content: '', missing: true, binary: false, size: 0, truncated: false }
    return this.showFile(rootPath, from, oldPath ?? path)
  }

  /** Content of one file at a ref (`git show <ref>:<path>`), for side B when it is a ref. */
  async getFileAtRef(rootPath: string, ref: string, path: string): Promise<GitFileOriginal> {
    return this.showFile(rootPath, ref, path)
  }

  private async showFile(rootPath: string, ref: string, path: string): Promise<GitFileOriginal> {
    const shown = await this.spawnGit(['show', `${ref}:${path}`], rootPath)
    if (shown.status !== 0) return { content: '', missing: true, binary: false, size: 0, truncated: false }
    const size = Buffer.byteLength(shown.stdout)
    if (shown.stdout.slice(0, 8000).includes('\0')) return { content: '', missing: false, binary: true, size, truncated: false }
    if (size > MAX_ORIGINAL_BYTES) return { content: shown.stdout.slice(0, MAX_ORIGINAL_BYTES), missing: false, binary: false, size, truncated: true }
    return { content: shown.stdout, missing: false, binary: false, size, truncated: false }
  }

  watchDiff(rootPath: string, emit: (diff: GitDiff) => void, base: string, includeUncommitted: boolean): void {
    if (this.watchers.has(rootPath)) return

    const gitIndexPath = join(rootPath, '.git', 'index')

    const debounce = (timeout: NodeJS.Timeout | null): NodeJS.Timeout => {
      if (timeout) clearTimeout(timeout)
      return setTimeout(() => {
        this.buildDiff(rootPath, base, includeUncommitted)
          .then(emit)
          .catch(() => { /* ignore watch errors */ })
      }, 300)
    }

    let timeout: NodeJS.Timeout | null = null
    let watcher: FSWatcher

    try {
      watcher = fsWatch(gitIndexPath, () => {
        timeout = debounce(timeout)
        const entry = this.watchers.get(rootPath)
        if (entry) entry.timeout = timeout
      })
    } catch {
      return
    }

    this.watchers.set(rootPath, { watcher, timeout: null })
  }

  stopWatching(rootPath: string): void {
    const entry = this.watchers.get(rootPath)
    if (!entry) return
    if (entry.timeout) clearTimeout(entry.timeout)
    try { entry.watcher.close() } catch { /* ignore */ }
    this.watchers.delete(rootPath)
  }

  getDiff(input: GitDiffInput): Promise<GitDiff> {
    return this.buildDiff(input.rootPath, input.base, input.includeUncommitted)
  }
}
