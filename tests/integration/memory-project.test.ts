import { afterEach, describe, expect, test } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { openInMemoryDatabase } from '../../electron/main/db'
import { MemoryProjectService } from '../../electron/main/services/memory/memory-project.service'
import { matchingMemoryMarker } from '../../electron/main/services/memory/memory-marker'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
async function fixture() {
  const path = await mkdtemp(join(tmpdir(), 'oxespace-memory-project-test-'))
  directories.push(path)
  return path
}
function git(cwd: string, ...args: string[]) { return execFileSync('git', args, { cwd, windowsHide: true, stdio: 'pipe' }) }

describe('shared project mapping', () => {
  test('worktrees converge on one persistent project; same-name repositories remain isolated', async () => {
    const parent = await fixture()
    const main = join(parent, 'main')
    const other = join(parent, 'other', 'main')
    await mkdir(main)
    await mkdir(other, { recursive: true })
    git(main, 'init')
    git(main, '-c', 'user.name=Memory test', '-c', 'user.email=memory@example.invalid', 'commit', '--allow-empty', '-m', 'fixture')
    const worktree = join(parent, 'feature')
    git(main, 'worktree', 'add', '-b', 'feature', worktree)
    git(other, 'init')
    const db = openInMemoryDatabase()
    try {
      const service = new MemoryProjectService(db)
      const [a, b, c] = await Promise.all([service.resolve(main), service.resolve(worktree), service.resolve(other)])
      expect(a.projectId).toBe(b.projectId)
      expect(a.project).toBe(b.project)
      expect(c.projectId).not.toBe(a.projectId)
      expect(service.settings(a.projectId).enabled).toBe(false)
      service.configure(a.projectId, { enabled: true, automaticCapture: true, automaticContext: true })
      expect(service.settings(b.projectId).enabled).toBe(true)
      expect(service.settings(c.projectId).enabled).toBe(false)
      expect((await new MemoryProjectService(db).resolve(worktree)).projectId).toBe(a.projectId)
    } finally { db.close() }
  })

  test('nested foreign or settings-only markers fail closed; capture exclusions remain transparent', async () => {
    const root = await fixture()
    const child = join(root, 'src')
    await mkdir(child)
    const context = { projectId: 'id', workspace: 'oxespace-local', project: 'p-id', cwd: root }
    await writeFile(join(root, '.ai-memory.toml'), 'workspace = "oxespace-local"\nproject = "p-id"\n')
    expect(await matchingMemoryMarker(child, context)).toBe(true)
    await writeFile(join(child, '.ai-memory.toml'), '[capture]\nignore_paths = ["secrets/**"]\n')
    expect(await matchingMemoryMarker(child, context)).toBe(true)
    await writeFile(join(child, '.ai-memory.toml'), 'workspace = "oxespace-local"\nproject = "other"\n')
    expect(await matchingMemoryMarker(child, context)).toBe(false)
    await writeFile(join(child, '.ai-memory.toml'), '[briefing]\nmax_chars = 2000\n')
    expect(await matchingMemoryMarker(child, context)).toBe(false)
  })
})
