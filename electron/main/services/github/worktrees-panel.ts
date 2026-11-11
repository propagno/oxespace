/**
 * The Worktrees panel (1.5.0 A63 / N9, CCR F4 §A63, DESIGN U4.7): every non-main worktree of a repository with its
 * owning conversation, branch, merged state (A60's rule: the provider first, git as the fallback), changed files, disk
 * use and last activity, merged first then oldest first; and a guarded Remove.
 *
 * Remove refuses before anything destructive: a path that is not one of this repository's worktrees (compared as written,
 * and the main checkout also on its real path, so a link, a .. walk, a trailing separator or another case never reaches
 * it), a busy worktree (a pane inside it, or its conversation mid-turn), a locked one, uncommitted changes, and, when
 * the branch is to be deleted, the default branch, a branch checked out in another worktree, or an unmerged branch the
 * person did not confirm. It never forces the removal; the folder goes through the existing safe removal pipeline.
 * The branch delete is local only (`git branch -d|-D -- <name>`): the remote and its tracking ref stay. Every git call
 * is an argument array through GhExec (no shell). Each Remove and branch delete a person makes writes one audit row.
 */
import type { Dirent } from 'node:fs'
import { lstat, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { GitHubMessageResult, GitHubRemoveWorktreeInput } from '../../../../shared/types/github'
import type { PersonActionAudit } from '../person-action-audit'
import { loadRepoConfig } from '../repo-config/loader'
import { findSharedLinks } from '../repo-config/shared-dirs'
import type { GhExec } from './gh-exec'
import { lastWorktreeActivity } from './worktree-cleanup'
import { setWorktreeRemoveGuard } from './worktree-guard'
import { longPath } from './worktree-removal'

/** A conversation that made (or owns) a worktree, as main's thread store knows it. */
export interface WorktreeOwner {
  conversationId: string
  title: string
  worktreePath: string
  /** The branch the conversation made the worktree on. */
  branch: string
  /** The conversation was removed; it is kept by name. */
  gone: boolean
}

export interface WorktreeMerged { by: 'provider' | 'git'; value: boolean }

export interface WorktreeMergedProvider {
  merged(input: { rootPath: string; branch: string }): Promise<WorktreeMerged & { prNumber?: number }>
}

export type WorktreeBusyReason = 'pane' | 'turn'

export interface WorktreesPanelRow {
  path: string
  branch: string | null
  conversation: { id: string; title: string; gone: boolean } | null
  merged: WorktreeMerged
  prNumber: number | null
  changed: number
  diskBytes: number
  lastActivity: number | null
  branchChanged: boolean
  locked: boolean
  missing: boolean
}

export interface WorktreesPanelRefusal { code: string; params: Record<string, unknown> }

export interface WorktreesPanelRemoveInput {
  rootPath: string
  path: string
  deleteBranch: boolean
  confirmUnmerged?: boolean
  /** Who asks. A person's action is written to the person audit; an agent's is audited by its tool door. */
  via?: 'person' | 'agent'
}

export type WorktreesPanelRemoveResult = { ok: true; branchDeleted: boolean } | { ok: false; refusal: WorktreesPanelRefusal }

export interface WorktreesPanelDeps {
  gh: GhExec
  owners: () => WorktreeOwner[]
  provider: WorktreeMergedProvider
  removeWorktree: (input: GitHubRemoveWorktreeInput) => Promise<GitHubMessageResult>
  busy: (path: string) => WorktreeBusyReason | null
  audit: PersonActionAudit
}

interface Registered {
  path: string
  branch: string | null
  isMain: boolean
  locked: boolean
  lockReason: string
  prunable: boolean
}

/** The cap on the disk-use walk, as unlinkLinksWithin. */
const DISK_WALK_LIMIT = 200_000

const norm = (path: string): string => {
  const resolved = resolve(path).replace(/[\\/]+$/, '').replace(/\\/g, '/')
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

const refusal = (code: string, params: Record<string, unknown> = {}): WorktreesPanelRemoveResult => ({ ok: false, refusal: { code, params } })

function parsePorcelain(raw: string): Registered[] {
  const trees: Registered[] = []
  for (const block of raw.replace(/\r/g, '').split(/\n\n+/)) {
    const lines = block.split('\n').filter(Boolean)
    const head = lines.find(line => line.startsWith('worktree '))
    if (!head) continue
    let branch: string | null = null
    let locked = false
    let lockReason = ''
    let prunable = false
    for (const line of lines) {
      if (line.startsWith('branch ')) branch = line.slice(7).replace(/^refs\/heads\//, '')
      else if (line === 'locked' || line.startsWith('locked ')) { locked = true; lockReason = line.slice(7).trim() }
      else if (line === 'prunable' || line.startsWith('prunable ')) prunable = true
    }
    trees.push({ path: head.slice(9), branch, isMain: trees.length === 0, locked, lockReason, prunable })
  }
  return trees
}

async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true } catch { return false }
}

/** Bytes under `root`, by lstat: links and junctions are never followed, and the walk stops after 200k entries. */
export async function diskUse(root: string, limit = DISK_WALK_LIMIT): Promise<number> {
  const stack = [root]
  let seen = 0
  let bytes = 0
  while (stack.length) {
    const dir = stack.pop()!
    let entries: Dirent[]
    try { entries = await readdir(dir, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) {
      if (++seen > limit) return bytes
      const path = join(dir, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) { stack.push(path); continue }
      try {
        const info = await lstat(path)
        if (info.isFile()) bytes += info.size
      } catch { /* gone meanwhile */ }
    }
  }
  return bytes
}

let appPanel: WorktreesPanel | null = null

/** The app's panel, set once by main at boot, so the agent tool reaches the same guarded removal as the window. */
export function setAppWorktreesPanel(panel: WorktreesPanel | null): void {
  appPanel = panel
  setWorktreeRemoveGuard(panel)
}
export function appWorktreesPanel(): WorktreesPanel | null { return appPanel }

export class WorktreesPanel {
  constructor(private readonly deps: WorktreesPanelDeps) {}

  private async registered(rootPath: string): Promise<Registered[]> {
    const result = await this.deps.gh.git(['worktree', 'list', '--porcelain'], rootPath)
    if (result.status !== 0 || result.error) return []
    return parsePorcelain(result.stdout ?? '')
  }

  private async sharedLinks(path: string, primary: string): Promise<string[]> {
    try {
      const own = await loadRepoConfig(path)
      const main = await loadRepoConfig(primary)
      const dirs = [...new Set([...(main?.worktree.sharedDirectories ?? []), ...(own?.worktree.sharedDirectories ?? [])])]
      return dirs.length ? await findSharedLinks(path, dirs) : []
    } catch {
      return []
    }
  }

  /** Uncommitted changes (porcelain v2: tracked changes and untracked files), minus our own shared links; null when git cannot tell. */
  private async changed(path: string, primary: string): Promise<number | null> {
    const status = await this.deps.gh.git(['status', '--porcelain=v2', '-z', '--untracked-files=all'], path, undefined, 20_000)
    if (status.status !== 0 || status.error) return null
    const links = await this.sharedLinks(path, primary)
    const owned = (entry: string): boolean => {
      const clean = entry.replace(/\\/g, '/').replace(/\/+$/, '')
      return links.some(link => clean === link || clean.startsWith(link + '/'))
    }
    const tokens = (status.stdout ?? '').split('\0')
    let count = 0
    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index]
      if (token.startsWith('1 ') || token.startsWith('u ')) count++
      else if (token.startsWith('2 ')) { count++; index++ }
      else if (token.startsWith('? ')) { if (!owned(token.slice(2))) count++ }
    }
    return count
  }

  async list(input: { rootPath: string }): Promise<WorktreesPanelRow[]> {
    const trees = await this.registered(input.rootPath)
    const primary = trees[0]?.path ?? input.rootPath
    const owners = this.deps.owners()
    const rows = await Promise.all(trees.filter(tree => !tree.isMain).map(async (tree): Promise<WorktreesPanelRow> => {
      const missing = tree.prunable || !(await exists(tree.path))
      const owner = owners.find(entry => norm(entry.worktreePath) === norm(tree.path)) ?? null
      let merged: WorktreeMerged = { by: 'git', value: false }
      let prNumber: number | null = null
      if (tree.branch) {
        try {
          const answer = await this.deps.provider.merged({ rootPath: input.rootPath, branch: tree.branch })
          merged = { by: answer.by, value: answer.value }
          prNumber = typeof answer.prNumber === 'number' ? answer.prNumber : null
        } catch { /* unknown: not merged */ }
      }
      return {
        path: tree.path,
        branch: tree.branch,
        conversation: owner ? { id: owner.conversationId, title: owner.title, gone: owner.gone } : null,
        merged,
        prNumber,
        changed: missing ? 0 : (await this.changed(tree.path, primary)) ?? 0,
        diskBytes: missing ? 0 : await diskUse(tree.path),
        lastActivity: missing ? null : await lastWorktreeActivity(tree.path),
        branchChanged: owner !== null && owner.branch !== tree.branch,
        locked: tree.locked,
        missing
      }
    }))
    return rows.sort((a, b) => {
      if (a.merged.value !== b.merged.value) return a.merged.value ? -1 : 1
      return (a.lastActivity ?? 0) - (b.lastActivity ?? 0)
    })
  }

  private async defaultBranches(rootPath: string): Promise<Set<string>> {
    const names = new Set(['main', 'master'])
    const head = await this.deps.gh.git(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], rootPath)
    if (head.status === 0) { const name = (head.stdout ?? '').trim().replace(/^origin\//, ''); if (name) names.add(name) }
    const init = await this.deps.gh.git(['config', '--get', 'init.defaultBranch'], rootPath)
    if (init.status === 0) { const name = (init.stdout ?? '').trim(); if (name) names.add(name) }
    return names
  }

  async remove(input: WorktreesPanelRemoveInput): Promise<WorktreesPanelRemoveResult> {
    const person = input.via !== 'agent'
    const record = (action: 'worktree-remove' | 'branch-delete', target: string, outcome: 'ok' | 'refused' | 'error', code?: string): void => {
      if (person) this.deps.audit.record({ action, target, outcome, ...(code ? { code } : {}) })
    }
    const refuse = (target: string, result: WorktreesPanelRemoveResult): WorktreesPanelRemoveResult => {
      if (!result.ok) record('worktree-remove', target, result.refusal.code === 'worktree.remove.failed' ? 'error' : 'refused', result.refusal.code)
      return result
    }

    const trees = await this.registered(input.rootPath)
    const main = trees[0]
    const wanted = norm(input.path)
    const target = trees.find(tree => norm(tree.path) === wanted)
    // The main checkout on its real path: a link or junction to it, a .. walk, a trailing separator or another case.
    const mainReal = main ? norm(longPath(main.path)) : null
    const pointsAtMain = mainReal !== null && (norm(longPath(input.path)) === mainReal || wanted === norm(main!.path))
    if (!target || target.isMain || pointsAtMain) return refuse(input.path, refusal('worktree.remove.notFound'))
    // A path that only reaches the worktree through a link is not the worktree.
    if ((await exists(input.path)) && norm(longPath(input.path)) !== norm(longPath(target.path))) {
      return refuse(input.path, refusal('worktree.remove.notFound'))
    }

    const busy = this.deps.busy(target.path)
    if (busy) return refuse(target.path, refusal('worktree.remove.busy', { reason: busy }))
    if (target.locked) return refuse(target.path, refusal('worktree.remove.locked', { reason: target.lockReason }))

    const missing = target.prunable || !(await exists(target.path))
    if (!missing) {
      const count = await this.changed(target.path, main?.path ?? input.rootPath)
      if (count === null) return refuse(target.path, refusal('worktree.remove.failed'))
      if (count > 0) return refuse(target.path, refusal('worktree.remove.dirty', { count }))
    }

    const branch = input.deleteBranch ? target.branch : null
    let mergedValue = false
    if (branch) {
      if ((await this.defaultBranches(input.rootPath)).has(branch)) return refuse(target.path, refusal('worktree.remove.defaultBranch', { branch }))
      if (trees.some(tree => tree !== target && tree.branch === branch)) return refuse(target.path, refusal('worktree.remove.branchInUse', { branch }))
      try { mergedValue = (await this.deps.provider.merged({ rootPath: input.rootPath, branch })).value } catch { mergedValue = false }
      // A branch whose every commit is already in the main checkout's HEAD loses nothing when deleted, whatever the
      // provider knows. The ref is passed fully qualified, so a name can never be read as an option.
      if (!mergedValue && main) {
        const ancestor = await this.deps.gh.git(['merge-base', '--is-ancestor', `refs/heads/${branch}`, 'HEAD'], main.path)
        mergedValue = ancestor.status === 0 && !ancestor.error
      }
      if (!mergedValue && input.confirmUnmerged !== true) return refuse(target.path, refusal('worktree.remove.unmergedBranch', { branch }))
    }

    try {
      const result = await this.deps.removeWorktree({ rootPath: input.rootPath, path: target.path, force: false, deleteBranch: false })
      if (!result.ok) return refuse(target.path, refusal('worktree.remove.failed'))
    } catch {
      return refuse(target.path, refusal('worktree.remove.failed'))
    }
    record('worktree-remove', target.path, 'ok')

    if (!branch) return { ok: true, branchDeleted: false }
    // Local only: the remote branch and its tracking ref stay. Merged (the provider sees squash merges git cannot) or
    // confirmed, so -D; otherwise -d, which git refuses for an unmerged branch.
    const flag = mergedValue || input.confirmUnmerged === true ? '-D' : '-d'
    const deleted = await this.deps.gh.git(['branch', flag, '--', branch], input.rootPath)
    const okDelete = deleted.status === 0 && !deleted.error
    record('branch-delete', branch, okDelete ? 'ok' : 'error', okDelete ? undefined : 'worktree.branch.kept')
    return { ok: true, branchDeleted: okDelete }
  }
}
