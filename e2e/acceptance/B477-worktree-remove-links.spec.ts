import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchReal, openRepo, quitReal, realProfile } from './real-app'

/**
 * #477 (HIGH) · Removing a worktree never deletes through a link. REAL app, black box, through the Worktree panel's
 * calls (github.createWorktree / removeWorktree). An ignored link inside the worktree (a junction on Windows, a symlink
 * on Linux) points at a folder outside it; another sits in a nested ignored folder. Neither is listed in any oxe.yaml.
 * Removing the worktree, without and with force, leaves the outside files in place. Then worktree.sharedDirectories,
 * read from the main checkout: the new worktree links main's folder, and removing it leaves main's files.
 */
const win = process.platform === 'win32'
type Result = { ok: boolean; message: string; notices?: Array<{ code: string }> }
const link = (target: string, at: string) => symlinkSync(target, at, win ? 'junction' : 'dir')

test('#477: removing a worktree with ignored links to outside folders deletes nothing outside it', async () => {
  test.setTimeout(240_000)
  const profile = realProfile('rmlinks', { OXESPACE_LOCALE: 'en-US' })
  const { repo, root } = profile
  const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.email=hml@example.invalid', '-c', 'user.name=hml', ...args], { cwd, encoding: 'utf8' })
  writeFileSync(join(repo, '.gitignore'), 'linked-out\ndeep/\nshared/\n')
  writeFileSync(join(repo, 'oxe.yaml'), 'worktree:\n  sharedDirectories: [shared]\n')
  git(repo, 'add', '.'); git(repo, 'commit', '-q', '-m', 'base')
  mkdirSync(join(repo, 'shared')); writeFileSync(join(repo, 'shared', 'main-file.txt'), 'main\n')
  const outside = (name: string) => { const d = join(root, name); mkdirSync(d, { recursive: true }); writeFileSync(join(d, 'keep.txt'), name); return d }
  const { app, page } = await launchReal(profile)
  const oxe = <T>(p: Page, e: string) => p.evaluate(e) as Promise<T>
  const out: Record<string, unknown> = {}
  try {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = (() => new Promise(() => undefined)) as typeof dialog.showMessageBox
      dialog.showMessageBoxSync = (() => 0) as typeof dialog.showMessageBoxSync
    })
    await openRepo(page, repo)
    // Any outside-change request (B7.4) is declined so nothing stands over the page.
    await oxe(page, `window.oxe.approvals.list().then(l => Promise.all(l.map(r => window.oxe.approvals.ack({ id: r.id, generation: r.generation, visible: true, focused: true })
      .then(() => window.oxe.approvals.respond({ id: r.id, generation: r.generation, optionId: (r.options.find(o => o.intent === 'deny') || r.options[0]).id })).catch(() => null))))`)
    let n = 0
    const create = async () => {
      const path = join(root, `wt-${++n}`)
      const r = await oxe<Result>(page, `window.oxe.github.createWorktree(${JSON.stringify({ rootPath: repo, branch: `hml-rm-${n}`, path, createBranch: true })}).then(r => r, e => ({ ok: false, message: 'error: ' + e.message }))`)
      return { ...r, path }
    }
    const remove = (path: string, force: boolean) => oxe<Result>(page, `window.oxe.github.removeWorktree(${JSON.stringify({ rootPath: repo, path, force })}).then(r => r, e => ({ ok: false, message: 'error: ' + e.message }))`)

    for (const force of [false, true]) {
      const wt = await create()
      const o1 = outside(`outside-${force ? 'f' : 'n'}`), o2 = outside(`outside-deep-${force ? 'f' : 'n'}`)
      link(o1, join(wt.path, 'linked-out'))
      mkdirSync(join(wt.path, 'deep', 'er'), { recursive: true }); link(o2, join(wt.path, 'deep', 'er', 'nested'))
      out[`linked-${force}`] = lstatSync(join(wt.path, 'linked-out')).isSymbolicLink()
      if (force) writeFileSync(join(wt.path, 'dirty.txt'), 'uncommitted\n')
      const r = await remove(wt.path, force)
      out[`remove-${force}`] = { ok: r.ok, message: r.message.slice(0, 200), gone: !existsSync(wt.path) }
      expect.soft(existsSync(join(o1, 'keep.txt')), `force=${force}: the outside file behind the link survives`).toBe(true)
      expect.soft(existsSync(join(o2, 'keep.txt')), `force=${force}: the outside file behind the nested link survives`).toBe(true)
      expect.soft(r.ok, `force=${force}: the worktree is removed`).toBe(true)
    }

    // sharedDirectories: linked to the main checkout's folder, and removing leaves main's files.
    const s = await create()
    out.shared = { created: s.ok, link: existsSync(join(s.path, 'shared')) ? lstatSync(join(s.path, 'shared')).isSymbolicLink() : 'missing', seesMain: existsSync(join(s.path, 'shared', 'main-file.txt')) }
    const rs = await remove(s.path, true)
    out.sharedRemove = { ok: rs.ok, message: rs.message.slice(0, 200) }
    expect.soft(existsSync(join(repo, 'shared', 'main-file.txt')), 'the main checkout\'s shared file survives the removal').toBe(true)
  } finally {
    console.log('RMLINKS', JSON.stringify(out).slice(0, 3000))
    await quitReal(app)
  }
})
