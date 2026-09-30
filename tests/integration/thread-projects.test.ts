import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { openInMemoryDatabase } from '../../electron/main/db'
import { ThreadProjectService } from '../../electron/main/services/conversation/thread-projects'

it('registers Thread projects independently and groups worktrees without importing Code workspaces', async () => {
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
    db.prepare("INSERT INTO workspaces(id,name,root_path,layout,default_shell_profile_id) VALUES ('code-only', 'repo', ?, '1x1', 'builtin-claude')").run(other)
    const service = new ThreadProjectService(db)
    expect(service.catalog().projects).toEqual([])
    const main = await service.add(first)
    expect(db.prepare('SELECT id FROM memory_projects WHERE id = ?').get(main.projectId)).toBeUndefined()
    const feature = await service.add(worktree)
    expect(feature.projectId).toBe(main.projectId)
    const otherProject = await service.add(other)
    const catalog = service.catalog()
    expect(catalog.projects).toHaveLength(2)
    expect(catalog.projects.map(project => project.displayName)).toEqual(['repo', 'repo'])
    expect(catalog.projects.find(project => project.projectId === main.projectId)?.contexts.map(c => c.rootPath).sort()).toEqual([first, worktree].sort())
    expect(catalog.projects.find(project => project.projectId === otherProject.projectId)?.contexts).toHaveLength(1)
    const thread = { id: 'moved-thread', projectId: otherProject.projectId, workspaceId: `thread:${otherProject.projectId}`, rootPath: other, provider: 'codex' }
    db.prepare('INSERT INTO conversation_threads (id, workspace_id, thread_project_id, data_json) VALUES (?, ?, ?, ?)')
      .run(thread.id, thread.workspaceId, thread.projectId, JSON.stringify(thread))
    const relocated = join(root, 'other', 'repo-relocated')
    renameSync(other, relocated)
    expect(service.catalog().unavailable).toContain(otherProject.projectId)
    await service.relink(otherProject.projectId, relocated)
    expect(service.catalog().unavailable).not.toContain(otherProject.projectId)
    expect(service.context(otherProject.projectId).rootPath).toBe(relocated)
    expect(JSON.parse((db.prepare('SELECT data_json FROM conversation_threads WHERE id = ?').get(thread.id) as { data_json: string }).data_json).rootPath).toBe(relocated)
    service.setHidden(main.projectId, true)
    expect(service.catalog().projects.find(project => project.projectId === main.projectId)?.hidden).toBe(true)
    expect(db.prepare('SELECT id FROM workspaces').all()).toEqual([{ id: 'code-only' }])
    expect(catalog.unavailable).toEqual([])
  } finally {
    db.close()
    rmSync(target, { recursive: true, force: true })
  }
}, 20000)
