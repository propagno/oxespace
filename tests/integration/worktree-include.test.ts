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

describe('worktree.copyFiles (B19)', () => {
  it('oxe.yaml keeps the patterns as written, so a bad one can be refused by name', () => {
    const config = parseOxeYaml('worktree:\n  copyFiles: [.env, "config\\\\*.local.json", ../up, .env, 42]\n')
    expect(config?.worktree.copyFiles).toEqual(['.env', 'config/*.local.json', '../up'])
    expect(parseOxeYaml('worktree:\n  copyFiles: []\n')).toBeNull()
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
    expect(report.notices).toEqual([{ code: 'worktree.copyFiles.copied', params: { count: 5 } }])
  })

  it('refuses, by name, every pattern that is absolute, climbs out or names .git; nothing is copied for it', async () => {
    put(sandbox, 'outside.txt')
    put(root, '.git/config', '[core]')
    put(root, 'a/b')
    const refused = ['/etc/passwd', 'C:/Windows/win.ini', 'c:\\x', '../outside.txt', 'a/../../outside.txt', '.git/config', 'x/.GIT/y', './', '.']
    const report = await copyIncludedFiles(root, tree, refused)
    expect(report.copied).toEqual([])
    // One notice names them all.
    expect(report.notices).toEqual([{ code: 'worktree.copyFiles.outsideRepo', params: { patterns: refused } }])
    for (const pattern of refused) expect(includeSegments(pattern)).toBeNull()
    expect(existsSync(join(tree, 'outside.txt'))).toBe(false)
    expect(existsSync(join(tree, '.git'))).toBe(false)
  })

  it('refuses the Windows spellings that can alias .git or another entry', async () => {
    const aliases = ['.git::$INDEX_ALLOCATION/config', 'GIT~1/config', 'git~2', 'a./b', 'a /b', 'x:y', 'dir/.Git/HEAD']
    const report = await copyIncludedFiles(root, tree, aliases)
    expect(report.copied).toEqual([])
    expect(report.notices).toEqual([{ code: 'worktree.copyFiles.outsideRepo', params: { patterns: aliases } }])
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
    expect(refused.notices).toEqual([{ code: 'worktree.copyFiles.tooComplex', params: { patterns: [tooMany, tooDeep] } }])
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
    expect(report.notices).toContainEqual({ code: 'worktree.copyFiles.notIgnored', params: { paths: ['notes.txt'] } })
  })

  it('keeps a leading ! for excluding later: such a pattern copies nothing, even a file named that way', async () => {
    put(root, '!literal.txt')
    put(root, '.env')
    const report = await copyIncludedFiles(root, tree, ['!literal.txt', ' !*.env', '.env'])
    expect(report.copied).toEqual(['.env'])
    expect(report.notices[0]).toEqual({ code: 'worktree.copyFiles.excludeReserved', params: { patterns: ['!literal.txt', ' !*.env'] } })
  })

  it('a refusal list stays capped, however many patterns there are', async () => {
    const many = Array.from({ length: 60 }, (_, i) => `../up${i}`)
    const report = await copyIncludedFiles(root, tree, many)
    expect(report.notices).toHaveLength(1)
    expect((report.notices[0].params as { patterns: string[] }).patterns).toHaveLength(20)
  })

  it('when git cannot tell what it ignores, nothing is copied and the report says git failed', async () => {
    put(root, '.env', 'secret')
    const report = await copyIncludedFiles(root, tree, ['.env'], async () => null)
    expect(report.copied).toEqual([])
    expect(existsSync(join(tree, '.env'))).toBe(false)
    expect(report.notices).toEqual([{ code: 'worktree.copyFiles.ignoreCheckFailed', params: {} }])
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
    expect(report.notices).toContainEqual({ code: 'worktree.copyFiles.notOverwritten', params: { paths: ['.env'] } })
  })

  it('does not follow a link in the repository, named or reached by a glob', async () => {
    put(sandbox, 'elsewhere/secret.txt', 'outside')
    if (!link(join(sandbox, 'elsewhere'), join(root, 'linked'))) return
    const report = await copyIncludedFiles(root, tree, ['linked/secret.txt', 'linked', '**/secret.txt', '*'])
    expect(report.copied).toEqual([])
    expect(existsSync(join(tree, 'linked'))).toBe(false)
    expect(report.notices).toEqual([{ code: 'worktree.copyFiles.notFollowed', params: { paths: ['linked', 'linked/secret.txt'] } }])
  })

  it('does not write through a link in the new worktree that leads outside it', async () => {
    put(root, 'conf/local.ini', 'x')
    const outside = join(sandbox, 'victim')
    mkdirSync(outside)
    if (!link(outside, join(tree, 'conf'))) return
    const report = await copyIncludedFiles(root, tree, ['conf/local.ini'])
    expect(report.copied).toEqual([])
    expect(existsSync(join(outside, 'local.ini'))).toBe(false)
    expect(report.notices).toEqual([{ code: 'worktree.copyFiles.notFollowed', params: { paths: ['conf/local.ini'] } }])
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
    expect(report.notices).toEqual([{ code: 'worktree.copyFiles.overLimit', params: { files: INCLUDE_LIMITS.files + 1, megabytes: 1, maxFiles: INCLUDE_LIMITS.files, maxMegabytes: 50 } }])
  })

  it('above 50 MB copies nothing and says so', async () => {
    mkdirSync(join(root, 'big'))
    const fd = openSync(join(root, 'big', 'blob.bin'), 'w')
    ftruncateSync(fd, INCLUDE_LIMITS.bytes + 1)
    closeSync(fd)
    const report = await copyIncludedFiles(root, tree, ['big/blob.bin'])
    expect(report.copied).toEqual([])
    expect(codes(report)).toEqual(['worktree.copyFiles.overLimit'])
    expect(existsSync(join(tree, 'big'))).toBe(false)
  })

  it('every code it sends is in the catalog contract', () => {
    for (const code of ['worktree.copyFiles.copied', 'worktree.copyFiles.outsideRepo', 'worktree.copyFiles.overLimit', 'worktree.copyFiles.searchTooLarge',
      'worktree.copyFiles.tooComplex', 'worktree.copyFiles.notIgnored', 'worktree.copyFiles.excludeReserved', 'worktree.copyFiles.ignoreCheckFailed',
      'worktree.copyFiles.notOverwritten', 'worktree.copyFiles.notFollowed', 'worktree.copyFiles.failed']) expect(MESSAGE_CODES).toContain(code)
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
    writeFileSync(join(root, 'oxe.yaml'), 'worktree:\n  copyFiles: [.env, ../outside.txt]\n')
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
      { code: 'worktree.copyFiles.outsideRepo', params: { patterns: ['../outside.txt'] } },
      { code: 'worktree.copyFiles.copied', params: { count: 1 } }
    ])
    // The text is English for agents and logs, whatever the machine's language; the window words `notices` itself.
    expect(result.message).toMatch(/^Worktree created at .* \(branch feature\/b19 from main\)\. /)
    expect(result.message).not.toMatch(/criado|a partir de/)
  })

  it('created from inside another worktree: the list and the files still come from the main checkout (HML FINDING M)', async () => {
    const first = join(sandbox, 'wt-1')
    await service.createWorktree({ rootPath: root, branch: 'wt-1', path: first, createBranch: true, baseRef: 'main' })
    // What an agent in wt-1 can write: its own list asking for more, its own copies, and ignore rules that allow them.
    writeFileSync(join(first, 'oxe.yaml'), 'worktree:\n  copyFiles: [secret.pem, .env]\n')
    writeFileSync(join(first, '.gitignore'), '.env\nsecret.pem\n')
    writeFileSync(join(first, 'secret.pem'), 'key from wt-1')
    writeFileSync(join(first, '.env'), 'TOKEN=from-wt-1')
    const second = join(sandbox, 'wt-2')
    const result = await service.createWorktree({ rootPath: first, branch: 'wt-2', path: second, createBranch: true, baseRef: 'main' })
    expect(existsSync(join(second, 'secret.pem'))).toBe(false)
    expect(readFileSync(join(second, '.env'), 'utf8')).toBe('TOKEN=dev')
    expect(result.notices).toContainEqual({ code: 'worktree.copyFiles.copied', params: { count: 1 } })
  })

  it('the list comes from the main checkout only: a branch cannot add files, and a file git does not ignore stays behind', async () => {
    git(root, 'switch', '-q', '-c', 'hostile')
    writeFileSync(join(root, 'oxe.yaml'), 'worktree:\n  copyFiles: [.env, secret.pem]\n')
    git(root, 'commit', '-qam', 'branch asks for more')
    git(root, 'switch', '-q', 'main')
    writeFileSync(join(root, 'secret.pem'), 'key')
    writeFileSync(join(root, 'oxe.yaml'), 'worktree:\n  copyFiles: [.env, notes.txt]\n')
    writeFileSync(join(root, 'notes.txt'), 'not ignored')
    const path = join(sandbox, 'wt-hostile')
    const result = await service.createWorktree({ rootPath: root, branch: 'hostile', path, createBranch: false })
    expect(existsSync(join(path, '.env'))).toBe(true)
    expect(existsSync(join(path, 'secret.pem'))).toBe(false)
    expect(existsSync(join(path, 'notes.txt'))).toBe(false)
    expect(result.notices).toContainEqual({ code: 'worktree.copyFiles.notIgnored', params: { paths: ['notes.txt'] } })
  })

  it('an existing branch reports worktree.created, without a base', async () => {
    git(root, 'branch', 'existing')
    const path = join(sandbox, 'wt-existing')
    const result = await service.createWorktree({ rootPath: root, branch: 'existing', path, createBranch: false })
    expect(result.notices?.[0]).toEqual({ code: 'worktree.created', params: { path, branch: 'existing' } })
    expect(existsSync(join(path, '.env'))).toBe(true)
  })
})
