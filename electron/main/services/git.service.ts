import { existsSync, watch as fsWatch, type FSWatcher } from 'node:fs'
import { spawn, type SpawnOptions } from 'node:child_process'
import { join } from 'node:path'
import type { GitBranchStatus, GitDiff, GitDiffFile, GitDiffInput } from '../../../shared/types/git'

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
const RESOLVE_TIMEOUT_MS = 5_000
// Cache strategy: cache POSITIVE resolutions forever (git path doesn't move
// at runtime). Negative results (git not found) cache only for the duration
// of the in-flight resolve and are NOT persisted — the user may install git
// while the app is running and we want the next call to retry. Previously
// `cachedGitCommand = null` was persisted, leaving the entire UI permanently
// reporting "branch unavailable" even after git became available.
let cachedGitCommand: string | undefined
let gitResolveInFlight: Promise<string | null> | null = null

function spawnCommandAsync(command: string, args: string[], cwd: string, timeoutMs: number): Promise<SpawnGitResult> {
  return new Promise((resolve) => {
    const opts: SpawnOptions = { cwd, shell: false, windowsHide: true }
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
    child.stdout?.on('data', (chunk: string) => { stdout += chunk })
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
    const direct = await spawnCommandAsync('git', ['--version'], cwd, RESOLVE_TIMEOUT_MS)
    if (direct.status === 0) return 'git'

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
  return spawnCommandAsync(git, args, cwd, SPAWN_TIMEOUT_MS)
}

function parseDiffOutput(raw: string): GitDiffFile[] {
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

export class GitService {
  private readonly spawnGit: SpawnGitFn
  private readonly watchers = new Map<string, WatchEntry>()

  constructor(options?: { spawnGit?: SpawnGitFn }) {
    this.spawnGit = options?.spawnGit ?? spawnGitAsync
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

  async buildDiff(rootPath: string, base: string, includeUncommitted: boolean): Promise<GitDiff> {
    // Run the two diff spawns in parallel — they're independent and the
    // committed one in particular can be slow on big histories.
    const [committedRaw, uncommittedRaw] = await Promise.all([
      this.spawnGit(['diff', `${base}...HEAD`, '--unified=3', '--', '.'], rootPath),
      includeUncommitted
        ? this.spawnGit(['diff', 'HEAD', '--unified=3', '--', '.'], rootPath)
        : Promise.resolve<SpawnGitResult>({ stdout: '', stderr: '', status: 0 })
    ])

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
