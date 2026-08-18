import { delimiter } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { applyLoginShellPath, mergePath, readLoginShellPath } from '../../electron/main/utils/login-shell-path'

const SESSION_PATH = ['/usr/local/bin', '/usr/bin', '/bin'].join(delimiter)
const LOGIN_PATH = ['/home/dev/.local/bin', '/home/dev/.npm-global/bin', '/usr/bin', '/bin'].join(delimiter)

function fakeRun(result: Partial<{ stdout: string; status: number | null; error: Error }>) {
  return vi.fn().mockReturnValue({ stdout: '', stderr: '', status: 0, error: undefined, ...result }) as never
}

describe('readLoginShellPath', () => {
  test('asks the login shell and returns what it prints', () => {
    const run = fakeRun({ stdout: LOGIN_PATH })
    const value = readLoginShellPath({ platform: 'linux', env: { SHELL: '/bin/bash' }, run })

    expect(value).toBe(LOGIN_PATH)
    const [shell, args, options] = (run as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]
    expect(shell).toBe('/bin/bash')
    // -l sources the profile. NOT -i: an interactive shell can block forever on
    // a profile that expects a terminal, and this runs during startup.
    expect(args).toEqual(['-lc', 'printf %s "$PATH"'])
    expect(options).toMatchObject({ timeout: 3_000, stdio: ['ignore', 'pipe', 'ignore'] })
  })

  test('is a no-op on Windows, where every process already gets the same PATH', () => {
    const run = fakeRun({ stdout: LOGIN_PATH })
    expect(readLoginShellPath({ platform: 'win32', env: { SHELL: '/bin/bash' }, run })).toBeNull()
    expect(run).not.toHaveBeenCalled()
  })

  test('gives up quietly when there is no shell to ask', () => {
    const run = fakeRun({ stdout: LOGIN_PATH })
    expect(readLoginShellPath({ platform: 'linux', env: {}, run })).toBeNull()
    expect(run).not.toHaveBeenCalled()
  })

  test.each([
    ['the probe times out', { error: new Error('ETIMEDOUT'), status: null }],
    ['the shell exits non-zero', { status: 1 }],
    ['the shell prints nothing', { stdout: '   ' }]
  ])('returns null when %s', (_label, result) => {
    expect(readLoginShellPath({ platform: 'linux', env: { SHELL: '/bin/zsh' }, run: fakeRun(result) })).toBeNull()
  })
})

describe('mergePath', () => {
  test('keeps current entries first so an explicit PATH still wins', () => {
    expect(mergePath(SESSION_PATH, LOGIN_PATH).split(delimiter)).toEqual([
      '/usr/local/bin', '/usr/bin', '/bin', '/home/dev/.local/bin', '/home/dev/.npm-global/bin'
    ])
  })

  test('does not duplicate entries the two have in common', () => {
    const merged = mergePath(SESSION_PATH, LOGIN_PATH).split(delimiter)
    expect(merged.filter((entry) => entry === '/usr/bin')).toHaveLength(1)
  })

  test('drops empty segments rather than producing an entry meaning "cwd"', () => {
    // Built from `delimiter`, never a literal ':' — the separator is ';' on
    // Windows, and this suite runs on both hosts.
    const trailing = `/usr/bin${delimiter}${delimiter}`
    expect(mergePath(trailing, `${delimiter}/opt/bin`).split(delimiter)).toEqual(['/usr/bin', '/opt/bin'])
  })
})

describe('applyLoginShellPath', () => {
  test('adds the developer paths a desktop launcher hides, and reports them', () => {
    const env: NodeJS.ProcessEnv = { SHELL: '/bin/bash', PATH: SESSION_PATH }
    const added = applyLoginShellPath({ platform: 'linux', env, run: fakeRun({ stdout: LOGIN_PATH }) })

    expect(added).toEqual(['/home/dev/.local/bin', '/home/dev/.npm-global/bin'])
    expect(env.PATH?.split(delimiter)).toContain('/home/dev/.npm-global/bin')
  })

  test('leaves PATH untouched when launched from a terminal that already has it', () => {
    const env: NodeJS.ProcessEnv = { SHELL: '/bin/bash', PATH: LOGIN_PATH }
    const added = applyLoginShellPath({ platform: 'linux', env, run: fakeRun({ stdout: LOGIN_PATH }) })

    expect(added).toEqual([])
    expect(env.PATH).toBe(LOGIN_PATH)
  })

  test('leaves PATH untouched when the probe fails', () => {
    const env: NodeJS.ProcessEnv = { SHELL: '/bin/bash', PATH: SESSION_PATH }
    applyLoginShellPath({ platform: 'linux', env, run: fakeRun({ status: 127 }) })

    expect(env.PATH).toBe(SESSION_PATH)
  })

  test('a profile that chatters on stderr cannot corrupt the value', () => {
    // nvm, asdf and MOTD hooks all print on stderr from a login shell. stdio
    // discards it, so only stdout is ever parsed.
    const env: NodeJS.ProcessEnv = { SHELL: '/bin/bash', PATH: SESSION_PATH }
    const run = fakeRun({ stdout: LOGIN_PATH, stderr: 'Now using node v22.11.0\n' })
    applyLoginShellPath({ platform: 'linux', env, run })

    expect(env.PATH).not.toContain('node v22')
  })
})
