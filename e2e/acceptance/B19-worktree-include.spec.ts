import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchReal, quitReal, realProfile } from './real-app'

/**
 * B19 (S3, X18) · worktree.include: a conversation's new worktree starts with the ignored files the project lists.
 * Roadmap acceptance: a glob with .. or an absolute path is refused; a secret is copied only if the person listed it;
 * the size and count limits hold; the copy is reported.
 *
 * REAL app: a repo with ignored .env, .env.local, config/local.json and secrets/key.pem, and an oxe.yaml that lists
 * some of them plus two hostile globs. A conversation is created with its own worktree (creating one starts no agent).
 */
type Api = { thread: {
  addProject: (root: string) => Promise<{ projectId: string }>
  create: (i: { projectId: string; rootPath?: string; provider: 'claude'; worktree?: { branch?: string } }) => Promise<{ thread: { ownedWorktree?: { path: string; notices?: Array<{ code: string; params?: Record<string, unknown> }> } } }>
} }

test('B19: the new worktree gets the listed ignored files, and only those', async () => {
  test.setTimeout(150_000)
  const profile = realProfile('b19', { OXESPACE_LOCALE: 'en-US' })
  const repo = profile.repo
  const outside = join(profile.root, 'outside.txt'); writeFileSync(outside, 'outside the project')
  writeFileSync(join(repo, '.gitignore'), '.env\n.env.local\nconfig/local.json\nsecrets/\nbig.bin\n')
  writeFileSync(join(repo, '.env'), 'API_URL=http://localhost\n')
  writeFileSync(join(repo, '.env.local'), 'TOKEN=not-listed\n')
  mkdirSync(join(repo, 'config')); writeFileSync(join(repo, 'config', 'local.json'), '{"port":3000}')
  mkdirSync(join(repo, 'secrets')); writeFileSync(join(repo, 'secrets', 'key.pem'), '-----BEGIN PRIVATE KEY-----\nnot listed\n')
  writeFileSync(join(repo, 'big.bin'), Buffer.alloc(200 * 1024 * 1024))
  // The key is worktree.copyFiles since the ARCHITECT review of B19 (5fc2c48ca): it says what is done to the paths.
  // big.bin is ignored but not listed: a list whose files pass the size limit (50 MB) copies nothing at all and says so
  // (worktree.copyFiles.overLimit), proved in tests/integration/worktree-include.test.ts, so it can't share this list.
  writeFileSync(join(repo, 'oxe.yaml'), ['worktree:', '  copyFiles:', '    - .env', '    - config/*.json', '    - ../outside.txt', `    - ${outside.replace(/\\/g, '/')}`, ''].join('\n'))
  execFileSync('git', ['add', '.gitignore', 'oxe.yaml'], { cwd: repo })
  execFileSync('git', ['-c', 'user.email=acc@example.invalid', '-c', 'user.name=acc', 'commit', '-q', '-m', 'project files'], { cwd: repo })

  const { app, page } = await launchReal(profile)
  try {
    const created = await page.evaluate(async root => {
      const oxe = (window as unknown as { oxe: Api }).oxe
      const { projectId } = await oxe.thread.addProject(root)
      return oxe.thread.create({ projectId, rootPath: root, provider: 'claude', worktree: { branch: 'acc/b19' } })
    }, repo)
    const wt = created.thread.ownedWorktree?.path
    expect(wt, 'the conversation got its own worktree').toBeTruthy()
    expect(readFileSync(join(wt!, '.env'), 'utf8'), '.env was listed: copied').toContain('API_URL')
    expect(existsSync(join(wt!, 'config', 'local.json')), 'config/*.json was listed: copied').toBe(true)
    expect(existsSync(join(wt!, '.env.local')), 'an ignored file nobody listed is not copied').toBe(false)
    expect(existsSync(join(wt!, 'secrets', 'key.pem')), 'a secret nobody listed is not copied').toBe(false)
    expect(existsSync(join(wt!, 'big.bin')), 'an ignored file nobody listed is not copied, however big').toBe(false)
    expect(existsSync(join(wt!, 'outside.txt')), 'neither the .. glob nor the absolute one brings a file from outside').toBe(false)
    // The person is told what was copied and what was refused, and why: the notices the conversation keeps (C3).
    const notices = created.thread.ownedWorktree?.notices ?? []
    const codes = notices.map(notice => notice.code)
    expect(codes, 'a report of the copy').toContain('worktree.copyFiles.copied')
    expect(notices.find(notice => notice.code === 'worktree.copyFiles.copied')?.params?.count, 'two files copied').toBe(2)
    expect(codes, 'the .. glob and the absolute path are reported as refused').toContain('worktree.copyFiles.outsideRepo')
  } finally { await quitReal(app) }
})
