import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { togglePanel } from '../helpers/panels'
import { launchReal, openRepo, quitReal, realProfile } from './real-app'

/**
 * #387 + #388 · Every git the app runs goes through safe-git. REAL app, black box. The repository's own settings try to
 * run code through every door the app's reads touch:
 * - core.fsmonitor;
 * - core.hooksPath and .git/hooks (post-checkout, post-index-change, reference-transaction);
 * - a clean/smudge filter and a diff textconv on *.txt.
 * Each door appends to a marker file.
 * The app reads status, branch, diff and the workspace status, opens the Changes panel, and creates a worktree.
 * - The marker must stay empty, and OxeCode, the Changes panel and the worktree must work.
 * - Then a repo-set core.sshCommand makes the person's fetch refused, naming the key (#388).
 * - A plain `git status` at the end proves the doors were live.
 */
const MARK = String.raw`require('fs').appendFileSync(process.argv[2], process.argv[3] + '\n'); process.stdout.write('')`

test('#387 safe-git: a repository\'s own settings run nothing when the app reads it; OxeCode and worktrees still work', async () => {
  test.setTimeout(240_000)
  const profile = realProfile('safegit', { OXESPACE_LOCALE: 'en-US' })
  const { repo, root } = profile
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.email=hml@example.invalid', '-c', 'user.name=hml', ...args], { cwd: repo, encoding: 'utf8' })
  const marker = join(root, 'ran.txt'); writeFileSync(marker, '')
  const markJs = join(root, 'mark.js'); writeFileSync(markJs, MARK)
  const node = process.execPath.replace(/\\/g, '/')
  const cmd = (what: string) => `"${node}" "${markJs.replace(/\\/g, '/')}" "${marker.replace(/\\/g, '/')}" ${what}`
  // Content first, with plain git, before any trap exists.
  writeFileSync(join(repo, 'a.txt'), 'one\n'); git('add', '.'); git('commit', '-q', '-m', 'a')
  writeFileSync(join(repo, 'a.txt'), 'one\ntwo\n')
  // The traps: repository settings only (never the global config).
  const hooks = join(root, 'evil-hooks'); mkdirSync(hooks)
  for (const name of ['post-checkout', 'post-index-change', 'reference-transaction', 'pre-commit']) {
    for (const dir of [hooks, join(repo, '.git', 'hooks')]) {
      const file = join(dir, name); writeFileSync(file, `#!/bin/sh\n${cmd(`hook-${name}`)}\nexit 0\n`); try { chmodSync(file, 0o755) } catch { /* windows */ }
    }
  }
  appendFileSync(join(repo, '.git', 'config'), [
    '[core]', `\tfsmonitor = ${cmd('fsmonitor')}`, `\thooksPath = ${hooks.replace(/\\/g, '/')}`,
    '[filter "evil"]', `\tclean = ${cmd('filter-clean')}`, `\tsmudge = ${cmd('filter-smudge')}`, '\trequired = false',
    '[diff "evil"]', `\ttextconv = ${cmd('textconv')}`, ''
  ].join('\n'))
  writeFileSync(join(repo, '.gitattributes'), '*.txt filter=evil diff=evil\n')

  const { app, page } = await launchReal(profile)
  const oxe = <T>(p: Page, expression: string) => p.evaluate(expression) as Promise<T>
  const out: Record<string, unknown> = {}
  try {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = (() => new Promise(() => undefined)) as typeof dialog.showMessageBox
      dialog.showMessageBoxSync = (() => 0) as typeof dialog.showMessageBoxSync
    })
    await openRepo(page, repo)
    const workspaceId = await oxe<string>(page, 'window.oxe.workspace.list().then(l => l[0].id)')
    const input = JSON.stringify({ workspaceId, rootPath: repo })
    out.branch = await oxe(page, `window.oxe.git.getBranch(${input}).then(r => r, e => 'error: ' + e.message)`)
    out.status = await oxe(page, `window.oxe.git.getStatus(${input}).then(r => JSON.stringify(r).slice(0, 300), e => 'error: ' + e.message)`)
    out.diff = await oxe(page, `window.oxe.git.getDiff(${JSON.stringify({ workspaceId, rootPath: repo, base: 'HEAD', includeUncommitted: true })}).then(r => JSON.stringify(r).slice(0, 400), e => 'error: ' + e.message)`)
    out.workspaceStatus = await oxe(page, `window.oxe.github.getWorkspaceStatus(${input}).then(r => JSON.stringify(r).slice(0, 300), e => 'error: ' + e.message)`)
    // The Changes panel, as the person opens it.
    await togglePanel(page, 'Changes')
    await page.waitForTimeout(2_500)
    out.changesPanel = (await page.locator('main').innerText()).match(/a\.txt.{0,60}/)?.[0] ?? 'a.txt not shown'
    // A worktree from the app.
    out.worktree = await oxe(page, `window.oxe.github.createWorktree(${JSON.stringify({ rootPath: repo, branch: 'hml-safe', path: join(root, 'wt-safe'), createBranch: true })}).then(r => r, e => ({ error: e.message }))`)
    out.worktreeHasFile = existsSync(join(root, 'wt-safe', 'a.txt'))
    await page.waitForTimeout(1_500)
    out.markerAfterApp = readFileSync(marker, 'utf8')

    // #388: a repo-set core.sshCommand refuses the person's fetch, naming the key.
    git('config', 'core.sshCommand', cmd('ssh'))
    out.fetch = await oxe(page, `window.oxe.github.fetch(${input}).then(r => r, e => ({ error: e.message }))`)
    out.markerAfterFetch = readFileSync(marker, 'utf8')
  } finally { await quitReal(app) }
  // Control: plain git runs the doors.
  try { git('status', '--short') } catch { /* a failing door is still a door */ }
  out.markerPlainGit = readFileSync(marker, 'utf8')
  console.log('SAFEGIT', JSON.stringify(out).slice(0, 3500))
  expect.soft(out.markerAfterApp, 'nothing ran while the app read the repo and made a worktree').toBe('')
  expect.soft(out.markerAfterFetch, 'nothing ran on the refused fetch').toBe('')
  expect.soft(String(out.status), 'status works').not.toMatch(/^error/)
  expect.soft(String(out.diff), 'the diff shows the change').toContain('two')
  expect.soft(String(out.changesPanel), 'the Changes panel lists the file').toContain('a.txt')
  expect.soft(JSON.stringify(out.worktree), 'the worktree is created').toMatch(/"ok":true/)
  expect.soft(out.worktreeHasFile, 'with the files').toBe(true)
  expect.soft(JSON.stringify(out.fetch), 'the fetch is refused naming the key').toMatch(/sshCommand/i)
  expect.soft(String(out.markerPlainGit), 'control: plain git runs the doors').not.toBe('')
})
