import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { launchReal, openRepo, quitReal, realProfile } from './real-app'

/**
 * #510 + #507 · A worktree root must be the repository's own, checked both ways. REAL app, black box.
 * - A real linked worktree (git worktree add) is accepted: by the file channels for the workspace, and by "Open in…"
 *   for the project's conversations (#507).
 * - Three folders that only claim to be one are refused, nothing read or written through them:
 *   - a forged `.git` file whose gitdir names the repository;
 *   - a copy of a real worktree's pointer;
 *   - a `.git` pointing at a UNC share, refused before any network access.
 */
const win = process.platform === 'win32'
type R = { ok: boolean; detail: string }
const run = (page: Page, expression: string) => page.evaluate(`(${expression}).then(r => ({ ok: true, detail: JSON.stringify(r ?? null).slice(0, 160) }), e => ({ ok: false, detail: String(e && e.message).slice(0, 200) }))`) as Promise<R>

test('#510/#507: only the repository\'s own worktrees are roots; forged, copied and UNC pointers are refused', async () => {
  test.setTimeout(180_000)
  const base = realProfile('wtroot')
  const { repo, root } = base
  const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.email=hml@example.invalid', '-c', 'user.name=hml', ...args], { cwd, encoding: 'utf8' })
  writeFileSync(join(repo, 'a.txt'), 'in the repo\n'); git(repo, 'add', '.'); git(repo, 'commit', '-q', '-m', 'a')
  const wt = join(root, 'wt-real'); git(repo, 'worktree', 'add', '-q', '-b', 'hml-wt', wt)
  const forged = join(root, 'forged'); mkdirSync(forged); writeFileSync(join(forged, '.git'), `gitdir: ${join(repo, '.git').replace(/\\/g, '/')}\n`); writeFileSync(join(forged, 'secret.txt'), 'forged secret\n')
  const copied = join(root, 'copied'); mkdirSync(copied); copyFileSync(join(wt, '.git'), join(copied, '.git')); writeFileSync(join(copied, 'secret.txt'), 'copied secret\n')
  const unc = join(root, 'unc'); mkdirSync(unc); writeFileSync(join(unc, '.git'), 'gitdir: //hml-unc.invalid/share/repo/.git\n'); writeFileSync(join(unc, 'secret.txt'), 'unc secret\n')
  // #519: a .git that is a link (a junction on Windows, a symlink elsewhere) to the repository's own .git inherits nothing.
  const linked = join(root, 'linked'); mkdirSync(linked); symlinkSync(join(repo, '.git'), join(linked, '.git'), win ? 'junction' : 'dir'); writeFileSync(join(linked, 'secret.txt'), 'linked secret\n')
  // Real OpenInService; on Linux a stand-in `code` records a launch, on Windows a stand-in is listed and nothing is launched.
  const args = join(root, 'code-args.txt')
  const env: Record<string, string> = { ...base.env, OXESPACE_LOCALE: 'en-US', OXESPACE_E2E_MOCK_NATIVE: '0' }
  if (win) {
    const vscode = join(root, 'localappdata', 'Programs', 'Microsoft VS Code'); mkdirSync(vscode, { recursive: true })
    copyFileSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'where.exe'), join(vscode, 'Code.exe')); env.LOCALAPPDATA = join(root, 'localappdata')
  } else {
    const bin = join(root, 'bin'); mkdirSync(bin); writeFileSync(join(bin, 'code'), `#!/bin/sh\necho "$@" >> "${args}"\n`, { mode: 0o755 }); env.PATH = `${bin}${delimiter}${base.env.PATH ?? ''}`
  }
  const { app, page } = await launchReal({ ...base, env })
  const out: Record<string, R> = {}
  try {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = (() => new Promise(() => undefined)) as typeof dialog.showMessageBox
      dialog.showMessageBoxSync = (() => 0) as typeof dialog.showMessageBoxSync
    })
    await openRepo(page, repo)
    const ws = await page.evaluate('window.oxe.workspace.list().then(l => l[0].id)') as string
    const read = (rootPath: string, relativePath: string) => run(page, `window.oxe.fs.readFile(${JSON.stringify({ workspaceId: ws, rootPath, relativePath })})`)
    // #510, file channels (workspace scope).
    out.readWorktree = await read(wt, 'a.txt')
    for (const [name, folder] of [['forged', forged], ['copied', copied], ['unc', unc], ['linked', linked]] as const) {
      const t0 = Date.now()
      out[`read-${name}`] = await read(folder, 'secret.txt')
      out[`read-${name}`].detail += ` (${Date.now() - t0} ms)`
      out[`write-${name}`] = await run(page, `window.oxe.fs.writeFile(${JSON.stringify({ workspaceId: ws, rootPath: folder, relativePath: 'planted.txt', content: 'x' })})`)
      expect.soft(out[`read-${name}`].ok && /secret/.test(out[`read-${name}`].detail), `${name}: its secret.txt is never read`).toBe(false)
      expect.soft(existsSync(join(folder, 'planted.txt')), `${name}: nothing is written into it`).toBe(false)
    }
    expect.soft(out.readWorktree.ok, 'the real worktree is read').toBe(true)

    // #507, "Open in…" for the project's conversations (thread scope).
    const projectId = await page.evaluate(`window.oxe.thread.addProject(${JSON.stringify(repo)}).then(p => p.projectId)`) as string
    const openIn = (rootPath: string, path: string) => run(page, `window.oxe.app.openIn(${JSON.stringify({ workspaceId: `thread:${projectId}`, rootPath, path, target: 'vscode' })})`)
    if (!win) {
      out.openWorktree = await openIn(wt, 'a.txt')
      expect.soft(out.openWorktree.ok, 'a conversation\'s worktree file opens').toBe(true)
      await expect.poll(() => existsSync(args) ? readFileSync(args, 'utf8') : '', { timeout: 5_000 }).toContain('wt-real')
    }
    const launchedBefore = existsSync(args) ? readFileSync(args, 'utf8') : ''
    for (const [name, folder] of [['forged', forged], ['copied', copied], ['unc', unc], ['linked', linked]] as const) {
      out[`open-${name}`] = await openIn(folder, 'secret.txt')
      expect.soft(out[`open-${name}`].ok, `${name}: Open in… is refused`).toBe(false)
      // The window shows the C3 code's text (#522: "Only files and folders inside the project can be opened from here.");
      // main's own English line names the reason, no longer "The workspace is not open".
      expect.soft(out[`open-${name}`].detail, `${name}: refused as outsideRoot`).toContain('app.openIn.outsideRoot')
      expect.soft(out[`open-${name}`].detail, `${name}: not "The workspace is not open"`).not.toContain('The workspace is not open')
    }
    expect.soft(existsSync(args) ? readFileSync(args, 'utf8') : '', 'nothing launched for the forged roots').toBe(launchedBefore)
  } finally {
    console.log('WTROOT', JSON.stringify(out).slice(0, 4000))
    await quitReal(app)
  }
})
