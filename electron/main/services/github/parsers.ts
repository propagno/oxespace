/**
 * Pure parsing and formatting helpers shared by the GitHub collaborators.
 *
 * These were module-scope functions inside github.service.ts. They hold no
 * state and touch no process, so they stay a plain module rather than becoming
 * anyone's method — every collaborator imports what it needs.
 */
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type {
  GitHubCheckpoint,
  GitHubConnectedRepository,
  GitHubFileChange,
  GitHubMessageResult,
  GitHubRepositorySummary,
  GitHubWorkflowJob,
  GitHubWorktree
} from '../../../../shared/types/github'
import type { CheckpointRow, ConnectedRepositoryRow } from './rows'

export function countStatusLines(lines: string[]): { staged: number; modified: number; untracked: number } {
  let staged = 0
  let modified = 0
  let untracked = 0
  for (const line of lines) {
    if (line.startsWith('??')) {
      untracked++
      continue
    }
    if (line[0] && line[0] !== ' ') staged++
    if (line[1] && line[1] !== ' ') modified++
  }
  return { staged, modified, untracked }
}

export function parseStatusLine(line: string): GitHubFileChange | null {
  if (line.length < 4) return null
  const indexStatus = line[0] ?? ' '
  const workTreeStatus = line[1] ?? ' '
  const rawPath = line.slice(3).trim()
  if (!rawPath) return null
  const renameSeparator = rawPath.lastIndexOf(' -> ')
  const path = unquoteGitPath(renameSeparator >= 0 ? rawPath.slice(renameSeparator + 4) : rawPath)
  const untracked = indexStatus === '?' && workTreeStatus === '?'
  return {
    path,
    indexStatus,
    workTreeStatus,
    staged: !untracked && indexStatus !== ' ',
    unstaged: untracked || workTreeStatus !== ' ',
    untracked,
    renamed: indexStatus === 'R' || workTreeStatus === 'R',
    deleted: indexStatus === 'D' || workTreeStatus === 'D'
  }
}

export function unquoteGitPath(path: string): string {
  if (!(path.startsWith('"') && path.endsWith('"'))) return path
  try {
    return JSON.parse(path) as string
  } catch {
    return path.slice(1, -1)
  }
}

export function emptyRepositorySummary(): GitHubRepositorySummary {
  return {
    owner: null,
    name: null,
    fullName: null,
    url: null,
    isPrivate: null,
    defaultBranch: null,
    remoteName: null,
    remoteUrl: null,
    detected: false
  }
}

export function parseGitHubRemote(remoteUrl: string): { owner: string; name: string } | null {
  const ssh = /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/.exec(remoteUrl)
  if (ssh) return { owner: ssh[1], name: ssh[2].replace(/\.git$/, '') }
  const https = /^https:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/.exec(remoteUrl)
  if (https) return { owner: https[1], name: https[2].replace(/\.git$/, '') }
  return null
}

export function splitPair(raw: string, separator: string | RegExp = '|'): [string | null, string | null] {
  const parts = raw.trim().split(separator).map((item) => item.trim()).filter(Boolean)
  return [parts[0] ?? null, parts[1] ?? null]
}

export function parseJsonArray<T>(raw: string): T[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed as T[] : []
  } catch {
    return []
  }
}

export function mapCheckpoint(row: CheckpointRow): GitHubCheckpoint {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    description: row.description,
    branch: row.branch,
    baseCommit: row.base_commit,
    patch: row.patch,
    untrackedFiles: parseJsonArray<string>(row.untracked_files),
    createdAt: row.created_at
  }
}

export function mapConnectedRepository(row: ConnectedRepositoryRow): GitHubConnectedRepository {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    fullName: row.full_name,
    url: row.url,
    createdAt: row.created_at
  }
}

export function ok(message: string): GitHubMessageResult {
  return { ok: true, message }
}

export function inferCommitType(files: string[], status: string): string {
  if (files.some((file) => /(^|\/)(readme|docs?|\.md$)/i.test(file))) return 'docs'
  if (files.some((file) => /(\.test\.|\.spec\.|__tests__|tests?\/)/i.test(file))) return 'test'
  if (files.some((file) => /(package-lock|pnpm-lock|yarn\.lock|tsconfig|vite\.config|electron-builder|\.github\/)/i.test(file))) return 'chore'
  if (/^D\s/m.test(status) && !/^A\s/m.test(status)) return 'fix'
  return 'feat'
}

export function inferCommitArea(files: string[]): string {
  const first = files[0] ?? ''
  if (first.startsWith('src/components/')) return 'ui'
  if (first.startsWith('electron/')) return 'electron'
  if (first.startsWith('shared/')) return 'types'
  if (first.startsWith('src/store/')) return 'store'
  if (first.startsWith('src/styles/')) return 'styles'
  const top = first.split(/[\\/]/)[0]
  return top && top.includes('.') === false ? top.replace(/[^a-z0-9-]/gi, '-').toLowerCase() : ''
}

export function summarizeCommitFiles(files: string[], status: string): string {
  const unique = Array.from(new Set(files))
  const changed = unique.length
  const added = (status.match(/^A\s/gm) ?? []).length
  const deleted = (status.match(/^D\s/gm) ?? []).length
  if (changed === 1) return `update ${unique[0]}`
  if (added > 0 && deleted === 0) return `add ${changed} files`
  if (deleted > 0 && added === 0) return `remove ${changed} files`
  return `update ${changed} files`
}

export function normalizeCommitBody(body: string | undefined, subject: string | undefined): string | null {
  const normalized = (body ?? '').trim()
  const cleanSubject = (subject ?? '').trim()
  if (!normalized || normalized === cleanSubject) return null
  return normalized.startsWith(cleanSubject) ? normalized.slice(cleanSubject.length).trim() || null : normalized
}

export function getGhCandidates(): string[] {
  const candidates = [
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Programs', 'GitHub CLI', 'gh.exe') : '',
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'GitHub CLI', 'gh.exe') : '',
    process.env.ProgramFiles ? join(process.env.ProgramFiles, 'GitHub CLI', 'gh.exe') : '',
    process.env['ProgramFiles(x86)'] ? join(process.env['ProgramFiles(x86)']!, 'GitHub CLI', 'gh.exe') : '',
    process.env.USERPROFILE ? join(process.env.USERPROFILE, 'AppData', 'Local', 'GitHub CLI', 'gh.exe') : '',
    process.env.APPDATA ? join(process.env.APPDATA, 'npm', 'gh.cmd') : ''
  ]
  return candidates.filter(Boolean)
}

export function isCommandScript(command: string): boolean {
  return /\.(cmd|bat)$/i.test(command)
}

export function sanitizeError(message: string): string {
  return message.replace(/\s+/g, ' ').trim() || 'Falha ao executar comando.'
}

export function readLogin(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null
  const login = (value as Record<string, unknown>).login
  return typeof login === 'string' ? login : null
}

export function readName(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null
  const name = (value as Record<string, unknown>).name
  return typeof name === 'string' ? name : null
}

export function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function toStringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function toNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number.parseInt(String(value), 10) || 0
}

export function toNullableNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const parsed = Number.parseInt(String(value), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

export function parseWorkflowJobs(value: unknown): GitHubWorkflowJob[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    const row = typeof item === 'object' && item !== null ? item as Record<string, unknown> : {}
    return {
      databaseId: toNullableNumber(row.databaseId),
      name: toStringValue(row.name),
      status: toStringValue(row.status),
      conclusion: nullableString(row.conclusion),
      startedAt: nullableString(row.startedAt),
      completedAt: nullableString(row.completedAt),
      steps: parseWorkflowSteps(row.steps)
    }
  })
}

export function parseWorkflowSteps(value: unknown): GitHubWorkflowJob['steps'] {
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    const row = typeof item === 'object' && item !== null ? item as Record<string, unknown> : {}
    return {
      number: toNullableNumber(row.number),
      name: toStringValue(row.name),
      status: toStringValue(row.status),
      conclusion: nullableString(row.conclusion),
      startedAt: nullableString(row.startedAt),
      completedAt: nullableString(row.completedAt)
    }
  })
}

export function isAbsolutePath(p: string): boolean {
  // Windows: `C:\` or `\\server`; POSIX: `/something`
  return /^([A-Za-z]:[\\/]|\\\\|\/)/.test(p)
}

/**
 * Parses `git worktree list --porcelain` output into structured records.
 * The format is documented at https://git-scm.com/docs/git-worktree#_porcelain_format
 * — empty lines delimit records; the main worktree comes first.
 *
 * Example:
 *   worktree /Users/me/proj
 *   HEAD 1a2b3c4d
 *   branch refs/heads/main
 *
 *   worktree /Users/me/proj-feature
 *   HEAD 5e6f7a8b
 *   branch refs/heads/feature
 *   locked
 */
export function parseWorktreePorcelain(raw: string, mainRootPath: string): GitHubWorktree[] {
  const records = raw.split(/\r?\n\r?\n/).map((block) => block.trim()).filter(Boolean)
  const worktrees: GitHubWorktree[] = []
  // Cross-platform path equality: collapse all separators to `/`, strip
  // trailing slash, lowercase. Without the backslash-to-slash step,
  // workspace.rootPath stored as `C:\Users\repo` would never match git's
  // porcelain output `C:/Users/repo`, leaving every worktree as isMain=false.
  // That bug surfaced as the trash icon appearing next to the main worktree
  // and the sidebar badge counting the main as a non-main worktree.
  const normalizePath = (p: string): string =>
    p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  const normalizedMain = normalizePath(mainRootPath)

  for (const block of records) {
    let path = ''
    let head: string | null = null
    let branch: string | null = null
    let locked = false
    let prunable = false
    let detached = false

    for (const line of block.split(/\r?\n/)) {
      const [key, ...rest] = line.split(' ')
      const value = rest.join(' ')
      switch (key) {
        case 'worktree': path = value; break
        case 'HEAD': head = value; break
        case 'branch': branch = value.replace(/^refs\/heads\//, ''); break
        case 'locked': locked = true; break
        case 'prunable': prunable = true; break
        case 'detached': detached = true; break
      }
    }

    if (!path) continue
    const normalized = normalizePath(path)
    worktrees.push({
      path,
      branch: detached ? null : branch,
      head,
      isMain: normalized === normalizedMain,
      locked,
      prunable
    })
  }

  // Safety net: if the comparison above missed (workspace.rootPath may be a
  // subdirectory of a parent .git, or the user passed a normalized form
  // git can't echo back), fall back to porcelain's documented contract —
  // "the main worktree comes first" — so we never present a state where
  // every worktree is non-main and the user can accidentally try to remove
  // their primary checkout.
  if (worktrees.length > 0 && !worktrees.some((wt) => wt.isMain)) {
    worktrees[0].isMain = true
  }

  return worktrees
}

/**
 * Parses `git status --porcelain=v2 --branch` into the counts the worktree
 * panel needs. v2 rather than v1 because only v2 carries the `# branch.ab`
 * header, which is how we know whether the work in a worktree has been pushed
 * anywhere — the difference between "removing this loses an afternoon" and
 * "removing this loses nothing".
 *
 *   # branch.oid 1a2b3c4d
 *   # branch.head hotfix/1284
 *   # branch.upstream origin/hotfix/1284
 *   # branch.ab +2 -0
 *   1 .M N... 100644 100644 100644 <h> <h> src/app.ts
 *   2 R. N... 100644 100644 100644 <h> <h> R100 new.ts<TAB>old.ts
 *   u UU N... ...
 *   ? notes.md
 *
 * Untracked *directories* collapse to one `?` entry under git's default
 * `--untracked-files=normal`, so `untrackedCount` is a floor, not a file count.
 * That is the right trade for a confirmation prompt: it never understates
 * whether untracked work exists, and it costs one cheap git call.
 */
export function parseWorktreeStatusPorcelainV2(raw: string): {
  dirtyCount: number
  untrackedCount: number
  ahead: number
  behind: number
  noUpstream: boolean
} {
  let dirtyCount = 0
  let untrackedCount = 0
  let ahead = 0
  let behind = 0
  let hasUpstream = false

  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith('# branch.upstream ')) {
      hasUpstream = true
      continue
    }
    if (line.startsWith('# branch.ab ')) {
      // "+2 -1" — git always emits both, but tolerate either being absent.
      const match = line.match(/\+(\d+)\s+-(\d+)/)
      if (match) {
        ahead = Number(match[1])
        behind = Number(match[2])
      }
      continue
    }
    // Changed (1), renamed/copied (2) and unmerged (u) entries all represent
    // tracked work that `git worktree remove` refuses to discard without --force.
    if (line.startsWith('1 ') || line.startsWith('2 ') || line.startsWith('u ')) dirtyCount += 1
    else if (line.startsWith('? ')) untrackedCount += 1
  }

  return { dirtyCount, untrackedCount, ahead, behind, noUpstream: !hasUpstream }
}

/**
 * Strips ANSI escape sequences from gh CLI output so the renderer can display
 * logs as plain text. Covers the most common SGR (color) + control sequences;
 * good enough for `gh run view --log`, which uses standard escapes.
 */
export function stripAnsi(text: string): string {
  // CSI (Control Sequence Introducer) — `\x1b[ ... letter` (most colors/cursors)
  // OSC (Operating System Command) — `\x1b] ... BEL` or `\x1b] ... ST`
  // Other Fe escapes (single-byte after ESC)
  return text
    .replace(/\x1B\[[\x3C-\x3F]*[\d;]*[\x20-\x2F]*[\x40-\x7E]/g, '')
    .replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g, '')
    .replace(/\x1B[@-_]/g, '')
}
