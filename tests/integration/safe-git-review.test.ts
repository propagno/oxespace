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
import { __forgetSeenDriversForTests, execConfigReader, execGitSync, ghEnv, onRepositoryConfigChanged, runGit, type ConfigReader } from '../../electron/main/utils/safe-git'
import { PersonGitRefused, runPersonGit } from '../../electron/main/utils/safe-git-person'
import { GhExec, type SpawnAsyncOptions, type SpawnResult } from '../../electron/main/services/github/gh-exec'

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const plainEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^GIT_/i.test(name)))
const plain = (cwd: string, ...args: string[]): string => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, env: plainEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const plainTry = (cwd: string, ...args: string[]): void => { try { plain(cwd, ...args) } catch { /* the vector's own failure is fine */ } }
const slash = (path: string) => path.replace(/\\/g, '/')

let sandbox: string, marker: string, evil: string, evilRun: string, evilScript: string
beforeEach(() => {
  __forgetSeenDriversForTests()
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
  const blind: ConfigReader = async () => ({ code: 1, stdout: '' })

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
      if (calls++ > 0) return execConfigReader(...args)
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
    const counting: ConfigReader = (...args) => { reads++; return execConfigReader(...args) }

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
  const blind: ConfigReader = async () => ({ code: 1, stdout: '' })

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
    const late: ConfigReader = (...args) => (calls++ === 0 ? blind(...args) : execConfigReader(...args))
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
