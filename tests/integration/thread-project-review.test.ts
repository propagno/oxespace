import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openInMemoryDatabase, type AppDatabase } from '../../electron/main/db'
import { ThreadManager } from '../../electron/main/services/conversation/thread-manager'

const resources: { db: AppDatabase; root: string; manager: ThreadManager }[] = []
afterEach(async () => {
  for (const { db, root, manager } of resources.splice(0)) {
    await manager.stop(); db.close()
    if (!resolve(root).startsWith(resolve(tmpdir()) + '\\oxe-thread-review-') && !resolve(root).startsWith(resolve(tmpdir()) + '/oxe-thread-review-')) throw Error('Unexpected test directory')
    rmSync(root, { recursive: true, force: true })
  }
})
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'oxe-thread-review-')), repo = join(root, 'repo')
  mkdirSync(repo)
  const git = (args: string[], cwd = repo) => execFileSync('git', args, { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], input: '' }).toString()
  git(['init']); git(['config', 'user.name', 'Review test']); git(['config', 'user.email', 'review@example.test'])
  const db = openInMemoryDatabase()
  db.prepare("INSERT INTO workspaces (id, name, root_path, layout, default_shell_profile_id) VALUES ('ws', 'Repo', ?, '1x1', 'builtin-claude')").run(repo)
  const manager = new ThreadManager(db, async () => { throw Error('Review must not launch an agent') }, () => {})
  resources.push({ root, db, manager })
  const create = (rootPath = repo) => manager.create({ workspaceId: 'ws', projectId: 'p', rootPath, provider: 'codex' }).thread.id
  return { root, repo, git, db, manager, create }
}
describe('Thread project review scope', () => {
  it('isolates same-workspace worktrees and includes preexisting tracked work without changing history', async () => {
    const f = fixture()
    writeFileSync(join(f.repo, 'a.ts'), 'baseline\n'); f.git(['add', 'a.ts']); f.git(['commit', '-m', 'Baseline'])
    const worktree = join(f.root, 'worktree'); f.git(['worktree', 'add', '-b', 'review-other', worktree])
    writeFileSync(join(f.repo, 'a.ts'), 'earlier local work\n')
    writeFileSync(join(worktree, 'a.ts'), 'different thread work\n')
    writeFileSync(join(f.repo, 'untracked.ts'), 'Do not misattribute this\n')
    const idA = f.create(), idB = f.create(worktree)
    const [a, b] = await Promise.all([f.manager.projectDiff(idA), f.manager.projectDiff(idB)])
    expect(a.files.map(file => file.path)).toEqual(['a.ts'])
    expect(JSON.stringify(a.files)).toContain('earlier local work')
    expect(JSON.stringify(a.files)).not.toContain('different thread work')
    expect(JSON.stringify(b.files)).toContain('different thread work')
    expect(f.manager.read(idA).events).toEqual([])
    expect(await f.manager.command(idA, '/diff')).toMatchObject({ surface: 'changes' })
  })
  it('handles an unborn branch without doubling staged and unstaged edits', async () => {
    const f = fixture(), id = f.create()
    writeFileSync(join(f.repo, 'new.ts'), 'staged\n'); f.git(['add', 'new.ts'])
    writeFileSync(join(f.repo, 'new.ts'), 'final\n')
    const diff = await f.manager.projectDiff(id)
    expect(diff.base).toBe('Unborn branch')
    expect(diff.files).toHaveLength(1)
    expect(diff.files[0]).toMatchObject({ path: 'new.ts', additions: 1, deletions: 0 })
    expect(JSON.stringify(diff.files)).toContain('final')
    expect(JSON.stringify(diff.files)).not.toContain('staged')
  })
})
