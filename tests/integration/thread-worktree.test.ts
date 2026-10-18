import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openInMemoryDatabase } from '../../electron/main/db'
import { ThreadProjectService } from '../../electron/main/services/conversation/thread-projects'
import { createThreadWorktree, generatedBranch, threadsInWorktree, ThreadWorktreeError, type ThreadWorktreeHost } from '../../electron/main/services/conversation/thread-worktree'

const cleanup: (() => void)[] = []
afterEach(() => { for (const step of cleanup.splice(0).reverse()) step() })

function repository(): string {
  const parent = mkdtempSync(join(tmpdir(), 'oxe-thread-wt-'))
  const repo = join(parent, 'repo')
  execFileSync('git', ['init', '-q', '-b', 'main', repo])
  const git = (...args: string[]): void => { execFileSync('git', args, { cwd: repo }) }
  git('config', 'user.email', 'e@x'); git('config', 'user.name', 'E')
  writeFileSync(join(repo, 'a.txt'), 'a\n'); git('add', '.'); git('commit', '-qm', 'a')
  git('branch', 'taken')
  cleanup.push(() => rmSync(parent, { recursive: true, force: true }))
  return repo
}

/** The Worktrees panel's operation, reduced to the git command it runs. */
const host = (overrides: Partial<ThreadWorktreeHost> = {}): ThreadWorktreeHost => ({
  createWorktree: async input => {
    execFileSync('git', ['worktree', 'add', '-b', input.branch, input.path, input.baseRef ?? 'HEAD'], { cwd: input.rootPath, stdio: 'ignore' })
    return { ok: true, message: `Worktree criado em ${input.path}` }
  },
  resolveBaseRef: async () => 'main',
  ...overrides
})
const branches = (repo: string): string[] => execFileSync('git', ['branch', '--format=%(refname:short)'], { cwd: repo, encoding: 'utf8' }).split(/\r?\n/).filter(Boolean)
const failure = async (promise: Promise<unknown>): Promise<ThreadWorktreeError> => {
  try { await promise } catch (error) { if (error instanceof ThreadWorktreeError) return error; throw error }
  throw new Error('expected a refusal')
}

describe('createThreadWorktree', () => {
  it('creates a generated branch in a sibling worktree folder, from the default base', async () => {
    const repo = repository()
    const created = await createThreadWorktree(host(), repo, {}, new Date(2026, 9, 17, 15, 30))
    expect(created.branch).toMatch(/^thread\/20261017-1530-[0-9a-f]{4}$/)
    expect(dirname(created.rootPath).replace(/\\/g, '/')).toMatch(/\/repo-worktrees$/)
    expect(existsSync(join(created.rootPath, 'a.txt'))).toBe(true)
    expect(execFileSync('git', ['branch', '--show-current'], { cwd: created.rootPath, encoding: 'utf8' }).trim()).toBe(created.branch)
  })

  it('uses a branch name and base the person chose', async () => {
    const repo = repository()
    const created = await createThreadWorktree(host(), repo, { branch: 'fix/login', baseRef: 'taken' })
    expect(created.branch).toBe('fix/login')
    expect(basename(created.rootPath)).toMatch(/^fix-login-/)
  })

  it('refuses by cause: existing branch, invalid branch, unknown or option-like base', async () => {
    const repo = repository()
    expect((await failure(createThreadWorktree(host(), repo, { branch: 'taken' }))).code).toBe('BRANCH_EXISTS')
    expect((await failure(createThreadWorktree(host(), repo, { branch: 'bad name' }))).code).toBe('INVALID_BRANCH')
    expect((await failure(createThreadWorktree(host(), repo, { baseRef: 'nope' }))).code).toBe('INVALID_BASE')
    expect((await failure(createThreadWorktree(host(), repo, { baseRef: '--upload-pack=x' }))).code).toBe('INVALID_BASE')
    expect(branches(repo).sort()).toEqual(['main', 'taken'])
  })

  it('leaves no branch or folder behind when creation fails', async () => {
    const repo = repository()
    let path = ''
    const failing = host({
      createWorktree: async input => {
        path = input.path
        execFileSync('git', ['worktree', 'add', '-b', input.branch, input.path, 'main'], { cwd: input.rootPath, stdio: 'ignore' })
        throw new Error('setup hook crashed')
      }
    })
    const error = await failure(createThreadWorktree(failing, repo, { branch: 'half-made' }))
    expect(error).toMatchObject({ code: 'CREATE_FAILED', message: 'setup hook crashed' })
    expect(existsSync(path)).toBe(false)
    expect(branches(repo)).not.toContain('half-made')
  })

  it('generates distinct names within the same minute', () => {
    const now = new Date(2026, 9, 17, 9, 5)
    expect(new Set([generatedBranch(now), generatedBranch(now), generatedBranch(now)]).size).toBe(3)
  })
})

describe('threadsInWorktree', () => {
  it('finds unarchived conversations rooted in or moved into a worktree, and nothing else', () => {
    const db = openInMemoryDatabase()
    cleanup.push(() => db.close())
    const tree = join(tmpdir(), 'repo-worktrees', 'fix')
    db.prepare("INSERT INTO thread_projects (id, identity, root_path, display_name, hidden, created_at, updated_at) VALUES ('p', 'id', '/repo', 'repo', 0, 1, 1)").run()
    const insert = (id: string, data: Record<string, unknown>): void => {
      db.prepare("INSERT INTO conversation_threads (id, workspace_id, thread_project_id, data_json, events_json) VALUES (?, 'thread:p', 'p', ?, '[]')").run(id, JSON.stringify({ id, title: id, ...data }))
    }
    insert('rooted', { rootPath: tree })
    insert('nested', { rootPath: join(tree, 'packages', 'app') })
    insert('moved', { rootPath: join(tmpdir(), 'repo'), observedLocation: { cwd: tree, checkoutRoot: tree, sameRepository: true } })
    insert('archived', { rootPath: tree, archived: true })
    insert('sibling', { rootPath: `${tree}-other` })
    insert('elsewhere', { rootPath: join(tmpdir(), 'repo') })
    expect(threadsInWorktree(db, tree).map(thread => thread.id).sort()).toEqual(['moved', 'nested', 'rooted'])
  })
})

describe('Thread project contexts for worktrees', () => {
  it('adds a worktree directory to a project and removes it, never the project root', () => {
    const db = openInMemoryDatabase()
    cleanup.push(() => db.close())
    db.prepare("INSERT INTO thread_projects (id, identity, root_path, display_name, hidden, created_at, updated_at) VALUES ('p', 'id', '/repo', 'repo', 0, 1, 1)").run()
    db.prepare("INSERT INTO thread_project_contexts (project_id, root_path) VALUES ('p', '/repo')").run()
    const projects = new ThreadProjectService(db)
    projects.addContext('p', '/repo-worktrees/fix')
    const contexts = (): string[] => (db.prepare("SELECT root_path FROM thread_project_contexts WHERE project_id = 'p' ORDER BY root_path").all() as { root_path: string }[]).map(row => row.root_path)
    expect(contexts()).toEqual(['/repo', '/repo-worktrees/fix'])
    projects.removeContext('p', '/repo-worktrees/fix')
    projects.removeContext('p', '/repo')
    expect(contexts()).toEqual(['/repo'])
    expect(() => projects.addContext('missing', '/x')).toThrow(/not found/)
  })
})
