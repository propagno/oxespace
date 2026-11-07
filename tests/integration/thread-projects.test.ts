import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { removeTempDir } from '../helpers/removeTempDir'
import { realpath } from 'node:fs/promises'
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
    expect(catalog.projects.find(project => project.projectId === main.projectId)?.contexts.map(c => c.rootPath).sort()).toEqual([await realpath(first), await realpath(worktree)].sort())
    expect(catalog.projects.find(project => project.projectId === otherProject.projectId)?.contexts).toHaveLength(1)
    const thread = { id: 'moved-thread', projectId: otherProject.projectId, workspaceId: `thread:${otherProject.projectId}`, rootPath: service.context(otherProject.projectId).rootPath, provider: 'codex' }
    db.prepare('INSERT INTO conversation_threads (id, workspace_id, thread_project_id, data_json) VALUES (?, ?, ?, ?)')
      .run(thread.id, thread.workspaceId, thread.projectId, JSON.stringify(thread))
    const relocated = join(root, 'other', 'repo-relocated')
    renameSync(other, relocated)
    const canonicalRelocated = await realpath(relocated)
    expect(service.catalog().unavailable).toContain(otherProject.projectId)
    await service.relink(otherProject.projectId, relocated)
    expect(service.catalog().unavailable).not.toContain(otherProject.projectId)
    expect(service.context(otherProject.projectId).rootPath).toBe(canonicalRelocated)
    expect(JSON.parse((db.prepare('SELECT data_json FROM conversation_threads WHERE id = ?').get(thread.id) as { data_json: string }).data_json).rootPath).toBe(canonicalRelocated)
    service.setHidden(main.projectId, true)
    expect(service.catalog().projects.find(project => project.projectId === main.projectId)?.hidden).toBe(true)
    expect(db.prepare('SELECT id FROM workspaces').all()).toEqual([{ id: 'code-only' }])
    expect(catalog.unavailable).toEqual([])
  } finally {
    db.close()
    removeTempDir(target)
  }
}, 20000)

it('accepts another spelling of a registered project root: a link in the path, and a Windows 8.3 name', async () => {
  const { symlinkSync, realpathSync } = await import('node:fs')
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'oxespace-thread-spelling-')))
  const db = openInMemoryDatabase()
  try {
    const repo = join(root, 'a long project folder', 'repo')
    mkdirSync(repo, { recursive: true })
    execFileSync('git', ['init', repo], { windowsHide: true, stdio: 'ignore' })
    const service = new ThreadProjectService(db)
    const project = await service.add(repo)
    const stored = service.context(project.projectId).rootPath

    // A link in the path (a junction needs no privilege on Windows) names the same folder.
    const link = join(root, 'linked')
    symlinkSync(join(root, 'a long project folder'), link, 'junction')
    expect(service.context(project.projectId, join(link, 'repo')).rootPath).toBe(stored)

    if (process.platform === 'win32') {
      // The path travels in the environment: no quoting through a shell to get wrong.
      const short = execFileSync('powershell', ['-NoProfile', '-Command', '(New-Object -ComObject Scripting.FileSystemObject).GetFolder($env:OXE_TEST_PATH).ShortPath'],
        { windowsHide: true, encoding: 'utf8', env: { ...process.env, OXE_TEST_PATH: repo } }).trim()
      // Volumes without 8.3 names give the long form back: nothing more to check there.
      if (short && short !== repo) expect(service.context(project.projectId, short).rootPath).toBe(stored)
    }

    // Another folder, or a network path, is still refused.
    mkdirSync(join(root, 'other'))
    expect(() => service.context(project.projectId, join(root, 'other'))).toThrow('Directory does not belong to this Thread project')
    expect(() => service.context(project.projectId, String.raw`\\server\share\repo`)).toThrow('Directory does not belong to this Thread project')
  } finally {
    db.close()
    removeTempDir(root)
  }
}, 20000)

it('never follows a link inside the given root that leads to a share', async () => {
  const { symlinkSync, realpathSync } = await import('node:fs')
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'oxespace-thread-share-')))
  const db = openInMemoryDatabase()
  try {
    const repo = join(root, 'repo')
    mkdirSync(repo, { recursive: true })
    execFileSync('git', ['init', repo], { windowsHide: true, stdio: 'ignore' })
    const service = new ThreadProjectService(db)
    const project = await service.add(repo)
    // A symlink to a share needs Developer Mode on Windows; where it can't be made, there is nothing to test.
    try { symlinkSync('//attacker/share', join(root, 'share'), 'dir') } catch { return }
    expect(() => service.context(project.projectId, join(root, 'share', 'repo'))).toThrow('Directory does not belong to this Thread project')
  } finally {
    db.close()
    removeTempDir(root)
  }
})
