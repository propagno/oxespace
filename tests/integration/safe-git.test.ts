// @vitest-environment node
/**
 * electron/main/utils/safe-git.ts against real git: each vector first runs through plain git and leaves its marker
 * (so the test can fail), then through the module and does not. The person path still clones and fetches over
 * file://, and refuses a repository that names its own ssh command.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { __forgetSeenDriversForTests, displayKey, execGit, execGitSync, ghEnv, needsConfigProbe, neutralizeRepositoryCommands, parseConfigEntries, runGit, safeGitArgs, safeGitEnv, SAFE_GIT_OPTIONS } from '../../electron/main/utils/safe-git'
import { PersonGitRefused, runPersonGit } from '../../electron/main/utils/safe-git-person'

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

/** The test's own environment without GIT_*: plain git as a person's shell would run it. */
const plainEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^GIT_/i.test(name)))
const plain = (cwd: string, ...args: string[]): string => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, env: plainEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const plainTry = (cwd: string, ...args: string[]): void => { try { plain(cwd, ...args) } catch { /* the vector's own failure is fine */ } }
const slash = (path: string) => path.replace(/\\/g, '/')

let sandbox: string
let marker: string
/** A shell command (git runs these through sh) that appends to the marker and fails. */
let evil: string

beforeEach(() => {
  sandbox = realpathSync.native(mkdtempSync(join(tmpdir(), 'oxe-safegit-')))
  marker = join(sandbox, 'MARKER')
  const script = join(sandbox, 'evil.sh')
  // Executable: gpg.program runs it as a program, not through sh (Linux checks the mode).
  writeFileSync(script, `#!/bin/sh\necho "ran $0 $*" >> '${slash(marker)}'\nexit 1\n`, { mode: 0o755 })
  evil = `sh '${slash(script)}'`
})

afterEach(() => {
  try { rmSync(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) } catch { /* temp dir */ }
})

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

function bareSource(): { bare: string; blob: string } {
  const work = fullRepo('src')
  plain(work, 'commit', '-q', '-am', 'second')
  const bare = join(sandbox, 'src.git')
  plain(sandbox, 'clone', '-q', '--bare', work, bare)
  plain(bare, 'config', 'uploadpack.allowFilter', 'true')
  plain(bare, 'config', 'uploadpack.allowAnySHA1InWant', 'true')
  return { bare, blob: plain(bare, 'rev-parse', 'HEAD:a.txt').trim() }
}

describe('the vectors, through plain git and through safe-git', () => {
  test('a partial clone lazy-fetches through core.sshCommand; runGit reads without fetching', async () => {
    const { bare, blob } = bareSource()
    const part = join(sandbox, 'part')
    plain(sandbox, 'clone', '-q', '--filter=blob:none', '--no-checkout', `file://${slash(bare)}`, part)
    // The agent's repository: its promisor remote is over ssh, which runs a command it chose.
    plain(part, 'remote', 'set-url', 'origin', 'ssh://attacker.invalid/repo.git')
    plain(part, 'config', 'core.sshCommand', evil)
    plain(part, 'config', 'protocol.ssh.allow', 'always')
    expect(ran()).toBe(false)

    plainTry(part, 'cat-file', '-p', blob)
    expect(ran(), 'plain git must lazy-fetch, or this test proves nothing').toBe(true)

    reset()
    const result = await runGit(part, ['cat-file', '-p', blob])
    expect(result.ok).toBe(false)
    expect(ran()).toBe(false)
    expect(() => execGitSync(part, ['cat-file', '-p', blob])).toThrow()
    expect(ran()).toBe(false)
  })

  test('core.fsmonitor runs on a plain status; not through runGit', async () => {
    const root = fullRepo()
    plain(root, 'config', 'core.fsmonitor', evil)
    plainTry(root, 'status', '--porcelain')
    expect(ran()).toBe(true)

    reset()
    const status = await runGit(root, ['status', '--porcelain'])
    expect(status.ok).toBe(true)
    expect(status.stdout).toContain('a.txt')
    expect(ran()).toBe(false)
  })

  test('a hook runs on a plain commit and branch; not through runGit', async () => {
    const root = fullRepo()
    for (const hook of ['pre-commit', 'reference-transaction', 'post-checkout']) writeFileSync(join(root, '.git', 'hooks', hook), `#!/bin/sh\n${evil}\n`, { mode: 0o755 })
    plainTry(root, 'branch', 'plain-branch')
    expect(ran()).toBe(true)

    reset()
    expect((await runGit(root, ['branch', 'safe-branch'])).ok).toBe(true)
    expect((await runGit(root, ['commit', '-q', '-am', 'safe'])).ok).toBe(true)
    expect((await runGit(root, ['switch', '-q', 'safe-branch'])).ok).toBe(true)
    expect(ran()).toBe(false)
    expect(plain(root, 'log', '-1', '--format=%s', 'main').trim()).toBe('safe')
  })

  test('core.hooksPath set by the repository is replaced too', async () => {
    const root = fullRepo()
    const hooks = join(sandbox, 'agent-hooks')
    mkdirSync(hooks)
    writeFileSync(join(hooks, 'pre-commit'), `#!/bin/sh\n${evil}\n`, { mode: 0o755 })
    plain(root, 'config', 'core.hooksPath', slash(hooks))
    plainTry(root, 'commit', '-q', '-am', 'plain')
    expect(ran()).toBe(true)

    reset()
    expect((await runGit(root, ['commit', '-q', '--allow-empty', '-m', 'safe'])).ok).toBe(true)
    expect(ran()).toBe(false)
  })

  test("a repository's filter driver runs on a plain diff; runGit empties it and the diff still reads", async () => {
    const root = fullRepo()
    writeFileSync(join(root, '.gitattributes'), '*.txt filter=agent\n')
    plain(root, 'config', 'filter.agent.clean', evil)
    plain(root, 'config', 'filter.agent.smudge', evil)
    plainTry(root, 'diff')
    expect(ran()).toBe(true)

    reset()
    const diff = await runGit(root, ['diff', '--', 'a.txt'])
    expect(diff.ok).toBe(true)
    expect(diff.stdout).toContain('+two')
    expect((await runGit(root, ['add', 'a.txt'])).ok).toBe(true)
    expect(ran()).toBe(false)
  })

  test('a diff driver (external command and textconv) runs on a plain diff; not through runGit', async () => {
    const root = fullRepo()
    writeFileSync(join(root, '.gitattributes'), '*.txt diff=agent\n')
    plain(root, 'config', 'diff.agent.command', evil)
    plain(root, 'config', 'diff.agent.textconv', evil)
    plainTry(root, 'diff')
    expect(ran()).toBe(true)

    reset()
    expect((await runGit(root, ['diff'])).stdout).toContain('+two')
    expect((await runGit(root, ['log', '-p', '-1'])).ok).toBe(true)
    expect((await runGit(root, ['show', 'HEAD'])).ok).toBe(true)
    expect(ran()).toBe(false)
  })

  test('a signing program the repository names is not run by a commit', async () => {
    const root = fullRepo()
    plain(root, 'config', 'commit.gpgSign', 'true')
    // gpg.program runs as a program, not through sh: the script itself.
    plain(root, 'config', 'gpg.program', slash(join(sandbox, 'evil.sh')))
    plainTry(root, 'commit', '-q', '-am', 'plain')
    expect(ran()).toBe(true)

    reset()
    await runGit(root, ['commit', '-q', '--allow-empty', '-m', 'safe'])
    expect(ran()).toBe(false)
  })

  test("main's GIT_* variables do not reach git", async () => {
    const root = fullRepo()
    const other = fullRepo('other')
    const saved = { dir: process.env.GIT_DIR, ssh: process.env.GIT_SSH_COMMAND }
    process.env.GIT_DIR = join(other, '.git')
    process.env.GIT_SSH_COMMAND = evil
    try {
      const top = await execGit(root, ['rev-parse', '--show-toplevel'])
      expect(slash(top.stdout.trim()).toLowerCase()).toBe(slash(root).toLowerCase())
    } finally {
      if (saved.dir === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = saved.dir
      if (saved.ssh === undefined) delete process.env.GIT_SSH_COMMAND; else process.env.GIT_SSH_COMMAND = saved.ssh
    }
  })

  test('the local path has no transport: a file:// fetch fails', async () => {
    const { bare } = bareSource()
    const clone = join(sandbox, 'clone')
    plain(sandbox, 'clone', '-q', `file://${slash(bare)}`, clone)
    const fetch = await runGit(clone, ['fetch', 'origin'])
    expect(fetch.ok).toBe(false)
    expect(fetch.stderr).toMatch(/transport 'file' not allowed|not allowed/i)
  })
})

describe('normal reads in a full repository', () => {
  test('status, log, diff and show return what plain git does', async () => {
    const root = fullRepo()
    const status = await runGit(root, ['status', '--porcelain=v2', '--branch', '-z'])
    expect(status.stdout).toContain('# branch.head main')
    expect(status.stdout).toContain('a.txt')
    expect((await runGit(root, ['log', '-1', '--format=%s'])).stdout.trim()).toBe('first')
    expect((await runGit(root, ['diff', '--numstat'])).stdout.trim()).toBe(plain(root, 'diff', '--numstat').trim())
    expect((await runGit(root, ['show', 'HEAD:a.txt'])).stdout).toBe('one\n')
    expect((await runGit(root, ['-c', 'core.quotePath=false', 'ls-files'])).stdout.trim()).toBe('a.txt')
    expect(execGitSync(root, ['branch', '--show-current']).trim()).toBe('main')
    expect((await execGit(root, ['show', 'HEAD:a.txt'], { encoding: 'buffer' })).stdout).toEqual(Buffer.from('one\n'))
    // git --version needs no repository and no subcommand.
    expect((await runGit(root, ['--version'])).stdout).toMatch(/^git version /)
  })

  test('rev-parse --git-path hooks keeps the repository answer when asked', () => {
    const root = fullRepo()
    expect(slash(execGitSync(root, ['rev-parse', '--git-path', 'hooks'], { asksHooksPath: true }).trim())).toMatch(/\.git\/hooks$/)
  })
})

describe('the person path', () => {
  test('clones and fetches over file://, transports on, hooks still off', async () => {
    const { bare } = bareSource()
    const clone = join(sandbox, 'clone')
    const cloned = await runPersonGit(sandbox, ['clone', '-q', `file://${slash(bare)}`, clone], { reason: 'git-panel:test-clone' })
    expect(cloned.ok, cloned.stderr).toBe(true)
    expect(readFileSync(join(clone, 'a.txt'), 'utf8').replace(/\r\n/g, '\n')).toBe('one\ntwo\n')

    writeFileSync(join(clone, '.git', 'hooks', 'reference-transaction'), `#!/bin/sh\n${evil}\n`, { mode: 0o755 })
    const fetched = await runPersonGit(clone, ['fetch', '--prune', 'origin'], { reason: 'git-panel:test-fetch' })
    expect(fetched.ok, fetched.stderr).toBe(true)
    const pulled = await runPersonGit(clone, ['pull', '--ff-only'], { reason: 'git-panel:test-pull' })
    expect(pulled.ok, pulled.stderr).toBe(true)
    expect(ran()).toBe(false)
  })

  test("refuses a repository that sets its own ssh command, credential helper or upload-pack", async () => {
    const { bare } = bareSource()
    const clone = join(sandbox, 'clone')
    plain(sandbox, 'clone', '-q', `file://${slash(bare)}`, clone)
    for (const [key, value] of [['core.sshCommand', evil], ['credential.helper', `!${evil}`], ['remote.origin.uploadpack', evil], ['lfs.customtransfer.agent.path', evil]]) {
      plain(clone, 'config', key, value)
      const result = await runPersonGit(clone, ['fetch', 'origin'], { reason: 'git-panel:test-fetch' })
      expect(result.ok).toBe(false)
      expect(result.error).toBeInstanceOf(PersonGitRefused)
      expect(result.stderr).toContain(key.toLowerCase().replace(/^remote\.origin\./, 'remote.origin.'))
      plain(clone, 'config', '--unset', key)
    }
    expect(ran()).toBe(false)
  })

  test('needs a reason', async () => {
    const root = fullRepo()
    const result = await runPersonGit(root, ['fetch'], { reason: '' as never })
    expect(result.ok).toBe(false)
    expect(result.stderr).toMatch(/needs its reason/)
  })
})

describe('the pieces', () => {
  test('safeGitEnv drops every GIT_* and sets the guards', () => {
    const env = safeGitEnv({ PATH: '/bin', HOME: '/home/p', GIT_DIR: '/x', git_exec_path: '/y', GIT_SSH_COMMAND: 'evil', GIT_CONFIG_PARAMETERS: "'core.fsmonitor'='evil'", GIT_CEILING_DIRECTORIES: '/c' })
    expect(env).toEqual({ PATH: '/bin', HOME: '/home/p', GIT_CEILING_DIRECTORIES: '/c', GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_LFS_SKIP_SMUDGE: '1', GIT_EDITOR: 'false', GIT_SEQUENCE_EDITOR: 'false' })
    expect(safeGitEnv({ PATH: '/bin' }, { systemConfig: true }).GIT_CONFIG_NOSYSTEM).toBeUndefined()
  })

  test('ghEnv passes git options as GIT_CONFIG_*, keeps transports, drops main GIT_* and appends the extra pairs', () => {
    const env = ghEnv({ PATH: '/bin', GIT_DIR: '/x', GH_TOKEN: 'kept' }, [['filter.a=b.clean', '']])
    expect(env.GIT_DIR).toBeUndefined()
    expect(env.GH_TOKEN).toBe('kept')
    const pairs = Array.from({ length: Number(env.GIT_CONFIG_COUNT) }, (_, i) => [env[`GIT_CONFIG_KEY_${i}`], env[`GIT_CONFIG_VALUE_${i}`]])
    expect(pairs).toEqual(expect.arrayContaining([['core.fsmonitor', ''], ['protocol.ext.allow', 'never'], ['diff.external', ''], ['core.alternateRefsCommand', ''], ['filter.a=b.clean', '']]))
    expect(pairs.some(([key]) => String(key).startsWith('protocol.https'))).toBe(false)
  })

  test('safeGitArgs prefixes the options and adds the diff and submodule guards after the subcommand', () => {
    expect(safeGitArgs(['-c', 'core.quotePath=false', 'status', '-z'])).toEqual([...SAFE_GIT_OPTIONS, '-c', 'core.quotePath=false', 'status', '--ignore-submodules=dirty', '-z'])
    expect(safeGitArgs(['--no-pager', 'diff', 'HEAD'])).toEqual([...SAFE_GIT_OPTIONS, '--no-pager', 'diff', '--no-ext-diff', '--no-textconv', '--ignore-submodules=dirty', 'HEAD'])
    expect(safeGitArgs(['rev-parse', 'HEAD'])).toEqual([...SAFE_GIT_OPTIONS, 'rev-parse', 'HEAD'])
    for (const name of ['ext', 'file', 'ssh', 'git', 'http', 'https']) expect(SAFE_GIT_OPTIONS).toContain(`protocol.${name}.allow=never`)
  })

  test('L1: every command reads the config first except the ones that run nothing', () => {
    for (const args of [['status'], ['log', '-1'], ['show', 'HEAD'], ['diff-files'], ['diff-index', 'HEAD'], ['describe', '--dirty'], ['blame', 'a'], ['archive', 'HEAD'], ['grep', 'x'], ['ls-files', '-m'], ['ls-files', '--deleted'], ['cat-file', '--filters', 'HEAD:a'], ['cat-file', '--textconv', 'HEAD:a'], ['worktree', 'add', 'x']]) {
      expect(needsConfigProbe(args), args.join(' ')).toBe(true)
    }
    for (const args of [['rev-parse', 'HEAD'], ['config', '--get', 'x'], ['for-each-ref'], ['ls-files', '-z', '-c'], ['ls-files', '-o', '--exclude-standard'], ['cat-file', '-e', 'HEAD'], ['--version'], ['branch', '--show-current']]) {
      expect(needsConfigProbe(args), args.join(' ')).toBe(false)
    }
  })

  test('only repository scopes are neutralized, as separate key and value, and the stock LFS filter is kept', () => {
    __forgetSeenDriversForTests()
    const entries = parseConfigEntries([
      'system\0filter.lfs.clean\ngit-lfs clean -- %f', 'local\0filter.lfs.process\ngit-lfs filter-process', 'local\0filter.Agent.clean\nevil',
      'global\0gpg.program\nC:/gpg/gpg.exe', 'local\0gpg.program\nevil', 'worktree\0gpg.ssh.defaultkeycommand\nevil',
      'local\0diff.d.textconv\nevil', 'local\0merge.m.driver\nevil', 'local\0submodule.s.update\n!evil', 'global\0filter.mine.clean\nmine', ''
    ].join('\0'))
    expect(entries).toHaveLength(10)
    expect(neutralizeRepositoryCommands(entries)).toEqual([
      ['gpg.program', 'C:/gpg/gpg.exe'], ['submodule.s.update', 'none'],
      ['filter.Agent.clean', ''], ['filter.Agent.smudge', ''], ['filter.Agent.process', ''], ['filter.Agent.required', 'false'],
      ['diff.d.command', ''], ['diff.d.textconv', ''], ['merge.m.driver', 'false'],
      ['commit.gpgSign', 'false'], ['tag.gpgSign', 'false']
    ])
    // An LFS extension runs inside git-lfs's own clean: the stock LFS filter is emptied with it.
    expect(neutralizeRepositoryCommands(parseConfigEntries('system\0filter.lfs.clean\ngit-lfs clean -- %f\0local\0lfs.extension.agent.clean\nevil\0'))).toContainEqual(['filter.lfs.clean', ''])
  })

  test('L5: a key a repository chose is shown without control or bidi characters, bounded', () => {
    expect(displayKey('remote.a\u202eb\u0007c.uploadpack')).toBe('remote.a?b?c.uploadpack')
    expect(displayKey('x'.repeat(200))).toHaveLength(80)
    const refused = new PersonGitRefused(['remote.\u202eevil\n.uploadpack'], 'git-panel:test')
    expect(refused.message.split('\n')[0]).not.toMatch(/[\u202e\n]/)
    expect(refused.messageCode).toEqual({ code: 'git.person.refused', params: { keys: ['remote.?evil?.uploadpack'] } })
  })
})
