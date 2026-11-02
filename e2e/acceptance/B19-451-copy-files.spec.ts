import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchReal, openRepo, quitReal, realProfile } from './real-app'

/**
 * B19 · #451 · `worktree.copyFiles` in oxe.yaml copies git-ignored files into a new worktree. REAL app, black box,
 * through the Worktree panel's own call (github.createWorktree), reading the notices from its result (the window does not
 * show them yet). en locale, so the message must be English (FINDING L on #387).
 */
type Result = { ok: boolean; message: string; notices?: Array<{ code: string; params: Record<string, unknown> }> }

test('B19/#451: worktree.copyFiles copies what is listed and ignored, refuses the rest, and stays in its bounds', async () => {
  test.setTimeout(300_000)
  const profile = realProfile('b19', { OXESPACE_LOCALE: 'en-US' })
  const { repo, root } = profile
  const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.email=hml@example.invalid', '-c', 'user.name=hml', ...args], { cwd, encoding: 'utf8' })
  writeFileSync(join(repo, '.gitignore'), '.env\n*.local.json\nmany/\nbig/\nlinked*\nsecret.pem\n')
  writeFileSync(join(repo, 'tracked.txt'), 'tracked\n')
  writeFileSync(join(repo, 'oxe.yaml'), 'worktree:\n  copyFiles: [.env, "config/*.local.json"]\n')
  git(repo, 'add', '.'); git(repo, 'commit', '-q', '-m', 'base')
  writeFileSync(join(repo, '.env'), 'TOKEN=hml\n')
  mkdirSync(join(repo, 'config')); writeFileSync(join(repo, 'config', 'a.local.json'), '{}\n')
  writeFileSync(join(repo, 'secret.pem'), 'not listed\n')
  mkdirSync(join(repo, 'many')); for (let i = 0; i < 201; i++) writeFileSync(join(repo, 'many', `f${i}.txt`), 'x')
  mkdirSync(join(repo, 'big')); writeFileSync(join(repo, 'big', 'blob.bin'), Buffer.alloc(51 * 1024 * 1024))
  writeFileSync(join(root, 'outside.txt'), 'outside the repo\n')
  let linkMade = 'yes'
  try { symlinkSync(join(root, 'outside.txt'), join(repo, 'linked-out.txt'), 'file') } catch (e) { linkMade = `no: ${(e as Error).message.slice(0, 60)}` }

  const { app, page } = await launchReal(profile)
  const oxe = <T>(p: Page, expression: string) => p.evaluate(expression) as Promise<T>
  const out: Record<string, unknown> = { linkMade }
  // Any approval a hand edit raises (B7.4) is declined, so a request never stands over the page.
  const declineAll = () => oxe(page, `window.oxe.approvals.list().then(l => Promise.all(l.map(r => window.oxe.approvals.ack({ id: r.id, generation: r.generation, visible: true, focused: true })
    .then(() => window.oxe.approvals.respond({ id: r.id, generation: r.generation, optionId: (r.options.find(o => o.intent === 'deny') || r.options[0]).id })).catch(() => null))))`)
  let n = 0
  const create = async (copyFiles: string, from = repo): Promise<Result & { path: string }> => {
    if (copyFiles) { writeFileSync(join(repo, 'oxe.yaml'), `worktree:\n  copyFiles: ${copyFiles}\n`); await page.waitForTimeout(300); await declineAll() }
    const path = join(root, `wt-${++n}`)
    const r = await oxe<Result>(page, `window.oxe.github.createWorktree(${JSON.stringify({ rootPath: from, branch: `hml-b19-${n}`, path, createBranch: true })}).then(r => r, e => ({ ok: false, message: 'error: ' + e.message }))`)
    return { ...r, path }
  }
  const codes = (r: Result) => (r.notices ?? []).map(x => x.code)
  try {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = (() => new Promise(() => undefined)) as typeof dialog.showMessageBox
      dialog.showMessageBoxSync = (() => 0) as typeof dialog.showMessageBoxSync
    })
    await openRepo(page, repo)
    await declineAll()

    // (1) A normal pattern copies the ignored files; (6) the message is English, created first.
    const a = await create('')
    out.a = { ok: a.ok, message: a.message, codes: codes(a), env: existsSync(join(a.path, '.env')), local: existsSync(join(a.path, 'config', 'a.local.json')), secret: existsSync(join(a.path, 'secret.pem')) }
    expect.soft(a.ok, '(1) created').toBe(true)
    expect.soft(existsSync(join(a.path, '.env')), '(1) .env copied').toBe(true)
    expect.soft(existsSync(join(a.path, 'config', 'a.local.json')), '(1) config/a.local.json copied').toBe(true)
    expect.soft(existsSync(join(a.path, 'secret.pem')), '(1) an unlisted ignored file is not copied').toBe(false)
    expect.soft(codes(a)[0], '(6) worktree.created comes first').toMatch(/^worktree\.created/)
    expect.soft(a.message, '(6) English message').toMatch(/Worktree created at/)
    expect.soft(a.message, '(6) no Portuguese').not.toMatch(/criado|Copiad|arquivos/i)

    // (2) Refused patterns: absolute, .., .git, Windows aliases, a link out, a tracked file, too complex.
    const deep = 'x/' + Array.from({ length: 9 }, () => '**').join('/') + '/y'
    const b = await create(JSON.stringify(['/etc/passwd', 'C:/Windows/win.ini', '../outside.txt', '.git/config', 'GIT~1/config', '.git::$INDEX_ALLOCATION/config', '.git./config', 'linked-out.txt', 'tracked.txt', deep]))
    out.b = { ok: b.ok, notices: b.notices, linkCopied: existsSync(join(b.path, 'linked-out.txt')) }
    expect.soft(b.ok, '(2) the worktree is still created').toBe(true)
    expect.soft(codes(b), '(2) outside the repo refused').toContain('worktree.copyFiles.outsideRepo')
    expect.soft(JSON.stringify(b.notices), '(2) .. refused by name').toContain('../outside.txt')
    expect.soft(JSON.stringify(b.notices), '(2) GIT~1 refused by name').toContain('GIT~1')
    expect.soft(JSON.stringify(b.notices), '(2) the :: stream refused by name').toContain('INDEX_ALLOCATION')
    expect.soft(codes(b), '(2) a tracked file: notIgnored').toContain('worktree.copyFiles.notIgnored')
    expect.soft(codes(b), '(2) too complex refused').toContain('worktree.copyFiles.tooComplex')
    if (linkMade === 'yes') expect.soft(codes(b), '(2) a link out is not followed').toContain('worktree.copyFiles.notFollowed')
    expect.soft(existsSync(join(b.path, 'linked-out.txt')), '(2) the link out is not copied').toBe(false)

    // (3) The limits: 201 files, then 51 MB. Nothing copied, the worktree created, the report says so.
    const c = await create('[many]')
    out.c = { ok: c.ok, notices: c.notices, copied: existsSync(join(c.path, 'many', 'f0.txt')) }
    expect.soft(c.ok, '(3) created over the file limit').toBe(true)
    expect.soft(codes(c), '(3) 201 files: overLimit').toContain('worktree.copyFiles.overLimit')
    expect.soft(existsSync(join(c.path, 'many', 'f0.txt')), '(3) nothing copied').toBe(false)
    const d = await create('[big]')
    out.d = { ok: d.ok, notices: d.notices, copied: existsSync(join(d.path, 'big', 'blob.bin')) }
    expect.soft(d.ok, '(3) created over the size limit').toBe(true)
    expect.soft(codes(d), '(3) 51 MB: overLimit').toContain('worktree.copyFiles.overLimit')
    expect.soft(existsSync(join(d.path, 'big', 'blob.bin')), '(3) nothing copied').toBe(false)

    // (4) Never overwrites: the same file named twice; the second finds it there.
    const e = await create(JSON.stringify(['.env', '**/.env']))
    out.e = { ok: e.ok, notices: e.notices }
    expect.soft(existsSync(join(e.path, '.env')), '(4) .env copied once').toBe(true)

    // (5) An oxe.yaml changed only in a worktree has no effect: creating from that worktree reads the main checkout's.
    writeFileSync(join(repo, 'oxe.yaml'), 'worktree:\n  copyFiles: [.env]\n'); await declineAll()
    writeFileSync(join(a.path, 'oxe.yaml'), 'worktree:\n  copyFiles: [secret.pem, .env]\n')
    writeFileSync(join(a.path, 'secret.pem'), 'in the worktree\n')
    const f = await create('', a.path)
    out.f = { ok: f.ok, notices: f.notices, secret: existsSync(join(f.path, 'secret.pem')) }
    expect.soft(f.ok, '(5) created from a worktree').toBe(true)
    expect.soft(existsSync(join(f.path, 'secret.pem')), '(5) the worktree\'s own oxe.yaml is not read').toBe(false)
  } finally {
    console.log('B19', JSON.stringify(out).slice(0, 6000))
    await quitReal(app)
  }
})
