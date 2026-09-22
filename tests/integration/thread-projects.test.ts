import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { openInMemoryDatabase } from '../../electron/main/db'
import { threadProjectCatalog } from '../../electron/main/services/conversation/thread-projects'

it('groups worktrees by repository identity and keeps same-name repositories separate', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oxespace-thread-projects-'))
  const target = resolve(root)
  if (!target.startsWith(resolve(tmpdir()) + '\\') && !target.startsWith(resolve(tmpdir()) + '/')) throw Error('Fixture cleanup outside temp directory')
  const db = openInMemoryDatabase()
  try {
    const first = join(root, 'first', 'repo'), other = join(root, 'other', 'repo'), worktree = join(root, 'feature')
    for (const path of [first, other]) {
      mkdirSync(path, { recursive: true })
      execFileSync('git', ['init', path], { windowsHide: true, stdio: 'ignore' })
    }
    writeFileSync(join(first, 'README.md'), 'fixture')
    const git = (args: string[]) => execFileSync('git', args, { cwd: first, windowsHide: true, stdio: 'ignore' })
    git(['add', '.']); git(['-c', 'user.email=fixture@example.test', '-c', 'user.name=Fixture', 'commit', '-m', 'fixture'])
    git(['worktree', 'add', '-b', 'feature', worktree])
    for (const [id, path] of [['main', first], ['feature', worktree], ['unavailable', join(root, 'missing')]]) {
      db.prepare("INSERT INTO workspaces(id,name,root_path,layout,default_shell_profile_id) VALUES (?, 'repo', ?, '1x1', 'builtin-claude')").run(id, path)
    }
    db.prepare("INSERT INTO panes(id,workspace_id,type,row_index,column_index,root_path) VALUES ('cross-project','main','terminal',0,0,?)").run(other)
    const catalog = await threadProjectCatalog(db)
    expect(catalog.projects).toHaveLength(2)
    expect(catalog.projects.map(project => project.displayName)).toEqual(['repo', 'repo'])
    expect(catalog.projects.find(project => project.contexts.some(c => c.workspaceId === 'feature'))?.contexts.map(c => c.workspaceId).sort()).toEqual(['feature', 'main'])
    expect(catalog.projects.find(project => project.contexts.some(c => c.paneId === 'cross-project'))?.contexts).toHaveLength(1)
    expect(catalog.unavailable).toEqual(['unavailable'])
  } finally {
    db.close()
    rmSync(target, { recursive: true, force: true })
  }
}, 20000)
