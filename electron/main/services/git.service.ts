import { watch as fsWatch, type FSWatcher } from 'node:fs'
import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { join } from 'node:path'
import type { GitDiff, GitDiffFile, GitDiffInput } from '../../../shared/types/git'

type SpawnGitFn = (args: string[], cwd: string) => SpawnSyncReturns<string>

interface WatchEntry {
  watcher: FSWatcher
  timeout: NodeJS.Timeout | null
}

function parseDiffOutput(raw: string): GitDiffFile[] {
  const files: GitDiffFile[] = []
  if (!raw) return files

  let current: GitDiffFile | null = null
  let oldLineNo = 0
  let newLineNo = 0

  for (const line of raw.split('\n')) {
    if (line.startsWith('diff --git ')) {
      if (current) files.push(current)
      const match = /^diff --git a\/.+ b\/(.+)$/.exec(line)
      current = { path: match?.[1] ?? '', additions: 0, deletions: 0, hunks: [], mtime: null }
      oldLineNo = 0
      newLineNo = 0
      continue
    }

    if (!current) continue

    if (line.startsWith('@@ ')) {
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
      oldLineNo = m ? parseInt(m[1], 10) : 0
      newLineNo = m ? parseInt(m[2], 10) : 0
      current.hunks.push({ header: line, lines: [] })
      continue
    }

    const hunk = current.hunks[current.hunks.length - 1]
    if (!hunk) continue

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

export class GitService {
  private readonly spawnGit: SpawnGitFn
  private readonly watchers = new Map<string, WatchEntry>()

  constructor(options?: { spawnGit?: SpawnGitFn }) {
    this.spawnGit = options?.spawnGit ?? ((args, cwd) =>
      spawnSync('git', args, {
        cwd,
        encoding: 'utf8',
        shell: true,
        timeout: 5000,
        windowsHide: true
      }))
  }

  buildDiff(rootPath: string, base: string, includeUncommitted: boolean): GitDiff {
    const committedRaw = this.spawnGit(['diff', `${base}...HEAD`, '--unified=3', '--', '.'], rootPath)
    const committedFiles = parseDiffOutput(committedRaw.stdout ?? '')

    let files = committedFiles
    if (includeUncommitted) {
      const uncommittedRaw = this.spawnGit(['diff', 'HEAD', '--unified=3', '--', '.'], rootPath)
      const uncommittedFiles = parseDiffOutput(uncommittedRaw.stdout ?? '')
      files = mergeFiles(committedFiles, uncommittedFiles)
    }

    for (const file of files) {
      const mtimeRaw = this.spawnGit(['log', '--format=%ct', '-1', '--', file.path], rootPath)
      const mtimeStr = mtimeRaw.stdout?.trim()
      file.mtime = mtimeStr ? parseInt(mtimeStr, 10) : null
    }

    return { files, base, includeUncommitted, compiledAt: Date.now() }
  }

  watchDiff(rootPath: string, emit: (diff: GitDiff) => void, base: string, includeUncommitted: boolean): void {
    if (this.watchers.has(rootPath)) return

    const gitIndexPath = join(rootPath, '.git', 'index')

    const debounce = (timeout: NodeJS.Timeout | null): NodeJS.Timeout => {
      if (timeout) clearTimeout(timeout)
      return setTimeout(() => {
        try {
          emit(this.buildDiff(rootPath, base, includeUncommitted))
        } catch { /* ignore watch errors */ }
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

  getDiff(input: GitDiffInput): GitDiff {
    return this.buildDiff(input.rootPath, input.base, input.includeUncommitted)
  }
}
