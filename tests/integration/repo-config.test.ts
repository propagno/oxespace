import { describe, expect, test } from 'vitest'
import { normalizeSharedDirectories, parseOxeYaml, MAX_FILE_BYTES } from '../../electron/main/services/repo-config/parser'
import { runHook } from '../../electron/main/services/repo-config/hook-runner'
import { hashHookScript, RepoHookTrust } from '../../electron/main/services/repo-config/trust'
import { openInMemoryDatabase } from '../../electron/main/db/index'

describe('parseOxeYaml', () => {
  test('reads scripts, shared directories and tabs', () => {
    const config = parseOxeYaml(`
scripts:
  setup: |
    npm ci
  archive: echo bye
worktree:
  sharedDirectories: [node_modules, ./.cache/, apps\\web\\node_modules]
defaultTabs:
  - { title: Dev, command: npm run dev, color: "#0af" }
  - { title: NoColor, command: ls, color: red }
`)
    expect(config?.scripts.setup).toBe('npm ci')
    expect(config?.scripts.archive).toBe('echo bye')
    expect(config?.worktree.sharedDirectories).toEqual(['node_modules', '.cache', 'apps/web/node_modules'])
    expect(config?.defaultTabs).toEqual([
      { title: 'Dev', command: 'npm run dev', color: '#0af' },
      { title: 'NoColor', command: 'ls' }
    ])
  })

  test('drops directories that could escape the checkout', () => {
    expect(
      normalizeSharedDirectories(['../x', 'a/../b', '/abs', 'C:/win', '.git', 'a/.git/b', 'a/./b', '', 'ok', 'ok', 42])
    ).toEqual(['ok'])
  })

  test('returns null for invalid, empty, non-mapping or oversized input', () => {
    expect(parseOxeYaml('scripts: [unterminated')).toBeNull()
    expect(parseOxeYaml('- just\n- a list')).toBeNull()
    expect(parseOxeYaml('unknown: 1')).toBeNull()
    expect(parseOxeYaml('scripts:\n  setup: ' + 'x'.repeat(MAX_FILE_BYTES))).toBeNull()
  })

  test('drops an oversized script field instead of failing the file', () => {
    const config = parseOxeYaml(`scripts:\n  setup: ${'x'.repeat(70_000)}\n  archive: ok\n`)
    expect(config?.scripts.setup).toBeUndefined()
    expect(config?.scripts.archive).toBe('ok')
  })
})

describe('runHook', () => {
  const cwd = process.cwd()

  test('reports pass and fail with exit codes', async () => {
    const pass = await runHook('echo hello', { cwd })
    expect(pass.status).toBe('passed')
    expect(pass.output).toContain('hello')

    const fail = await runHook('exit 3', { cwd })
    expect(fail).toMatchObject({ status: 'failed', exitCode: 3 })
  })

  test('passes OXE_* variables to the hook', async () => {
    const script = process.platform === 'win32' ? 'echo %OXE_WORKTREE_PATH%' : 'echo $OXE_WORKTREE_PATH'
    const outcome = await runHook(script, { cwd, env: { OXE_WORKTREE_PATH: 'wt-marker' } })
    expect(outcome.output).toContain('wt-marker')
  })

  test('a timeout is unverifiable, never a pass', async () => {
    const script = process.platform === 'win32' ? 'ping -n 30 127.0.0.1 > nul' : 'sleep 30'
    const outcome = await runHook(script, { cwd, timeoutMs: 300 })
    expect(outcome).toMatchObject({ status: 'unverifiable', reason: 'timeout' })
  })
})

describe('RepoHookTrust', () => {
  test('trusts only the exact approved script text', () => {
    const db = openInMemoryDatabase()
    const trust = new RepoHookTrust(db, () => 1)
    expect(trust.isTrusted('/r', 'setup', 'npm ci')).toBe(false)
    trust.approve('/r', 'setup', 'npm ci')
    expect(trust.isTrusted('/r', 'setup', 'npm ci')).toBe(true)
    expect(trust.isTrusted('/r', 'setup', 'npm ci && curl evil')).toBe(false)
    expect(trust.isTrusted('/r', 'archive', 'npm ci')).toBe(false)
    expect(trust.isTrusted('/other', 'setup', 'npm ci')).toBe(false)
    trust.revoke('/r', 'setup')
    expect(trust.isTrusted('/r', 'setup', 'npm ci')).toBe(false)
    expect(hashHookScript('  a \n')).toBe(hashHookScript('a'))
    db.close()
  })
})
