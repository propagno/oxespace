import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createIdentityGuard } from '../../electron/main/services/conversation/identity-guard'
import { ProjectCoordinatorService } from '../../electron/main/services/conversation/project-coordinators'
import { openInMemoryDatabase } from '../../electron/main/db'
import { projectIdentity } from '../../electron/main/services/memory/memory-project.service'

/**
 * SECURITY M-1, with real Git: two ways projectIdentity() puts unrelated folders under one identity. Git discovery
 * stops at the temporary folder, so the developer's own home (which may be a repository) never answers.
 */
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.email=test@example.com', '-c', 'user.name=Test', ...args], { cwd, stdio: 'pipe' })
let base = '', home = '', ceiling: string | undefined
beforeAll(() => {
  ceiling = process.env.GIT_CEILING_DIRECTORIES
  base = mkdtempSync(join(tmpdir(), 'oxe-guard-'))
  process.env.GIT_CEILING_DIRECTORIES = base
  home = join(base, 'home')
  mkdirSync(home)
})
afterAll(() => {
  if (ceiling === undefined) delete process.env.GIT_CEILING_DIRECTORIES; else process.env.GIT_CEILING_DIRECTORIES = ceiling
  // Windows can still hold a file Git just wrote; a leftover temporary folder must not fail the run.
  try { rmSync(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch { /* left in the temporary folder */ }
})
const folder = (...parts: string[]) => { const path = join(base, ...parts); mkdirSync(path, { recursive: true }); return path }

describe('identity guard (B1.4 · SECURITY M-1)', () => {
  it('passes a repository, its listed worktree and a folder outside any repository', async () => {
    const guard = createIdentityGuard(() => home)
    const repo = folder('repo')
    git(repo, 'init', '-q'); git(repo, 'commit', '-q', '--allow-empty', '-m', 'start')
    git(repo, 'worktree', 'add', '-q', join(base, 'repo-feature'))
    expect(await guard(repo)).toBe('ok')
    expect(await guard(join(base, 'repo-feature'))).toBe('ok')
    expect(await guard(folder('plain'))).toBe('ok')
  }, 30_000)

  it('refuses a folder inside a home-folder repository that is not its root, but not the home repository itself', async () => {
    const homeRepo = folder('home-repo')
    git(homeRepo, 'init', '-q')
    const guard = createIdentityGuard(() => homeRepo)
    const unrelated = folder('home-repo', 'Projects', 'unrelated')
    expect(await guard(unrelated)).toBe('ambiguous')
    expect(await guard(homeRepo)).toBe('ok')
    // A repository above the home folder counts too.
    expect(await createIdentityGuard(() => folder('home-repo', 'Users', 'me'))(unrelated)).toBe('ambiguous')
    // The two unrelated folders really would share one identity without the guard.
    expect(await projectIdentity(unrelated)).toBe(await projectIdentity(folder('home-repo', 'Other')))
  }, 30_000)

  it('refuses a forged .git file that points at another repository\'s Git directory', async () => {
    const real = folder('real')
    git(real, 'init', '-q')
    const forged = folder('forged')
    writeFileSync(join(forged, '.git'), `gitdir: ${join(real, '.git')}\n`)
    expect(await projectIdentity(forged)).toBe(await projectIdentity(real)) // what the guard is for
    expect(await createIdentityGuard(() => home)(forged)).toBe('ambiguous')
  }, 30_000)

  it('makes the coordinator refuse an ambiguous identity with its C3 code, writing nothing', async () => {
    const real = folder('real-2')
    git(real, 'init', '-q')
    const forged = folder('forged-2')
    writeFileSync(join(forged, '.git'), `gitdir: ${join(real, '.git')}\n`)
    const db = openInMemoryDatabase()
    try {
      db.prepare("INSERT INTO workspaces (id, name, root_path, layout, default_shell_profile_id) VALUES ('ws', 'Repo', ?, '1x1', 'builtin-claude')").run(forged)
      db.prepare("INSERT INTO thread_projects (id, identity, root_path, display_name, created_at, updated_at) VALUES ('p', 'x', ?, 'p', 1, 1)").run(forged)
      db.prepare("INSERT INTO conversation_threads (id, workspace_id, thread_project_id, data_json, events_json) VALUES ('t', 'ws', 'p', '{\"id\":\"t\"}', '[]')").run()
      const service = new ProjectCoordinatorService(db, projectIdentity, createIdentityGuard(() => home))
      await expect(service.setForThread('t', true)).rejects.toMatchObject({ message: 'thread.coordinator.identityAmbiguous' })
      expect(db.prepare('SELECT COUNT(*) AS n FROM project_coordinators').get()).toEqual({ n: 0 })
    } finally { db.close() }
  }, 30_000)
})
