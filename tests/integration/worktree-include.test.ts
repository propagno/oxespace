import { execFileSync } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync, ftruncateSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { copyIncludedFiles, includeSegments, INCLUDE_LIMITS } from '../../electron/main/services/repo-config/worktree-include'
import { parseOxeYaml } from '../../electron/main/services/repo-config/parser'
import { GhExec } from '../../electron/main/services/github/gh-exec'
import { GitHubRepositoryService } from '../../electron/main/services/github/repository.service'
import { RepoHookTrust } from '../../electron/main/services/repo-config/trust'
import { openInMemoryDatabase } from '../../electron/main/db'
import { MESSAGE_CODES } from '../../shared/messages'

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let sandbox: string
let root: string
let tree: string

function put(base: string, rel: string, text = rel): void {
  const file = join(base, ...rel.split('/'))
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
}

/** A directory link that needs no privilege on Windows (a junction); false where the OS refuses it. */
function link(target: string, at: string): boolean {
  try { symlinkSync(target, at, process.platform === 'win32' ? 'junction' : 'dir'); return true } catch { return false }
}

const codes = (report: { notices: { code: string }[] }) => report.notices.map(n => n.code)

beforeEach(() => {
  sandbox = realpathSync.native(mkdtempSync(join(tmpdir(), 'oxe-include-')))
  root = join(sandbox, 'repo')
  tree = join(sandbox, 'tree')
  mkdirSync(join(root, '.git'), { recursive: true })
  mkdirSync(tree)
})

afterEach(() => {
  try { rmSync(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) } catch { /* temp dir */ }
})

describe('worktree.include (B19)', () => {
  it('oxe.yaml keeps the patterns as written, so a bad one can be refused by name', () => {
    const config = parseOxeYaml('worktree:\n  include: [.env, "config\\\\*.local.json", ../up, .env, 42]\n')
    expect(config?.worktree.include).toEqual(['.env', 'config/*.local.json', '../up'])
    expect(parseOxeYaml('worktree:\n  include: []\n')).toBeNull()
  })

  it('copies files, globs and a folder named on its own into the new worktree', async () => {
    put(root, '.env', 'SECRET=1')
    put(root, 'config/app.local.json')
    put(root, 'config/app.json')
    put(root, 'apps/web/.env.local')
    put(root, 'certs/dev/key.pem')
    put(root, 'certs/dev/sub/ca.pem')
    const report = await copyIncludedFiles(root, tree, ['.env', 'config/*.local.json', '**/.env.local', 'certs/dev'])
    expect(report.copied.sort()).toEqual(['.env', 'apps/web/.env.local', 'certs/dev/key.pem', 'certs/dev/sub/ca.pem', 'config/app.local.json'])
    expect(readFileSync(join(tree, '.env'), 'utf8')).toBe('SECRET=1')
    expect(existsSync(join(tree, 'config', 'app.json'))).toBe(false)
    expect(report.notices).toEqual([{ code: 'worktree.include.copied', params: { count: 5 } }])
  })

  it('refuses, by name, every pattern that is absolute, climbs out or names .git; nothing is copied for it', async () => {
    put(sandbox, 'outside.txt')
    put(root, '.git/config', '[core]')
    put(root, 'a/b')
    const refused = ['/etc/passwd', 'C:/Windows/win.ini', 'c:\\x', '../outside.txt', 'a/../../outside.txt', '.git/config', 'x/.GIT/y', './', '.']
    const report = await copyIncludedFiles(root, tree, refused)
    expect(report.copied).toEqual([])
    expect(report.notices).toEqual(refused.map(pattern => ({ code: 'worktree.include.outsideRepo', params: { pattern } })))
    for (const pattern of refused) expect(includeSegments(pattern)).toBeNull()
    expect(existsSync(join(tree, 'outside.txt'))).toBe(false)
    expect(existsSync(join(tree, '.git'))).toBe(false)
  })

  it('refuses the Windows spellings that can alias .git or another entry', async () => {
    const aliases = ['.git::$INDEX_ALLOCATION/config', 'GIT~1/config', 'git~2', 'a./b', 'a /b', 'x:y', 'dir/.Git/HEAD']
    const report = await copyIncludedFiles(root, tree, aliases)
    expect(report.copied).toEqual([])
    expect(report.notices).toEqual(aliases.map(pattern => ({ code: 'worktree.include.outsideRepo', params: { pattern } })))
  })

  it('matches in bounded time: runs of ** count as one, and a pattern past the limits is refused by name', async () => {
    let deep = root
    for (let i = 0; i < 14; i++) deep = join(deep, `d${i}`)
    mkdirSync(deep, { recursive: true })
    writeFileSync(join(deep, 'zz'), 'x')
    const started = Date.now()
    // 300 `**` in a row is one `**`; eight separate ones with a literal each stay within the matcher's limit.
    const report = await copyIncludedFiles(root, tree, [`${'**/'.repeat(300)}zz`, `${'**/d*/'.repeat(7)}**/zz`])
    expect(Date.now() - started).toBeLessThan(5_000)
    expect(report.copied).toHaveLength(1)
    const tooMany = `${'**/a/'.repeat(INCLUDE_LIMITS.globstars + 1)}zz`
    const tooDeep = `${'a/'.repeat(INCLUDE_LIMITS.segments)}zz`
    const refused = await copyIncludedFiles(root, tree, [tooMany, tooDeep])
    expect(refused.notices).toEqual([tooMany, tooDeep].map(pattern => ({ code: 'worktree.include.tooComplex', params: { pattern } })))
  })

  it('a named prefix never reads from another repository or worktree inside this one', async () => {
    put(root, '.worktrees/other/.git', 'gitdir: elsewhere')
    put(root, '.worktrees/other/.env', 'theirs')
    put(root, 'sub/.git', 'gitdir: elsewhere')
    put(root, 'sub/config.json')
    const report = await copyIncludedFiles(root, tree, ['.worktrees/other/.env', 'sub/*.json', 'sub'])
    expect(report.copied).toEqual([])
    expect(existsSync(join(tree, '.worktrees'))).toBe(false)
  })

  it('copies only what git reports as ignored in the new worktree', async () => {
    put(root, '.env', 'secret')
    put(root, 'notes.txt', 'plain')
    const asked: string[][] = []
    const report = await copyIncludedFiles(root, tree, ['.env', 'notes.txt'], async paths => { asked.push(paths); return new Set(['.env']) })
    expect(asked).toEqual([['.env', 'notes.txt']])
    expect(report.copied).toEqual(['.env'])
    expect(existsSync(join(tree, 'notes.txt'))).toBe(false)
    expect(report.notices).toContainEqual({ code: 'worktree.include.notIgnored', params: { paths: ['notes.txt'] } })
  })

  it('never searches .git, even through a glob', async () => {
    put(root, '.git/config', '[core]')
    put(root, '.git/hooks/pre-commit')
    const report = await copyIncludedFiles(root, tree, ['**/config', '**/pre-commit', '.gi?/config'])
    expect(report.copied).toEqual([])
    expect(existsSync(join(tree, '.git'))).toBe(false)
  })

  it('never overwrites a file the new worktree already has', async () => {
    put(root, '.env', 'from main')
    put(root, 'b.env', 'new')
    put(tree, '.env', 'committed')
    const report = await copyIncludedFiles(root, tree, ['*.env', '.env'])
    expect(readFileSync(join(tree, '.env'), 'utf8')).toBe('committed')
    expect(report.copied).toEqual(['b.env'])
    expect(report.notices).toContainEqual({ code: 'worktree.include.notOverwritten', params: { paths: ['.env'] } })
  })

  it('does not follow a link in the repository, named or reached by a glob', async () => {
    put(sandbox, 'elsewhere/secret.txt', 'outside')
    if (!link(join(sandbox, 'elsewhere'), join(root, 'linked'))) return
    const report = await copyIncludedFiles(root, tree, ['linked/secret.txt', 'linked', '**/secret.txt', '*'])
    expect(report.copied).toEqual([])
    expect(existsSync(join(tree, 'linked'))).toBe(false)
    expect(report.notices).toEqual([{ code: 'worktree.include.notFollowed', params: { paths: ['linked', 'linked/secret.txt'] } }])
  })

  it('does not write through a link in the new worktree that leads outside it', async () => {
    put(root, 'conf/local.ini', 'x')
    const outside = join(sandbox, 'victim')
    mkdirSync(outside)
    if (!link(outside, join(tree, 'conf'))) return
    const report = await copyIncludedFiles(root, tree, ['conf/local.ini'])
    expect(report.copied).toEqual([])
    expect(existsSync(join(outside, 'local.ini'))).toBe(false)
    expect(report.notices).toEqual([{ code: 'worktree.include.notFollowed', params: { paths: ['conf/local.ini'] } }])
  })

  it('skips another repository or worktree kept inside this one', async () => {
    put(root, 'nested/.git', 'gitdir: elsewhere')
    put(root, 'nested/.env')
    put(root, '.env')
    const report = await copyIncludedFiles(root, tree, ['**/.env'])
    expect(report.copied).toEqual(['.env'])
  })

  it(`above ${INCLUDE_LIMITS.files} files copies nothing and says so`, async () => {
    for (let i = 0; i <= INCLUDE_LIMITS.files; i++) put(root, `many/f${i}.txt`, 'x')
    const report = await copyIncludedFiles(root, tree, ['many/*.txt'])
    expect(report.copied).toEqual([])
    expect(existsSync(join(tree, 'many'))).toBe(false)
    expect(report.notices).toEqual([{ code: 'worktree.include.overLimit', params: { files: INCLUDE_LIMITS.files + 1, megabytes: 1, maxFiles: INCLUDE_LIMITS.files, maxMegabytes: 50 } }])
  })

  it('above 50 MB copies nothing and says so', async () => {
    mkdirSync(join(root, 'big'))
    const fd = openSync(join(root, 'big', 'blob.bin'), 'w')
    ftruncateSync(fd, INCLUDE_LIMITS.bytes + 1)
    closeSync(fd)
    const report = await copyIncludedFiles(root, tree, ['big/blob.bin'])
    expect(report.copied).toEqual([])
    expect(codes(report)).toEqual(['worktree.include.overLimit'])
    expect(existsSync(join(tree, 'big'))).toBe(false)
  })

  it('every code it sends is in the catalog contract', () => {
    for (const code of ['worktree.include.copied', 'worktree.include.outsideRepo', 'worktree.include.overLimit', 'worktree.include.searchTooLarge',
      'worktree.include.tooComplex', 'worktree.include.notIgnored',
      'worktree.include.notOverwritten', 'worktree.include.notFollowed', 'worktree.include.failed']) expect(MESSAGE_CODES).toContain(code)
  })
})

describe('createWorktree with oxe.yaml (real git)', () => {
  function git(cwd: string, ...args: string[]): string {
    return execFileSync('git', args, { cwd, encoding: 'utf8' })
  }

  let service: GitHubRepositoryService
  let close: () => void

  beforeEach(() => {
    rmSync(join(root, '.git'), { recursive: true, force: true })
    git(root, 'init', '-q', '-b', 'main')
    git(root, 'config', 'user.email', 't@t.t')
    git(root, 'config', 'user.name', 't')
    writeFileSync(join(root, '.gitignore'), '.env\n')
    writeFileSync(join(root, 'oxe.yaml'), 'worktree:\n  include: [.env, ../outside.txt]\n')
    git(root, 'add', '.')
    git(root, 'commit', '-qm', 'init')
    writeFileSync(join(root, '.env'), 'TOKEN=dev')
    const db = openInMemoryDatabase()
    close = () => db.close()
    service = new GitHubRepositoryService(new GhExec({}))
    service.configureWorktreeLifecycle({ trust: new RepoHookTrust(db), stopTerminalsWithin: () => [] })
  })

  afterEach(() => close())

  it('copies the gitignored file and returns C3 notices, the creation first (FINDING L)', async () => {
    const path = join(sandbox, 'wt-new')
    const result = await service.createWorktree({ rootPath: root, branch: 'feature/b19', path, createBranch: true, baseRef: 'main' })
    expect(readFileSync(join(path, '.env'), 'utf8')).toBe('TOKEN=dev')
    expect(result.notices).toEqual([
      { code: 'worktree.createdFrom', params: { path, branch: 'feature/b19', base: 'main' } },
      { code: 'worktree.include.outsideRepo', params: { pattern: '../outside.txt' } },
      { code: 'worktree.include.copied', params: { count: 1 } }
    ])
    // The text is English for agents and logs, whatever the machine's language; the window words `notices` itself.
    expect(result.message).toMatch(/^Worktree created at .* \(branch feature\/b19 from main\)\. /)
    expect(result.message).not.toMatch(/criado|a partir de/)
  })

  it('the list comes from the main checkout only: a branch cannot add files, and a file git does not ignore stays behind', async () => {
    git(root, 'switch', '-q', '-c', 'hostile')
    writeFileSync(join(root, 'oxe.yaml'), 'worktree:\n  include: [.env, secret.pem]\n')
    git(root, 'commit', '-qam', 'branch asks for more')
    git(root, 'switch', '-q', 'main')
    writeFileSync(join(root, 'secret.pem'), 'key')
    writeFileSync(join(root, 'oxe.yaml'), 'worktree:\n  include: [.env, notes.txt]\n')
    writeFileSync(join(root, 'notes.txt'), 'not ignored')
    const path = join(sandbox, 'wt-hostile')
    const result = await service.createWorktree({ rootPath: root, branch: 'hostile', path, createBranch: false })
    expect(existsSync(join(path, '.env'))).toBe(true)
    expect(existsSync(join(path, 'secret.pem'))).toBe(false)
    expect(existsSync(join(path, 'notes.txt'))).toBe(false)
    expect(result.notices).toContainEqual({ code: 'worktree.include.notIgnored', params: { paths: ['notes.txt'] } })
  })

  it('an existing branch reports worktree.created, without a base', async () => {
    git(root, 'branch', 'existing')
    const path = join(sandbox, 'wt-existing')
    const result = await service.createWorktree({ rootPath: root, branch: 'existing', path, createBranch: false })
    expect(result.notices?.[0]).toEqual({ code: 'worktree.created', params: { path, branch: 'existing' } })
    expect(existsSync(join(path, '.env'))).toBe(true)
  })
})
