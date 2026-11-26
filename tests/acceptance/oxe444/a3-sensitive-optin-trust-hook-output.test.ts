// @vitest-environment node
// Frozen acceptance test for OXE-444 (A3): sensitive-pattern opt-in, canonical primary-repo trust, redacted hookOutputTail.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openInMemoryDatabase } from '../../../electron/main/db'
import { GhExec } from '../../../electron/main/services/github/gh-exec'
import { GitHubRepositoryService } from '../../../electron/main/services/github/repository.service'
import { formatHookOutputTail } from '../../../electron/main/services/repo-config/hook-runner'
import { hashSensitivePatterns, RepoHookTrust } from '../../../electron/main/services/repo-config/trust'
import { isSensitivePath, isSensitivePattern } from '../../../electron/main/services/repo-config/worktree-include'
import { removeTempDir } from '../../helpers/removeTempDir'

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let sandbox: string
let repo: string
let trust: RepoHookTrust
let service: GitHubRepositoryService
let closeDb: () => void

function put(base: string, rel: string, text = rel): void {
  const file = join(base, ...rel.split('/'))
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

beforeEach(() => {
  sandbox = realpathSync.native(mkdtempSync(join(tmpdir(), 'oxe444-a3-')))
  repo = join(sandbox, 'repo')
  mkdirSync(repo, { recursive: true })
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'config', 'user.email', 'oxe444@test.invalid')
  git(repo, 'config', 'user.name', 'OXE-444')
  put(repo, '.gitignore', '.env\n.env.*\n*.key\nconfig/*.local.json\n')
  put(repo, '.worktreeinclude', '.env*\nconfig/*.local.json\n')
  put(repo, 'oxe.yaml', 'scripts:\n  setup: echo setup-ran-ok\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-qm', 'init')
  put(repo, '.env', 'API_TOKEN=dev-secret')
  put(repo, 'config/dev.local.json', '{"port":3000}')

  const db = openInMemoryDatabase()
  closeDb = () => db.close()
  trust = new RepoHookTrust(db)
  service = new GitHubRepositoryService(new GhExec({}))
  service.configureWorktreeLifecycle({ trust, stopTerminalsWithin: () => [] })
})

afterEach(() => {
  closeDb()
  try { removeTempDir(sandbox) } catch { /* temp dir */ }
})

describe('OXE-444 A3 · sensitive opt-in, canonical primary-repo trust and sanitized hook failure output', () => {
  it('blocks sensitive patterns until approved on the canonical primary root and invalidates when patterns change', async () => {
    expect(isSensitivePath('.env')).toBe(true)
    expect(isSensitivePath('.env.local')).toBe(true)
    expect(isSensitivePath('apps/web/.env.development')).toBe(true)
    expect(isSensitivePath('certs/server.pem')).toBe(true)
    expect(isSensitivePath('tls/private.key')).toBe(true)
    expect(isSensitivePath('google-credentials.json')).toBe(true)
    expect(isSensitivePath('app-secret.yaml')).toBe(true)
    expect(isSensitivePath('ssh/id_rsa')).toBe(true)
    expect(isSensitivePath('config/dev.local.json')).toBe(false)
    expect(isSensitivePattern('.env*')).toBe(true)
    expect(isSensitivePattern('*.key')).toBe(true)
    expect(isSensitivePattern('config/*.local.json')).toBe(false)

    // Without opt-in: non-sensitive copies, sensitive is blocked with sensitive-opt-in-required
    const wt1 = join(sandbox, 'wt-unapproved')
    const unapproved = await service.createWorktree({
      rootPath: repo,
      branch: 'feat/a3-unapproved',
      path: wt1,
      createBranch: true,
      baseRef: 'main'
    })
    expect(existsSync(join(wt1, 'config', 'dev.local.json'))).toBe(true)
    expect(existsSync(join(wt1, '.env'))).toBe(false)
    expect(unapproved.report?.copied).toEqual(['config/dev.local.json'])
    expect(unapproved.report?.sensitivePending).toEqual(['.env'])
    expect(unapproved.report?.skipped).toEqual(
      expect.arrayContaining([
        { path: '.env', kind: 'copy-file', reason: 'sensitive-opt-in-required' }
      ])
    )
    expect(unapproved.notices).toContainEqual({
      code: 'worktree.copyFiles.sensitiveOptInRequired',
      params: { paths: ['.env'] }
    })

    // Approve sensitive copy on canonical primary root -> works from main AND from linked worktree wt1
    trust.approveSensitiveCopy(repo, ['.env*'])
    expect(trust.isSensitiveCopyTrusted(repo, ['.env*'])).toBe(true)
    expect(hashSensitivePatterns(['.env*'])).not.toBe(hashSensitivePatterns(['.env*', '*.key']))

    const wt2 = join(sandbox, 'wt-from-wt1')
    const approved = await service.createWorktree({
      rootPath: wt1,
      branch: 'feat/a3-approved-from-wt1',
      path: wt2,
      createBranch: true,
      baseRef: 'main'
    })
    expect(existsSync(join(wt2, '.env'))).toBe(true)
    expect(readFileSync(join(wt2, '.env'), 'utf8')).toBe('API_TOKEN=dev-secret')
    expect(approved.report?.sensitivePending).toEqual([])

    // Adding a new sensitive pattern invalidates previous approval (fail-closed again)
    put(repo, '.worktreeinclude', '.env*\n*.key\nconfig/*.local.json\n')
    put(repo, 'tls.key', 'PRIVATE')
    const wt3 = join(sandbox, 'wt-changed-patterns')
    const invalidated = await service.createWorktree({
      rootPath: repo,
      branch: 'feat/a3-invalidated',
      path: wt3,
      createBranch: true,
      baseRef: 'main'
    })
    expect(existsSync(join(wt3, '.env'))).toBe(false)
    expect(existsSync(join(wt3, 'tls.key'))).toBe(false)
    expect(invalidated.report?.sensitivePending.sort()).toEqual(['.env', 'tls.key'])
  })

  it('evaluates setup hook trust against canonical primary root and returns redacted truncated hookOutputTail on failure', async () => {
    const setupScript = 'echo setup-ran-ok'
    trust.approve(repo, 'setup', setupScript)

    const wtBase = join(sandbox, 'wt-base')
    await service.createWorktree({ rootPath: repo, branch: 'feat/a3-base', path: wtBase, createBranch: true, baseRef: 'main' })

    // Create a second worktree FROM wtBase (not primary root): setup trust on primary root must apply
    const wtChild = join(sandbox, 'wt-child')
    const childResult = await service.createWorktree({
      rootPath: wtBase,
      branch: 'feat/a3-child',
      path: wtChild,
      createBranch: true,
      baseRef: 'main'
    })
    expect(childResult.report?.hookStatus).toBe('passed')
    expect(childResult.notices).toContainEqual({ code: 'worktree.setup.complete', params: {} })

    // Failing setup hook: output redacted and capped at 4 KiB
    const secretTail = formatHookOutputTail(
      `${'x'.repeat(6000)}\ntoken=sk-ant-1234567890abcdef1234567890\npassword=supersecret123\nBOOM_END`,
      4096
    )
    expect(secretTail.length).toBeLessThanOrEqual(4096)
    expect(secretTail).toContain('[redacted]')
    expect(secretTail).toContain('BOOM_END')
    expect(secretTail).not.toContain('sk-ant-1234567890abcdef1234567890')
    expect(secretTail).not.toContain('supersecret123')

    const failingScript = process.platform === 'win32'
      ? 'echo token=sk-ant-1234567890abcdef1234567890 && echo password=supersecret123 && echo HOOK_FAIL_MARKER && exit /b 7'
      : 'echo "token=sk-ant-1234567890abcdef1234567890" && echo "password=supersecret123" && echo "HOOK_FAIL_MARKER" && exit 7'
    put(repo, 'oxe.yaml', `scripts:\n  setup: |\n    ${failingScript}\n`)
    trust.approve(repo, 'setup', failingScript)

    const wtFail = join(sandbox, 'wt-fail')
    const failResult = await service.createWorktree({
      rootPath: repo,
      branch: 'feat/a3-hook-fail',
      path: wtFail,
      createBranch: true,
      baseRef: 'main'
    })
    expect(failResult.report?.hookStatus).toBe('failed')
    expect(failResult.report?.hookOutputTail).toBeTruthy()
    expect(failResult.report!.hookOutputTail!.length).toBeLessThanOrEqual(4096)
    expect(failResult.report!.hookOutputTail).toContain('[redacted]')
    expect(failResult.report!.hookOutputTail).toContain('HOOK_FAIL_MARKER')
    expect(failResult.report!.hookOutputTail).not.toContain('sk-ant-1234567890abcdef1234567890')
    expect(failResult.report!.hookOutputTail).not.toContain('supersecret123')
    expect(failResult.notices).toContainEqual({ code: 'worktree.setup.failed', params: { exitCode: 7 } })
  })
})
