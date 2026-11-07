// @vitest-environment node
/**
 * A conversation's own worktree keeps what creating it reported (TECH LEAD, 1.4.0): the new-conversation dialog
 * closes as the conversation opens, so the C3 notices travel with the conversation (`ownedWorktree.notices`).
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openInMemoryDatabase } from '../../electron/main/db'
import { GhExec } from '../../electron/main/services/github/gh-exec'
import { GitHubRepositoryService } from '../../electron/main/services/github/repository.service'
import { RepoHookTrust } from '../../electron/main/services/repo-config/trust'
import { createThreadWorktree, type ThreadWorktreeHost } from '../../electron/main/services/conversation/thread-worktree'
import type { MainMessage } from '../../shared/messages'

vi.setConfig({ testTimeout: 60_000 })

const cleanup: (() => void)[] = []
afterEach(() => { for (const step of cleanup.splice(0).reverse()) step() })

function repository(oxeYaml: string): string {
  const parent = realpathSync.native(mkdtempSync(join(tmpdir(), 'oxe-thread-wt-notices-')))
  const repo = join(parent, 'repo')
  execFileSync('git', ['init', '-q', '-b', 'main', repo])
  const git = (...args: string[]): void => { execFileSync('git', args, { cwd: repo }) }
  git('config', 'user.email', 'e@x'); git('config', 'user.name', 'E')
  writeFileSync(join(repo, '.gitignore'), '.env\n')
  writeFileSync(join(repo, 'oxe.yaml'), oxeYaml)
  git('add', '.'); git('commit', '-qm', 'a')
  writeFileSync(join(repo, '.env'), 'TOKEN=dev')
  cleanup.push(() => { try { rmSync(parent, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) } catch { /* temp dir */ } })
  return repo
}

describe('a conversation worktree keeps what creating it reported', () => {
  it('a copyFiles refusal, from the real worktree service, comes back with the worktree', async () => {
    const repo = repository('worktree:\n  copyFiles: [.env, ../outside.txt]\n')
    const db = openInMemoryDatabase()
    cleanup.push(() => db.close())
    const service = new GitHubRepositoryService(new GhExec({}))
    service.configureWorktreeLifecycle({ trust: new RepoHookTrust(db), stopTerminalsWithin: () => [] })
    const created = await createThreadWorktree({ createWorktree: input => service.createWorktree(input), resolveBaseRef: async () => 'main' }, repo, { branch: 'feature/notices' })
    expect(created.notices?.[0]).toMatchObject({ code: 'worktree.createdFrom' })
    expect(created.notices).toContainEqual({ code: 'worktree.copyFiles.outsideRepo', params: { patterns: ['../outside.txt'] } })
    expect(created.notices).toContainEqual({ code: 'worktree.copyFiles.copied', params: { count: 1 } })
  })

  it('every notice the worktree service sends is passed on as it came, hooks skipped included; none means none', async () => {
    const repo = repository('worktree:\n  copyFiles: [.env]\n')
    const notices: MainMessage[] = [
      { code: 'worktree.createdFrom', params: { path: '/x', branch: 'feature/hooks', base: 'main' } },
      { code: 'git.hooks.skipped', params: {} },
      { code: 'worktree.copyFiles.outsideRepo', params: { patterns: ['../x'] } }
    ]
    const host = (sent?: MainMessage[]): ThreadWorktreeHost => ({
      createWorktree: async input => {
        execFileSync('git', ['worktree', 'add', '-b', input.branch, input.path, input.baseRef ?? 'HEAD'], { cwd: input.rootPath, stdio: 'ignore' })
        return { ok: true, message: 'created', ...(sent ? { notices: sent } : {}) }
      },
      resolveBaseRef: async () => 'main'
    })
    expect((await createThreadWorktree(host(notices), repo, { branch: 'feature/hooks' })).notices).toEqual(notices)
    expect((await createThreadWorktree(host(), repo, { branch: 'feature/none' })).notices).toBeUndefined()
  })
})
