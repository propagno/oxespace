import { expect, test } from '@playwright/test'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { launchReal, openRepo, quitReal, realProfile } from './real-app'

/**
 * F33 + B18 (S6, V16) · "Open in…" on file paths, with the path checked by main.
 * Roadmap acceptance: a path with a line opens the editor on that line; a path outside the project is refused; an
 * editor that is not installed is not listed; keyboard and screen reader work.
 *
 * REAL app. The editor is never the person's (or the runner's) real one:
 * - Linux: a stand-in `code` on PATH records its arguments (VS Code's CLI); no `cursor` or `zed` exists. The launch is
 *   checked here.
 * - Windows: B18 never reads PATH (a .cmd run without a shell is CVE-2024-27980) and looks only in fixed install folders,
 *   so LOCALAPPDATA points at a temp folder with a stand-in `Programs\Microsoft VS Code\Code.exe`. Nothing is launched on
 *   Windows (a real VS Code may sit under Program Files on the runner): the menu and main's refusals are checked.
 * A terminal prints two paths, one inside the project and one outside, as an agent would cite them.
 */
const win = process.platform === 'win32'

test('F33/B18: a cited path opens in the editor on its line; outside the project is refused', async () => {
  test.setTimeout(150_000)
  const base = realProfile('f33')
  const args = join(base.root, 'code-args.txt')
  const env: Record<string, string> = { ...base.env, OXESPACE_LOCALE: 'en-US' }
  if (win) {
    const vscode = join(base.root, 'localappdata', 'Programs', 'Microsoft VS Code'); mkdirSync(vscode, { recursive: true })
    // Any executable will do: on Windows the spec never clicks it.
    copyFileSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'where.exe'), join(vscode, 'Code.exe'))
    env.LOCALAPPDATA = join(base.root, 'localappdata')
  } else {
    const bin = join(base.root, 'bin'); mkdirSync(bin)
    writeFileSync(join(bin, 'code'), `#!/bin/sh\necho "$@" >> "${args}"\n`, { mode: 0o755 })
    env.PATH = `${bin}${delimiter}${base.env.PATH ?? ''}`
  }
  const profile = { ...base, env }
  mkdirSync(join(profile.repo, 'src')); writeFileSync(join(profile.repo, 'src', 'app.ts'), 'line 1\n'.repeat(40))
  writeFileSync(join(profile.root, 'secret.txt'), 'outside')

  const { app, page } = await launchReal(profile)
  try {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = (() => new Promise(() => undefined)) as typeof dialog.showMessageBox
      dialog.showMessageBoxSync = (() => 0) as typeof dialog.showMessageBoxSync
    })
    await openRepo(page, profile.repo)
    const terminal = page.locator('.xterm').first()
    await terminal.click()
    await page.keyboard.type('echo src/app.ts:12 ; echo ../secret.txt:1\r')
    await page.waitForTimeout(1_500)

    // Inside the project: the menu lists VS Code (installed) and not Cursor or Zed (absent).
    await page.locator('.xterm').getByText('src/app.ts:12').first().click({ button: 'right' })
    const menu = page.getByRole('menu')
    // F33's menu (FRONTEND) may land after B18: the menu checks are soft, so main's refusals below always run.
    const menuUp = await menu.getByRole('menuitem', { name: /VS Code/ }).isVisible({ timeout: 5_000 }).catch(() => false)
    expect.soft(menuUp, 'the installed editor is listed').toBe(true)
    if (menuUp) {
      expect.soft(await menu.getByRole('menuitem', { name: /Cursor|Zed/ }).count(), 'absent editors are not listed').toBe(0)
      await expect.soft(menu.getByRole('menuitem', { name: /Reveal|Show in (Explorer|Files|Finder)|Open containing folder/ })).toBeVisible()
      await expect.soft(menu.getByRole('menuitem', { name: /Copy (full |relative )?path/ }).first()).toBeVisible()
    }
    if (!win && menuUp) {
      // Keyboard: the menu takes arrows and Enter.
      await menu.getByRole('menuitem', { name: /VS Code/ }).focus()
      await page.keyboard.press('Enter')
      await expect.poll(() => existsSync(args) ? readFileSync(args, 'utf8') : '', { timeout: 5_000 }).toMatch(/--goto .*src[\\/]app\.ts:12/)
    } else await page.keyboard.press('Escape')

    // Outside the project: main refuses, nothing is launched, and the person is told.
    const before = existsSync(args) ? readFileSync(args, 'utf8') : ''
    if (!win && menuUp) {
      await page.locator('.xterm').getByText('../secret.txt:1').first().click({ button: 'right' })
      const second = page.getByRole('menu')
      if (await second.getByRole('menuitem', { name: /VS Code/ }).isVisible().catch(() => false)) await second.getByRole('menuitem', { name: /VS Code/ }).click()
      await page.waitForTimeout(1_500)
      expect(existsSync(args) ? readFileSync(args, 'utf8') : '', 'nothing launched for a path outside the project').toBe(before)
    }

    // Main checks the path, never the renderer: the channel itself refuses .. and absolute paths outside the root, for
    // that reason (app.openIn.outsideRoot), with a well-formed input.
    const workspaceId = await page.evaluate('window.oxe.workspace.list().then(l => l[0].id)') as string
    const refusals = await page.evaluate(async ({ paths, workspaceId, rootPath }) => {
      const openIn = (window as unknown as { oxe: { app: { openIn?: (i: Record<string, unknown>) => Promise<unknown> } } }).oxe.app.openIn
      if (!openIn) return ['openIn missing']
      const out: string[] = []
      for (const path of paths) { try { await openIn({ workspaceId, rootPath, path, line: 1, target: 'vscode' }); out.push(`accepted ${path}`) } catch (e) { out.push(`refused ${String((e as Error).message).slice(0, 160)}`) } }
      return out
    }, { paths: ['../secret.txt', join(profile.root, 'secret.txt'), 'src/../../secret.txt'], workspaceId, rootPath: profile.repo })
    console.log('F33-REFUSALS', JSON.stringify(refusals))
    for (const r of refusals) expect(r).toMatch(/^refused .*(outsideRoot|outside)/i)
    expect(existsSync(args) ? readFileSync(args, 'utf8') : '', 'still nothing launched').toBe(before)
  } finally { await quitReal(app) }
})
