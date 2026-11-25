import { realpath, stat } from 'node:fs/promises'
import { normalize, resolve } from 'node:path'
import { ActionRefused } from '../agent-actions/agent-actions'
import { execGit } from '../../utils/safe-git'

export interface HandoffWorktreeRefInput {
  worktree?: string
  gitRef?: string
}

export interface ResolvedHandoffTarget {
  worktreePath: string
  branch: string | null
  gitRef: string | null
  commit: string | null
  isDefault: boolean
}

interface PorcelainWorktree {
  path: string
  canonicalPath: string
  head: string | null
  branch: string | null
  detached: boolean
}

function samePath(a: string, b: string): boolean {
  const na = normalize(a)
  const nb = normalize(b)
  return process.platform === 'win32' ? na.toLowerCase() === nb.toLowerCase() : na === nb
}

function parsePorcelain(stdout: string): Array<Omit<PorcelainWorktree, 'canonicalPath'>> {
  const entries: Array<Omit<PorcelainWorktree, 'canonicalPath'>> = []
  let current: Omit<PorcelainWorktree, 'canonicalPath'> | null = null
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) {
      if (current) {
        entries.push(current)
        current = null
      }
      continue
    }
    if (line.startsWith('worktree ')) {
      if (current) entries.push(current)
      current = { path: line.slice('worktree '.length).trim(), head: null, branch: null, detached: false }
    } else if (current && line.startsWith('HEAD ')) {
      current.head = line.slice('HEAD '.length).trim() || null
    } else if (current && line.startsWith('branch ')) {
      const ref = line.slice('branch '.length).trim()
      current.branch = ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref
    } else if (current && line === 'detached') {
      current.detached = true
    }
  }
  if (current) entries.push(current)
  return entries
}

async function listRepoWorktrees(repoRoot: string): Promise<PorcelainWorktree[]> {
  let stdout: string
  try {
    const res = await execGit(repoRoot, ['worktree', 'list', '--porcelain'], { timeout: 5000, maxBuffer: 256 * 1024 })
    stdout = res.stdout
  } catch {
    throw new ActionRefused(`"${repoRoot}" is not a Git repository; cannot validate worktree or gitRef.`, 'not-git')
  }
  const parsed = parsePorcelain(stdout)
  return Promise.all(parsed.map(async entry => {
    let canonicalPath: string
    try {
      canonicalPath = await realpath(entry.path)
    } catch {
      canonicalPath = resolve(entry.path)
    }
    return { ...entry, canonicalPath }
  }))
}

function normalizeRefInput(gitRef: string): string {
  const trimmed = gitRef.trim()
  if (!trimmed || trimmed.length > 200 || trimmed.startsWith('-') || /[\s\0\r\n]/.test(trimmed)) {
    throw new ActionRefused(`Invalid gitRef "${gitRef}". Provide a valid branch, tag, or commit reference.`, 'invalid')
  }
  return trimmed
}

function matchesBranch(entryBranch: string | null, gitRef: string): boolean {
  if (!entryBranch) return false
  if (entryBranch === gitRef) return true
  if (gitRef === `refs/heads/${entryBranch}`) return true
  if (gitRef === `origin/${entryBranch}` || gitRef === `refs/remotes/origin/${entryBranch}`) return true
  return false
}

/**
 * OXE-298 (CA-2): Pre-validates an optional Git worktree path and/or Git ref
 * before launching an external agent from a handoff.
 *
 * - Omitting both preserves the default worktree without extra Git calls.
 * - Specifying `worktree` verifies it exists and belongs to the repository's worktrees.
 * - Specifying `gitRef` verifies the ref resolves to a commit, and selects a registered
 *   worktree checked out on that ref when `worktree` is omitted.
 * - Nonexistent worktrees or refs fail fast with a clear `ActionRefused`.
 */
export async function resolveHandoffWorktreeRef(
  repoRoot: string,
  input: HandoffWorktreeRefInput
): Promise<ResolvedHandoffTarget> {
  const rawWorktree = input.worktree?.trim() || undefined
  const rawGitRef = input.gitRef?.trim() || undefined

  if (!rawWorktree && !rawGitRef) {
    return { worktreePath: repoRoot, branch: null, gitRef: null, commit: null, isDefault: true }
  }

  if (rawWorktree && /[\0\r\n]/.test(rawWorktree)) {
    throw new ActionRefused('Invalid worktree path.', 'invalid')
  }
  const gitRef = rawGitRef ? normalizeRefInput(rawGitRef) : null

  const worktrees = await listRepoWorktrees(repoRoot)
  let canonicalDefaultRoot: string
  try {
    canonicalDefaultRoot = await realpath(repoRoot)
  } catch {
    canonicalDefaultRoot = resolve(repoRoot)
  }

  let selected: PorcelainWorktree | null = null
  if (rawWorktree) {
    const candidate = resolve(repoRoot, rawWorktree)
    let canonicalCandidate: string
    try {
      const info = await stat(candidate)
      if (!info.isDirectory()) {
        throw new ActionRefused(`Worktree "${rawWorktree}" is not a directory.`, 'not-found')
      }
      canonicalCandidate = await realpath(candidate)
    } catch (error) {
      if (error instanceof ActionRefused) throw error
      throw new ActionRefused(`Worktree "${rawWorktree}" does not exist or is not accessible.`, 'not-found')
    }
    const matched = worktrees.find(entry => samePath(entry.canonicalPath, canonicalCandidate))
    if (!matched) {
      throw new ActionRefused(`Worktree "${rawWorktree}" is not a registered Git worktree of this repository.`, 'not-found')
    }
    selected = matched
  }

  let commit: string | null = null
  if (gitRef) {
    const verifyRoot = selected?.canonicalPath ?? canonicalDefaultRoot
    try {
      const res = await execGit(verifyRoot, ['rev-parse', '--verify', `${gitRef}^{commit}`], { timeout: 5000, maxBuffer: 4096 })
      commit = res.stdout.trim() || null
    } catch {
      throw new ActionRefused(`Git ref "${gitRef}" does not exist in this repository.`, 'not-found')
    }
    if (!selected) {
      selected =
        worktrees.find(entry => matchesBranch(entry.branch, gitRef)) ??
        worktrees.find(entry => commit !== null && entry.head === commit && !samePath(entry.canonicalPath, canonicalDefaultRoot)) ??
        worktrees.find(entry => samePath(entry.canonicalPath, canonicalDefaultRoot)) ??
        null
    }
  }

  const resolvedPath = selected?.canonicalPath ?? canonicalDefaultRoot
  const isDefault = samePath(resolvedPath, canonicalDefaultRoot)
  return {
    worktreePath: resolvedPath,
    branch: selected?.branch ?? null,
    gitRef,
    commit: commit ?? selected?.head ?? null,
    isDefault
  }
}
