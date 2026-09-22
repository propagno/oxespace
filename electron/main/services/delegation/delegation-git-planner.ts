import { basename, dirname, join, resolve } from 'node:path'
import type { DelegationBranchIntent, DelegationCheckout } from '../../../../shared/types/delegation'
import type { GitHubWorktreeApi } from '../../../../shared/types/github'
import { checkoutDirectoryName, renderDelegationBranch } from './delegation-branch'

export interface DelegationGitPlanInput {
  rootPath: string
  objective: string
  taskId: string
  branchIntent?: DelegationBranchIntent
}

export class DelegationGitPlanner {
  constructor(
    private readonly gitApi: GitHubWorktreeApi,
    private readonly git: (cwd: string, args: string[]) => Promise<string>
  ) {}

  async plan(input: DelegationGitPlanInput): Promise<DelegationCheckout> {
    const rendered = renderDelegationBranch(input.branchIntent, {
      objective: input.objective,
      taskId: input.taskId
    })
    await this.git(input.rootPath, ['check-ref-format', '--branch', rendered.branch])

    const worktrees = await (
      typeof this.gitApi.listWorktrees === 'function'
        ? this.gitApi.listWorktrees({ workspaceId: 'delegation-preflight', rootPath: input.rootPath })
        : this.fallbackWorktrees(input.rootPath))
    const main = worktrees.find(worktree => worktree.isMain)?.path ?? worktrees[0]?.path ?? input.rootPath
    const occupied = worktrees.find(worktree => worktree.branch === rendered.branch)
    const reuse = Boolean(rendered.intent.reuseExistingWorktree && occupied)
    if (occupied && !reuse) throw new Error(`BRANCH_ALREADY_CHECKED_OUT: ${rendered.branch} at ${occupied.path}`)
    if (reuse && occupied) {
      const canonical = (path: string) => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path)
      if (occupied.isMain || canonical(occupied.path) === canonical(input.rootPath)) throw new Error('DESTINATION_MUST_BE_ISOLATED: choose a worktree separate from the origin and main checkout')
      if (occupied.locked || occupied.prunable) throw new Error('WORKTREE_UNAVAILABLE')
      if (await this.git(occupied.path, ['status', '--porcelain'])) throw new Error('WORKTREE_HAS_LOCAL_CHANGES: inspect the destination before reusing it')
    }

    const remoteName = rendered.intent.remote?.trim() || 'origin'
    const local = await this.refExists(input.rootPath, `refs/heads/${rendered.branch}`)
    const remoteRef = await this.refExists(input.rootPath, `refs/remotes/${remoteName}/${rendered.branch}`) ? `${remoteName}/${rendered.branch}` : undefined
    let createBranch = rendered.intent.strategy !== 'existing'
    let baseRef = rendered.intent.baseRef?.trim() || ''

    if (rendered.intent.strategy === 'existing') {
      if (!local && !remoteRef) throw new Error(`BRANCH_NOT_FOUND: ${rendered.branch}`)
      createBranch = !local
      baseRef = local ? rendered.branch : remoteRef!
    } else {
      if (local || remoteRef) throw new Error(`BRANCH_ALREADY_EXISTS: ${rendered.branch}`)
      if (!baseRef) baseRef = typeof this.gitApi.resolveWorktreeBase === 'function'
        ? (await this.gitApi.resolveWorktreeBase({ workspaceId: 'delegation-preflight', rootPath: input.rootPath })).baseRef
        : await this.fallbackBase(input.rootPath)
    }

    const baseSha = await this.git(input.rootPath, ['rev-parse', '--verify', `${baseRef}^{commit}`])
    const path = reuse
      ? resolve(occupied!.path)
      : join(dirname(main), `${basename(main)}-worktrees`, checkoutDirectoryName(rendered.branch, input.taskId))

    return {
      strategy: rendered.intent.strategy,
      requestedBranch: rendered.intent.name,
      branch: rendered.branch,
      baseRef,
      baseSha,
      remoteRef,
      path,
      createBranch,
      reuseExistingWorktree: reuse,
      fetchBase: Boolean(rendered.intent.fetchBase),
      resolvedAt: Date.now()
    }
  }

  private async fallbackWorktrees(rootPath: string) {
    const raw = await this.git(rootPath, ['worktree', 'list', '--porcelain'])
    const blocks = raw.split(/\n\s*\n/).filter(Boolean)
    return blocks.map((block, index) => {
      const lines = block.split('\n')
      const path = lines.find(line => line.startsWith('worktree '))?.slice(9) ?? rootPath
      const branch = lines.find(line => line.startsWith('branch refs/heads/'))?.slice('branch refs/heads/'.length) ?? null
      return { path, branch, head: lines.find(line => line.startsWith('HEAD '))?.slice(5) ?? null,
        isMain: index === 0, locked: lines.some(line => line.startsWith('locked')), prunable: lines.some(line => line.startsWith('prunable')) }
    })
  }

  private async fallbackBase(rootPath: string): Promise<string> {
    const remoteHead = await this.git(rootPath, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']).catch(() => '')
    if (remoteHead) return remoteHead
    for (const ref of ['origin/main', 'origin/master', 'origin/develop', 'main', 'master']) {
      const exists = await this.git(rootPath, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).catch(() => '')
      if (exists) return ref
    }
    return 'HEAD'
  }

  private async refExists(rootPath: string, ref: string): Promise<boolean> {
    return Boolean(await this.git(rootPath, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).catch(() => ''))
  }
}
