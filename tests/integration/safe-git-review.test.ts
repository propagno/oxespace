// @vitest-environment node
/**
 * SECURITY's review of #387 against real git: H1 (a driver named `a=b`), H2 (`core.alternateRefsCommand`), H3 (a
 * push to a local path runs the target's hooks), M1 (check then act), M2 (gh's own git) and L1 (`ls-files -m`). Each
 * vector first runs through plain git and leaves its marker, so the test can fail; then through the module, which
 * leaves none. Condition (b): the person's GLOBAL credential helper never refuses a person call.
 */
import { execFile, execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { __forgetConfigReadsForTests, __forgetSeenDriversForTests, execConfigReader, execGitSync, ghEnv, isConfigRead, onRepositoryConfigChanged, runGit, type ConfigReader } from '../../electron/main/utils/safe-git'
import { PersonGitRefused, runPersonGit } from '../../electron/main/utils/safe-git-person'
import { commonGitDir } from '../../electron/main/utils/git-dir'
import { GhExec, type SpawnAsyncOptions, type SpawnResult } from '../../electron/main/services/github/gh-exec'

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const plainEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^GIT_/i.test(name)))
const plain = (cwd: string, ...args: string[]): string => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, env: plainEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const plainTry = (cwd: string, ...args: string[]): void => { try { plain(cwd, ...args) } catch { /* the vector's own failure is fine */ } }
const slash = (path: string) => path.replace(/\\/g, '/')

let sandbox: string, marker: string, evil: string, evilRun: string, evilScript: string
beforeEach(() => {
  __forgetSeenDriversForTests()
  __forgetConfigReadsForTests()
  sandbox = realpathSync.native(mkdtempSync(join(tmpdir(), 'oxe-safegit-387-')))
  marker = join(sandbox, 'MARKER')
  evilScript = join(sandbox, 'evil.sh')
  writeFileSync(evilScript, `#!/bin/sh\necho "ran $0 $*" >> '${slash(marker)}'\ncat\nexit 0\n`)
  evil = `sh '${slash(evilScript)}'`
  // The same, without passing stdin through: for commands that are not filters.
  const runScript = join(sandbox, 'evil-run.sh')
  writeFileSync(runScript, `#!/bin/sh\necho "ran $0 $*" >> '${slash(marker)}'\nexit 0\n`)
  evilRun = `sh '${slash(runScript)}'`
})
afterEach(() => { try { rmSync(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) } catch { /* temp dir */ } })
const ran = () => existsSync(marker)
const reset = () => rmSync(marker, { force: true })

function fullRepo(name = 'repo'): string {
  const root = join(sandbox, name)
  mkdirSync(root)
  plain(root, 'init', '-q', '-b', 'main')
  plain(root, 'config', 'user.name', 't')
  plain(root, 'config', 'user.email', 't@t')
  writeFileSync(join(root, 'a.txt'), 'one\n')
  plain(root, 'add', 'a.txt')
  plain(root, 'commit', '-q', '-m', 'first')
  writeFileSync(join(root, 'a.txt'), 'one\ntwo\n')
  return root
}

/** A repository whose `.txt` files go through a filter driver the repository itself defines, as `name`. */
function filteredRepo(name: string, driver = 'agent'): string {
  const root = fullRepo(name)
  // A file of the same size with other content: git must hash it, through the clean filter, to know it changed.
  writeFileSync(join(root, 'c.txt'), 'abc\n')
  plain(root, 'add', 'c.txt')
  plain(root, 'commit', '-q', '-m', 'c')
  writeFileSync(join(root, 'c.txt'), 'xyz\n')
  utimesSync(join(root, 'c.txt'), new Date(Date.now() + 5000), new Date(Date.now() + 5000))
  writeFileSync(join(root, '.gitattributes'), `*.txt filter=${driver}\n`)
  appendFileSync(join(root, '.git', 'config'), `[filter "${driver}"]\n\tclean = ${evil}\n\tsmudge = ${evil}\n`)
  return root
}

function bareAndClone(): { work: string; bare: string; clone: string } {
  const work = fullRepo('src')
  plain(work, 'commit', '-q', '-am', 'second')
  const bare = join(sandbox, 'src.git')
  plain(sandbox, 'clone', '-q', '--bare', work, bare)
  const clone = join(sandbox, 'clone')
  plain(sandbox, 'clone', '-q', `file://${slash(bare)}`, clone)
  return { work, bare, clone }
}

describe('H1: a driver named a=b', () => {
  test('plain git status runs it; runGit and execGitSync empty it through GIT_CONFIG_*', async () => {
    const root = filteredRepo('repo', 'a=b')
    plainTry(root, 'status', '--porcelain')
    expect(ran(), 'plain git must run the a=b filter, or this test proves nothing').toBe(true)

    reset()
    const status = await runGit(root, ['status', '--porcelain'])
    expect(status.ok, status.stderr).toBe(true)
    expect(status.stdout).toContain('a.txt')
    execGitSync(root, ['status', '--porcelain', '--no-renames'])
    expect(ran()).toBe(false)
  })
})

describe('L1: every command reads the config first', () => {
  test('ls-files -m runs a clean filter through plain git; not through runGit', async () => {
    const root = filteredRepo('repo')
    plainTry(root, 'ls-files', '-m')
    expect(ran()).toBe(true)

    reset()
    expect((await runGit(root, ['ls-files', '-m'])).stdout).toContain('a.txt')
    expect(ran()).toBe(false)
  })
})

describe('H2: core.alternateRefsCommand', () => {
  test('a plain fetch runs it; the person path refuses the repository', async () => {
    const { work, bare, clone } = bareAndClone()
    // Something new to fetch, so the negotiation (which lists the alternates' refs) runs.
    writeFileSync(join(work, 'b.txt'), 'b\n')
    plain(work, 'add', 'b.txt')
    plain(work, 'commit', '-q', '-m', 'third')
    plain(work, 'push', '-q', bare, 'main')
    const other = fullRepo('other')
    writeFileSync(join(clone, '.git', 'objects', 'info', 'alternates'), `${slash(join(other, '.git', 'objects'))}\n`)
    plain(clone, 'config', 'core.alternateRefsCommand', evilRun)
    plainTry(clone, 'fetch', '-q', 'origin')
    expect(ran(), 'plain git must run core.alternateRefsCommand on fetch').toBe(true)

    reset()
    plain(clone, 'update-ref', 'refs/remotes/origin/main', 'HEAD')
    const fetch = await runPersonGit(clone, ['fetch', 'origin'], { reason: 'git-panel:test-fetch' })
    expect(fetch.ok).toBe(false)
    expect(fetch.error).toBeInstanceOf(PersonGitRefused)
    expect(fetch.stderr).toContain('core.alternaterefscommand')
    expect(ran()).toBe(false)
  })
})

describe("H3: a person push to a local path would run the target's hooks", () => {
  function target(): string {
    const work = join(sandbox, 'src')
    const evilBare = join(sandbox, 'evil.git')
    plain(sandbox, 'clone', '-q', '--bare', work, evilBare)
    writeFileSync(join(evilBare, 'hooks', 'pre-receive'), `#!/bin/sh\n${evilRun}\n`, { mode: 0o755 })
    return evilBare
  }

  test('through remote.<name>.pushurl', async () => {
    const { clone } = bareAndClone()
    const evilBare = target()
    plain(clone, 'config', 'remote.origin.pushurl', slash(evilBare))
    plain(clone, 'commit', '-q', '--allow-empty', '-m', 'mine')
    plainTry(clone, 'push', '-q', 'origin', 'HEAD:refs/heads/plain')
    expect(ran(), "plain git push must run the target's pre-receive").toBe(true)

    reset()
    const push = await runPersonGit(clone, ['push', 'origin', 'HEAD:refs/heads/person'], { reason: 'git-panel:test-push' })
    expect(push.ok).toBe(false)
    expect(push.stderr).toMatch(/transport 'file' not allowed/i)
    expect(ran()).toBe(false)
  })

  test('through url.<target>.pushInsteadOf, with the remote URL unchanged', async () => {
    const { bare, clone } = bareAndClone()
    const evilBare = target()
    plain(clone, 'config', `url.${slash(evilBare)}.pushInsteadOf`, `file://${slash(bare)}`)
    plain(clone, 'commit', '-q', '--allow-empty', '-m', 'mine')
    expect(slash(plain(clone, 'remote', 'get-url', 'origin').trim())).toBe(`file://${slash(bare)}`)
    plainTry(clone, 'push', '-q', 'origin', 'HEAD:refs/heads/plain')
    expect(ran()).toBe(true)

    reset()
    const push = await runPersonGit(clone, ['push', 'origin', 'HEAD:refs/heads/person'], { reason: 'git-panel:test-push' })
    expect(push.ok).toBe(false)
    expect(ran()).toBe(false)
    // The confirm text resolves what git would use: the rewritten target, not the remote's own URL.
    expect(slash((await runGit(clone, ['remote', 'get-url', '--push', '--', 'origin'])).stdout.trim())).toBe(slash(evilBare))
  })

  test('fetch and clone over file:// still work on the person path', async () => {
    const { clone } = bareAndClone()
    expect((await runPersonGit(clone, ['fetch', 'origin'], { reason: 'git-panel:test-fetch' })).ok).toBe(true)
  })
})

describe('M1: check, then act', () => {
  /** A config read that saw nothing: what an agent gets by adding the driver right after main's read. */
  const blind: ConfigReader = async (...args) => (isConfigRead(args[1]) ? { code: 1, stdout: '' } : execConfigReader(...args))

  test('a driver added after the read runs in a repository never seen; one seen before is emptied anyway', async () => {
    const unseen = filteredRepo('unseen')
    await runGit(unseen, ['diff'], { readConfig: blind })
    expect(ran(), 'a blind read lets the driver run: the gap the remembered set closes').toBe(true)

    reset()
    const seen = filteredRepo('seen')
    await runGit(seen, ['status', '--porcelain'])
    expect(ran()).toBe(false)
    const diff = await runGit(seen, ['diff'], { readConfig: blind })
    expect(diff.stdout).toContain('+two')
    expect(ran()).toBe(false)
  })

  test('the config is read again after the command, and a key that appeared is flagged', async () => {
    const root = filteredRepo('repo')
    let calls = 0
    // The read sees nothing, and right after it the agent writes the config: what the stat afterwards catches.
    const late: ConfigReader = (...args) => {
      if (!isConfigRead(args[1]) || calls++ > 0) return execConfigReader(...args)
      appendFileSync(join(root, '.git', 'config'), `[filter "fresh"]\n\tclean = ${evil}\n`)
      return blind(...args)
    }
    const changes: string[][] = []
    const stop = onRepositoryConfigChanged(change => changes.push(change.keys))
    try {
      const result = await runGit(root, ['status', '--porcelain'], { readConfig: late })
      expect(result.configChanged).toEqual(expect.arrayContaining(['filter.agent.clean', 'filter.agent.smudge']))
      expect(changes).toHaveLength(1)
    } finally { stop() }
    // From now on the driver is remembered, even through a blind read.
    reset()
    await runGit(root, ['diff'], { readConfig: blind })
    expect(ran()).toBe(false)
  })
})

describe("M2: gh's own git", () => {
  const real = (command: string, args: string[], options: SpawnAsyncOptions): Promise<SpawnResult> => new Promise(resolve => {
    execFile(command, args, { cwd: options.cwd, env: options.env, encoding: 'utf8', windowsHide: true }, (error, stdout, stderr) => {
      resolve({ stdout: String(stdout), stderr: String(stderr), status: error ? (typeof error.code === 'number' ? error.code : 1) : 0, error: undefined })
    })
  })
  /** gh answers its own probes; the gh call itself does what `gh pr create` does first: `git status` with gh's env. */
  const fakeGh = async (command: string, args: string[], options: SpawnAsyncOptions): Promise<SpawnResult> => {
    if (command !== 'gh') return real(command, args, options)
    if (args[0] === '--version' || args[0] === 'auth') return { stdout: '', stderr: '', status: 0 }
    if (args[0] === 'api') return { stdout: 'tester\n', stderr: '', status: 0 }
    return real('git', ['status', '--porcelain'], options)
  }

  test("plain gh env lets gh's git status run the filter; runGh empties it", async () => {
    const root = filteredRepo('repo')
    await real('git', ['status', '--porcelain'], { cwd: root, env: ghEnv() })
    expect(ran(), "gh's git status with the fixed gh env alone must run the filter").toBe(true)

    reset()
    await new GhExec({ spawnCommand: fakeGh }).runGh(['pr', 'create'], root)
    expect(ran()).toBe(false)
  })

  test('runGh refuses a repository that sets its own ssh command', async () => {
    const root = fullRepo()
    plain(root, 'config', 'core.sshCommand', evilRun)
    await expect(new GhExec({ spawnCommand: fakeGh }).runGh(['pr', 'list'], root)).rejects.toBeInstanceOf(PersonGitRefused)
  })
})

describe('the config read cache', () => {
  test('a rewrite with the same size and the mtime set back is read again on the next call, and its driver emptied', async () => {
    const root = fullRepo('cached')
    writeFileSync(join(root, '.gitattributes'), '*.txt filter=agent\n')
    writeFileSync(join(root, 'c.txt'), 'abc\n')
    plain(root, 'add', 'c.txt', '.gitattributes')
    plain(root, 'commit', '-q', '-m', 'c')
    const config = join(root, '.git', 'config')
    // A placeholder as long as the driver the agent will write, so the rewrite keeps the size.
    const driver = `[filter "agent"]\n\tclean = ${evil}\n`
    appendFileSync(config, `[pad]\n\tx = ${'x'.repeat(driver.length - '[pad]\n\tx = \n'.length)}\n`)
    // A whole-second mtime, so setting it back after the rewrite gives exactly the same value.
    const mtime = new Date(Math.floor(Date.now() / 1000) * 1000 - 60_000)
    utimesSync(config, mtime, mtime)
    let reads = 0
    const counting: ConfigReader = (...args) => { if (isConfigRead(args[1])) reads++; return execConfigReader(...args) }

    await runGit(root, ['status', '--porcelain'], { readConfig: counting })
    await runGit(root, ['status', '--porcelain'], { readConfig: counting })
    expect(reads, 'an unchanged config is read once').toBe(1)

    const before = statSync(config)
    const text = readFileSync(config, 'utf8')
    const rewritten = text.replace(/\[pad\]\n\tx = x+\n/, driver)
    expect(rewritten.length).toBe(text.length)
    writeFileSync(config, rewritten)
    utimesSync(config, mtime, mtime)
    expect(statSync(config).mtimeMs).toBe(before.mtimeMs)
    expect(statSync(config).size).toBe(before.size)

    writeFileSync(join(root, 'c.txt'), 'xyz\n')
    utimesSync(join(root, 'c.txt'), new Date(Date.now() + 9000), new Date(Date.now() + 9000))
    plainTry(root, 'status', '--porcelain')
    expect(ran(), 'plain git runs the rewritten driver').toBe(true)

    reset()
    utimesSync(join(root, 'c.txt'), new Date(Date.now() + 20000), new Date(Date.now() + 20000))
    await runGit(root, ['status', '--porcelain'], { readConfig: counting })
    expect(reads, 'the rewrite is seen: ctime moved').toBe(2)
    expect(ran()).toBe(false)
  })
})

describe('round 3: N1, N2 and the linked worktree', () => {
  const blind: ConfigReader = async (...args) => (isConfigRead(args[1]) ? { code: 1, stdout: '' } : execConfigReader(...args))

  test("N1: gh's git may not push to a local path, whose hooks would run", async () => {
    const { clone } = bareAndClone()
    const evilBare = join(sandbox, 'evil.git')
    plain(sandbox, 'clone', '-q', '--bare', join(sandbox, 'src'), evilBare)
    writeFileSync(join(evilBare, 'hooks', 'pre-receive'), `#!/bin/sh\n${evilRun}\n`, { mode: 0o755 })
    plain(clone, 'config', 'remote.origin.pushurl', slash(evilBare))
    plain(clone, 'commit', '-q', '--allow-empty', '-m', 'mine')
    const push = (env: NodeJS.ProcessEnv) => new Promise<number>(resolve => execFile('git', ['push', '-q', 'origin', 'HEAD:refs/heads/gh'], { cwd: clone, env, windowsHide: true }, error => resolve(error ? 1 : 0)))
    await push(plainEnv)
    expect(ran(), "a push with main's env must run the target's pre-receive").toBe(true)

    reset()
    expect(await push(ghEnv())).toBe(1)
    expect(ran()).toBe(false)
  })

  test('N2: the person path reads the config again after the command and flags a new key', async () => {
    const { clone } = bareAndClone()
    appendFileSync(join(clone, '.git', 'config'), `[filter "late"]\n\tclean = ${evil}\n`)
    let calls = 0
    const late: ConfigReader = (...args) => (isConfigRead(args[1]) && calls++ === 0 ? blind(...args) : execConfigReader(...args))
    const changes: string[][] = []
    const stop = onRepositoryConfigChanged(change => changes.push(change.keys))
    try {
      const fetch = await runPersonGit(clone, ['fetch', 'origin'], { reason: 'git-panel:test-fetch' }, { readConfig: late })
      expect(fetch.ok, fetch.stderr).toBe(true)
      expect(changes).toEqual([['filter.late.clean']])
    } finally { stop() }
  })

  test('a driver seen in the main checkout is emptied in its linked worktree too (common git dir)', async () => {
    const root = fullRepo('main-checkout')
    writeFileSync(join(root, 'c.txt'), 'abc\n')
    plain(root, 'add', 'c.txt')
    plain(root, 'commit', '-q', '-m', 'c')
    const linked = join(sandbox, 'linked')
    plain(root, 'worktree', 'add', '-q', linked)
    appendFileSync(join(root, '.git', 'config'), `[filter "agent"]\n\tclean = ${evil}\n\tsmudge = ${evil}\n`)
    for (const tree of [root, linked]) writeFileSync(join(tree, '.gitattributes'), '*.txt filter=agent\n')
    const touchC = (tree: string) => { writeFileSync(join(tree, 'c.txt'), 'xyz\n'); utimesSync(join(tree, 'c.txt'), new Date(Date.now() + 9000), new Date(Date.now() + 9000)) }
    touchC(linked)
    plainTry(linked, 'status', '--porcelain')
    expect(ran(), 'the shared config reaches the linked worktree').toBe(true)

    reset()
    touchC(root)
    await runGit(root, ['status', '--porcelain'])
    expect(ran()).toBe(false)
    utimesSync(join(linked, 'c.txt'), new Date(Date.now() + 20000), new Date(Date.now() + 20000))
    await runGit(linked, ['status', '--porcelain'], { readConfig: blind })
    expect(ran(), 'seen in the main checkout, so emptied in the linked one even through a blind read').toBe(false)
  })
})

describe('re-check 3: the cache stamps what git read, and git finds the dirs', () => {
  // Git never looks above the sandbox, and HOME is an empty folder in it: no test touches a config outside the sandbox.
  const saved: Record<string, string | undefined> = {}
  let env: NodeJS.ProcessEnv
  beforeEach(() => {
    const home = join(sandbox, 'home')
    mkdirSync(home)
    for (const name of ['GIT_CEILING_DIRECTORIES', 'HOME', 'USERPROFILE', 'XDG_CONFIG_HOME']) saved[name] = process.env[name]
    process.env.GIT_CEILING_DIRECTORIES = sandbox
    process.env.HOME = home
    process.env.USERPROFILE = home
    delete process.env.XDG_CONFIG_HOME
    env = { ...plainEnv, GIT_CEILING_DIRECTORIES: sandbox, HOME: home, USERPROFILE: home }
    delete env.XDG_CONFIG_HOME
  })
  afterEach(() => {
    for (const [name, value] of Object.entries(saved)) { if (value === undefined) delete process.env[name]; else process.env[name] = value }
  })
  const git = (cwd: string, ...args: string[]): string => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  const gitTry = (cwd: string, ...args: string[]): void => { try { git(cwd, ...args) } catch { /* the vector's own failure is fine */ } }
  let reads = 0
  const counting: ConfigReader = (...args) => { if (isConfigRead(args[1])) reads++; return execConfigReader(...args) }
  beforeEach(() => { reads = 0 })

  /** A repository whose `.txt` files go through filter `x`, which its config does not define (yet). */
  function attributed(name: string): string {
    const root = join(sandbox, name)
    mkdirSync(root, { recursive: true })
    git(root, 'init', '-q', '-b', 'main')
    writeFileSync(join(root, '.gitattributes'), '*.txt filter=x\n')
    writeFileSync(join(root, 'c.txt'), 'abc\n')
    git(root, 'add', '.')
    git(root, 'commit', '-q', '-m', 'c')
    return root
  }
  /** A same-size change with a later mtime: git must hash c.txt again, through the clean filter. */
  let shift = 9000
  const touch = (root: string) => { writeFileSync(join(root, 'c.txt'), 'xyz\n'); shift += 9000; utimesSync(join(root, 'c.txt'), new Date(Date.now() + shift), new Date(Date.now() + shift)) }
  const driver = () => `[filter "x"]\n\tclean = ${evil}\n\tsmudge = ${evil}\n`

  test('F1: an includeIf "onbranch:" that a checkout turns on is read again (HEAD is stamped)', async () => {
    const root = attributed('onbranch')
    appendFileSync(join(root, '.git', 'config'), '[includeIf "onbranch:evil"]\n\tpath = evil.cfg\n')
    writeFileSync(join(root, '.git', 'evil.cfg'), driver())
    for (let call = 0; call < 3; call++) await runGit(root, ['status', '--porcelain'], { readConfig: counting })
    // The first read names evil.cfg, not stamped before it, so the second reads again; then it holds while on main.
    expect(reads, 'on main the include is off, and the read holds').toBe(2)

    git(root, 'checkout', '-q', '-b', 'evil')
    reset()
    touch(root)
    gitTry(root, 'status', '--porcelain')
    expect(ran(), 'on branch evil plain git runs the included driver').toBe(true)

    reset()
    touch(root)
    await runGit(root, ['status', '--porcelain'], { readConfig: counting })
    expect(reads, 'the checkout moved HEAD: read again').toBe(3)
    expect(ran()).toBe(false)
  })

  test('F2: a nested include is stamped where git looks for it, even before it exists', async () => {
    const root = attributed('nested')
    mkdirSync(join(root, '.git', 'sub'))
    appendFileSync(join(root, '.git', 'config'), '[include]\n\tpath = sub/a.cfg\n')
    // Relative to sub/a.cfg, so .git/sub/b.cfg; .git/b.cfg is the wrong place.
    writeFileSync(join(root, '.git', 'sub', 'a.cfg'), '[include]\n\tpath = b.cfg\n')
    for (let call = 0; call < 3; call++) await runGit(root, ['status', '--porcelain'], { readConfig: counting })
    // The first read finds sub/a.cfg and b.cfg, not stamped before it, so the second reads again; then it holds.
    expect(reads).toBe(2)

    writeFileSync(join(root, '.git', 'sub', 'b.cfg'), driver())
    touch(root)
    gitTry(root, 'status', '--porcelain')
    expect(ran(), 'plain git runs the driver from the nested include').toBe(true)

    reset()
    touch(root)
    await runGit(root, ['status', '--porcelain'], { readConfig: counting })
    expect(reads).toBe(3)
    expect(ran()).toBe(false)
    // And a rewrite of the nested file once it exists is seen too.
    reset()
    appendFileSync(join(root, '.git', 'sub', 'b.cfg'), `[filter "y"]\n\tclean = ${evil}\n`)
    writeFileSync(join(root, '.gitattributes'), '*.txt filter=y\n')
    touch(root)
    await runGit(root, ['status', '--porcelain'], { readConfig: counting })
    expect(reads).toBe(4)
    expect(ran()).toBe(false)
  })

  /** A bare repository at `path` holding c.txt, whose `info/attributes` sends `.txt` through filter `x`. */
  function bare(path: string): string {
    const source = attributed(`source-${Math.random().toString(36).slice(2)}`)
    git(sandbox, 'clone', '-q', '--bare', source, path)
    writeFileSync(join(path, 'info', 'attributes'), '*.txt filter=x\n')
    return path
  }
  /** `cat-file --filters` runs the smudge filter, in a bare repository too. */
  const smudge = ['cat-file', '--filters', 'HEAD:c.txt']

  async function bareVector(repo: string) {
    gitTry(repo, ...smudge)
    expect(ran(), 'no driver yet').toBe(false)
    await runGit(repo, smudge, { readConfig: counting })
    await runGit(repo, smudge, { readConfig: counting })
    expect(reads, 'a bare repository is never kept: read on every call').toBe(2)

    appendFileSync(join(repo, 'config'), driver())
    gitTry(repo, ...smudge)
    expect(ran(), 'plain git runs the bare repository\'s smudge driver').toBe(true)
    reset()
    const result = await runGit(repo, smudge, { readConfig: counting })
    expect(result.ok, result.stderr).toBe(true)
    expect(reads).toBe(3)
    expect(ran()).toBe(false)
    expect(slash(commonGitDir(repo)).toLowerCase(), 'git found the bare repository itself').toBe(slash(repo).toLowerCase())
  }

  test('F3: a bare repository is its own git dir and is read on every call', async () => {
    await bareVector(bare(join(sandbox, 'bare.git')))
  })

  test('F3: a bare repository inside another checkout never takes that checkout\'s config', async () => {
    const outer = join(sandbox, 'outer')
    mkdirSync(outer)
    git(outer, 'init', '-q', '-b', 'main')
    // The walk up by hand found outer/.git from outer/inner.git and stamped its config instead.
    await bareVector(bare(join(outer, 'inner.git')))
  })
})

describe('condition (b): only repository scopes refuse', () => {
  test("the person's global credential helper does not refuse a person fetch", async () => {
    const { clone } = bareAndClone()
    const home = join(sandbox, 'home')
    mkdirSync(home)
    writeFileSync(join(home, '.gitconfig'), `[credential]\n\thelper = ${evil}\n[core]\n\tsshCommand = ssh\n`)
    const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME }
    process.env.HOME = home
    process.env.USERPROFILE = home
    delete process.env.XDG_CONFIG_HOME
    try {
      expect((await runGit(clone, ['config', '--global', '--get', 'credential.helper'])).stdout.trim()).toBe(evil)
      const fetch = await runPersonGit(clone, ['fetch', 'origin'], { reason: 'git-panel:test-fetch' })
      expect(fetch.ok, fetch.stderr).toBe(true)
    } finally {
      for (const [name, value] of Object.entries(saved)) { if (value === undefined) delete process.env[name]; else process.env[name] = value }
    }
  })
})
