/**
 * Worktree cleanup scan and batch removal.
 *
 * The scan is advisory; removal re-scans right before acting and refuses
 * anything that gained a blocker since the user looked, so a stale list can
 * never delete work that appeared in the meantime.
 */
import { open, readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  CONSENT_CLEANUP_BLOCKERS,
  HARD_CLEANUP_BLOCKERS,
  WORKTREE_IDLE_CLEANUP_MS,
  type WorktreeCleanupBlocker,
  type WorktreeCleanupCandidate,
  type WorktreeCleanupContext,
  type WorktreeCleanupReason,
  type WorktreeCleanupRemoveInput,
  type WorktreeCleanupRemoveResult,
  type WorktreeCleanupScanInput
} from '../../../../shared/types/worktree-cleanup'
import type { GitHubWorktree } from '../../../../shared/types/github'
import { loadRepoConfig } from '../repo-config/loader'
import { findSharedLinks } from '../repo-config/shared-dirs'
import type { GhExec } from './gh-exec'
import { parseWorktreePorcelain, parseWorktreeStatusPorcelainV2 } from './parsers'

const norm = (p: string): string => resolve(p).replace(/[\\/]+$/, '').toLowerCase()
const within = (child: string, parent: string): boolean => {
  const c = norm(child)
  const p = norm(parent)
  return c === p || c.startsWith(p + '\\') || c.startsWith(p + '/')
}

async function mtime(path: string): Promise<number | null> {
  try {
    return (await stat(path)).mtimeMs
  } catch {
    return null
  }
}

/** Timestamp of the newest reflog entry, from an 8 KB tail of `logs/HEAD`. */
async function newestReflogAt(gitDir: string): Promise<number | null> {
  try {
    const handle = await open(join(gitDir, 'logs', 'HEAD'), 'r')
    try {
      const { size } = await handle.stat()
      const length = Math.min(size, 8192)
      const buffer = Buffer.alloc(length)
      await handle.read(buffer, 0, length, size - length)
      const lines = buffer.toString('utf8').split('\n').filter(Boolean)
      const last = lines[lines.length - 1]
      const match = last?.match(/>\s+(\d{9,})\s+[+-]\d{4}\t/)
      return match ? Number(match[1]) * 1000 : null
    } finally {
      await handle.close()
    }
  } catch {
    return null
  }
}

/** A linked worktree's `.git` is a file pointing at its private git dir. */
async function resolveGitDir(worktreePath: string): Promise<string | null> {
  try {
    const text = await readFile(join(worktreePath, '.git'), 'utf8')
    const match = text.match(/^gitdir:\s*(.+)$/m)
    return match ? resolve(worktreePath, match[1].trim()) : null
  } catch {
    return null
  }
}

/**
 * Activity = newest of the folder, HEAD, COMMIT_EDITMSG, ORIG_HEAD and the
 * reflog. The index and logs/HEAD *mtime* are deliberately excluded: `git
 * status` and `git gc` touch them, which would make every worktree look busy.
 */
export async function lastWorktreeActivity(worktreePath: string): Promise<number | null> {
  const gitDir = await resolveGitDir(worktreePath)
  const signals = await Promise.all([
    mtime(worktreePath),
    ...(gitDir ? [mtime(join(gitDir, 'HEAD')), mtime(join(gitDir, 'COMMIT_EDITMSG')), mtime(join(gitDir, 'ORIG_HEAD')), newestReflogAt(gitDir)] : [])
  ])
  const known = signals.filter((s): s is number => s !== null)
  return known.length ? Math.max(...known) : null
}

export interface WorktreeCleanupDeps {
  gh: GhExec
  removeWorktree(input: { rootPath: string; path: string; force: boolean }): Promise<{ ok: boolean; message: string }>
}

export class WorktreeCleanup {
  constructor(private readonly deps: WorktreeCleanupDeps) {}

  private async list(rootPath: string): Promise<GitHubWorktree[]> {
    const raw = await this.deps.gh.tryGit(['worktree', 'list', '--porcelain'], rootPath)
    const trees = parseWorktreePorcelain(raw, rootPath)
    if (trees[0]) trees[0] = { ...trees[0], isMain: true }
    return trees
  }

  async scan(input: WorktreeCleanupScanInput): Promise<WorktreeCleanupCandidate[]> {
    const now = input.now ?? Date.now()
    const trees = await this.list(input.rootPath)
    const primary = trees[0]
    const config = primary ? await loadRepoConfig(primary.path) : null
    const sharedDirs = config?.worktree.sharedDirectories ?? []
    const candidates = trees.filter((t) => !t.isMain)

    // Three at a time: each candidate spawns several git processes.
    const results: WorktreeCleanupCandidate[] = []
    for (let i = 0; i < candidates.length; i += 3) {
      const batch = candidates.slice(i, i + 3)
      results.push(...(await Promise.all(batch.map((t) => this.inspect(t, primary?.head ?? null, sharedDirs, input.context, now)))))
    }
    return results
  }

  private async inspect(
    tree: GitHubWorktree,
    primaryHead: string | null,
    sharedDirs: string[],
    context: WorktreeCleanupContext | undefined,
    now: number
  ): Promise<WorktreeCleanupCandidate> {
    const blockers = new Set<WorktreeCleanupBlocker>()
    const reasons: WorktreeCleanupReason[] = []
    let dirtyCount = 0
    let ahead = 0

    if (tree.locked) blockers.add('locked')
    if (context?.activePaths.some((p) => within(p, tree.path))) blockers.add('active-workspace')
    if (context?.runningTerminalPaths.some((p) => within(p, tree.path))) blockers.add('running-terminal')
    if (context?.liveAgentPaths.some((p) => within(p, tree.path))) blockers.add('live-agent')

    if (tree.prunable) {
      reasons.push('missing-directory')
      return { path: tree.path, branch: tree.branch, head: tree.head, lastActivityAt: null, dirtyCount, ahead, reasons, blockers: [...blockers], selectedByDefault: blockers.size === 0 }
    }

    const links = await findSharedLinks(tree.path, sharedDirs)
    const status = await this.deps.gh.spawn('git', ['status', '--porcelain=v2', '--branch', '--untracked-files=all'], tree.path, undefined, 8000)
    if (status.status !== 0 || status.error) {
      blockers.add('git-status-error')
    } else {
      const parsed = parseWorktreeStatusPorcelainV2(status.stdout ?? '')
      ahead = parsed.ahead
      // Our own shared links show up as untracked entries; they are not work.
      const ownLinks = links.length
      dirtyCount = Math.max(0, parsed.dirtyCount + parsed.untrackedCount - ownLinks)
      if (dirtyCount > 0) blockers.add('dirty-files')
      if (ahead > 0) {
        blockers.add('unpushed-commits')
      } else if (parsed.noUpstream && dirtyCount === 0) {
        // Commits reachable from no remote and from no *other* local branch are
        // the ones that would be lost. Excluding the worktree's own branch
        // matters: otherwise its own ref always "protects" its commits, and a
        // repo without remotes would flag every fresh worktree.
        const exclude = tree.branch ? [`--exclude=${tree.branch}`] : []
        const count = await this.deps.gh.spawn(
          'git',
          ['rev-list', '--count', 'HEAD', '--not', '--remotes', ...exclude, '--branches'],
          tree.path,
          undefined,
          8000
        )
        const n = Number((count.stdout ?? '').trim())
        if (count.status !== 0 || !Number.isFinite(n)) blockers.add('unknown-base')
        else if (n > 0) blockers.add('unpushed-commits')
      }
    }

    const lastActivityAt = await lastWorktreeActivity(tree.path)
    if (lastActivityAt !== null && now - lastActivityAt >= WORKTREE_IDLE_CLEANUP_MS) reasons.push('idle-clean')

    if (primaryHead && tree.head && tree.head !== primaryHead) {
      const merged = await this.deps.gh.spawn('git', ['merge-base', '--is-ancestor', tree.head, primaryHead], tree.path, undefined, 8000)
      if (merged.status === 0) reasons.push('merged')
    } else if (primaryHead && tree.head === primaryHead) {
      reasons.push('merged')
    }

    const list = [...blockers]
    return {
      path: tree.path,
      branch: tree.branch,
      head: tree.head,
      lastActivityAt,
      dirtyCount,
      ahead,
      reasons,
      blockers: list,
      selectedByDefault: reasons.length > 0 && list.length === 0
    }
  }

  /**
   * Removes the requested worktrees, deepest path first. Each one is re-scanned
   * immediately beforehand: hard blockers always refuse, and a consent blocker
   * refuses unless the caller passed `force` for that path.
   */
  async remove(input: WorktreeCleanupRemoveInput): Promise<WorktreeCleanupRemoveResult[]> {
    const fresh = await this.scan({ rootPath: input.rootPath, context: input.context })
    const byPath = new Map(fresh.map((c) => [norm(c.path), c]))
    const ordered = [...input.targets].sort((a, b) => norm(b.path).length - norm(a.path).length)
    const results: WorktreeCleanupRemoveResult[] = []

    for (const target of ordered) {
      const candidate = byPath.get(norm(target.path))
      if (!candidate) {
        results.push({ path: target.path, ok: false, message: 'This is not a removable worktree of this repository.' })
        continue
      }
      const hard = candidate.blockers.find((b) => HARD_CLEANUP_BLOCKERS.includes(b))
      if (hard) {
        results.push({ path: target.path, ok: false, message: `Bloqueado: ${hard}.` })
        continue
      }
      const consent = candidate.blockers.filter((b) => CONSENT_CLEANUP_BLOCKERS.includes(b))
      if (consent.length > 0 && !target.force) {
        results.push({ path: target.path, ok: false, message: `Needs confirmation: ${consent.join(', ')}.` })
        continue
      }
      try {
        // Only dirty files need git's --force; unpushed commits keep their branch.
        const result = await this.deps.removeWorktree({
          rootPath: input.rootPath,
          path: candidate.path,
          force: target.force && candidate.blockers.includes('dirty-files')
        })
        results.push({ path: target.path, ok: result.ok, message: result.message })
      } catch (error) {
        results.push({ path: target.path, ok: false, message: error instanceof Error ? error.message : String(error) })
      }
    }
    return results
  }
}
