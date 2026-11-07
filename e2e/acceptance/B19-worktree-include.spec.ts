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
  create: (i: { projectId: string; rootPath?: string; provider: 'claude'; worktree?: { branch?: string } }) => Promise<{ thread: { ownedWorktree?: { path: string } } }>
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
  writeFileSync(join(repo, 'oxe.yaml'), ['worktree:', '  include:', '    - .env', '    - config/*.json', '    - big.bin', '    - ../outside.txt', `    - ${outside.replace(/\\/g, '/')}`, ''].join('\n'))
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
    expect(existsSync(join(wt!, 'big.bin')), 'a file over the size limit is not copied').toBe(false)
    expect(existsSync(join(wt!, 'outside.txt')), 'neither the .. glob nor the absolute one brings a file from outside').toBe(false)
    // The person is told what was copied and what was refused, and why.
    const report = page.getByText(/copied|copiad/i).first()
    await expect(report, 'a report of the copy').toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(/\.\.\/outside\.txt|outside the project|fora do projeto/i).first(), 'the .. glob is reported as refused').toBeVisible()
    await expect(page.getByText(/big\.bin|too large|grande demais/i).first(), 'the oversized file is reported').toBeVisible()
  } finally { await quitReal(app) }
})
