import { existsSync } from 'node:fs'
import type { DelegationTask } from '../../../../shared/types/delegation'
import type { GitHubWorktreeApi } from '../../../../shared/types/github'
import { projectIdentity } from '../memory/memory-project.service'
import type { DelegationRepository } from './delegation.repository'

export class DelegationGitProvisioner {
  constructor(
    private readonly gitApi: GitHubWorktreeApi,
    private readonly repository: DelegationRepository,
    private readonly git: (cwd: string, args: string[]) => Promise<string>
  ) {}

  async apply(task: DelegationTask, assertActive: () => void = () => {}): Promise<void> {
    const checkout = task.checkout
    if (!checkout) throw new Error('Delegation checkout plan is missing')
    const generation = 1
    if (this.repository.operationSucceeded(task.id, 'git-checkout', generation)) {
      await this.verify(task)
      return
    }
    this.repository.journal(task.id, 'git-checkout', generation, 'running')
    try {
      // The plan is advisory until this point. Revalidate under the service's
      // project+branch lock immediately before any Git side effect.
      await this.git(task.cwd, ['check-ref-format', '--branch', checkout.branch])
      if (typeof this.gitApi.listWorktrees === 'function') {
        const currentWorktrees = await this.gitApi.listWorktrees({ workspaceId: task.workspaceId, rootPath: task.cwd })
        const occupied = currentWorktrees.find(worktree => worktree.branch === checkout.branch)
        if (occupied && !checkout.reuseExistingWorktree && occupied.path !== checkout.path) {
          throw new Error(`BRANCH_ALREADY_CHECKED_OUT: ${checkout.branch} at ${occupied.path}`)
        }
      }

      if (!existsSync(checkout.path)) {
        assertActive()
        if (checkout.fetchBase) {
          const remotes = (await this.git(task.cwd, ['remote'])).split(/\r?\n/)
          const remote = task.branchIntent?.remote ?? remotes.find(name => checkout.baseRef.startsWith(`${name}/`))
          if (!remote || !remotes.includes(remote)) throw new Error('FETCH_REMOTE_REQUIRED: choose a configured remote base')
          await this.git(task.cwd, ['fetch', '--', remote])
          const refreshed = await this.git(task.cwd, ['rev-parse', '--verify', `${checkout.baseRef}^{commit}`])
          assertActive()
          checkout.baseSha = refreshed
          task.baseSha = refreshed
          this.repository.save(task)
        }
        if (!checkout.createBranch && await this.git(task.cwd, ['rev-parse', '--verify', `refs/heads/${checkout.branch}^{commit}`]) !== checkout.baseSha) throw new Error('BRANCH_MOVED: run preflight again before creating the worktree')
        // The persisted SHA, rather than a moving ref, is the create start point.
        await this.git(task.cwd, ['cat-file', '-e', `${checkout.baseSha}^{commit}`])
        const existingSha = checkout.createBranch ? await this.git(task.cwd, ['rev-parse', '--verify', '--quiet', `refs/heads/${checkout.branch}^{commit}`]).catch(() => '') : ''
        if (existingSha && existingSha !== checkout.baseSha) throw new Error('BRANCH_MOVED: preserved branch differs from the checkout plan')
        assertActive()
        await this.gitApi.createWorktree({
          rootPath: task.cwd,
          path: checkout.path,
          branch: checkout.branch,
          createBranch: checkout.createBranch && !existingSha,
          baseRef: checkout.createBranch ? checkout.baseSha : undefined,
          fetchBase: false
        })
        if (checkout.remoteRef && checkout.createBranch) {
          await this.git(checkout.path, ['branch', '--set-upstream-to', checkout.remoteRef, checkout.branch])
        }
      }
      await this.verify(task)
      if (await this.git(task.path, ['rev-parse', 'HEAD']) !== checkout.baseSha) throw new Error('CHECKOUT_BASE_CHANGED: inspect the worktree before retrying')
      if (checkout.reuseExistingWorktree && await this.git(task.path, ['status', '--porcelain'])) throw new Error('WORKTREE_HAS_LOCAL_CHANGES')
      assertActive()
      this.repository.journal(task.id, 'git-checkout', generation, 'succeeded', {
        branch: checkout.branch,
        path: checkout.path,
        baseSha: checkout.baseSha
      })
    } catch (error) {
      this.repository.journal(task.id, 'git-checkout', generation, 'failed', undefined, error instanceof Error ? error.message : String(error))
      throw error
    }
  }

  private async verify(task: DelegationTask): Promise<void> {
    if (!existsSync(task.path)) throw new Error('Destination worktree was not created')
    if (await projectIdentity(task.path) !== task.project) throw new Error('Destination worktree belongs to another repository')
    const branch = await this.git(task.path, ['branch', '--show-current'])
    if (branch !== task.branch) throw new Error(`Destination worktree is on ${branch || 'detached HEAD'}, expected ${task.branch}`)
  }
}
