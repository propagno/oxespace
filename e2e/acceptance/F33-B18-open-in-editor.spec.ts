import { expect, test } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { launchReal, openRepo, quitReal, realProfile } from './real-app'

/**
 * F33 + B18 (S6, V16) · "Open in…" on file paths, with the path checked by main.
 * Roadmap acceptance: a path with a line opens the editor on that line; a path outside the project is refused; an
 * editor that is not installed is not listed; keyboard and screen reader work.
 *
 * REAL app. A stand-in `code` on PATH records its arguments (VS Code's CLI), and no `cursor` or `zed` exists, so only
 * VS Code may be listed. A terminal prints two paths, one inside the project and one outside, as an agent would cite them.
 */
test('F33/B18: a cited path opens in the editor on its line; outside the project is refused', async () => {
  test.setTimeout(150_000)
  const base = realProfile('f33')
  const bin = join(base.root, 'bin'); mkdirSync(bin)
  const args = join(base.root, 'code-args.txt')
  writeFileSync(join(bin, 'code.cmd'), `@echo off\r\necho %*>>"${args}"\r\n`)
  writeFileSync(join(bin, 'code'), `#!/bin/sh\necho "$@" >> "${args}"\n`, { mode: 0o755 })
  const profile = { ...base, env: { ...base.env, PATH: `${bin}${delimiter}${base.env.PATH ?? ''}`, OXESPACE_LOCALE: 'en-US' } }
  mkdirSync(join(profile.repo, 'src')); writeFileSync(join(profile.repo, 'src', 'app.ts'), 'line 1\n'.repeat(40))
  writeFileSync(join(profile.root, 'secret.txt'), 'outside')

  const { app, page } = await launchReal(profile)
  try {
    await openRepo(page, profile.repo)
    const terminal = page.locator('.xterm').first()
    await terminal.click()
    await page.keyboard.type('echo src/app.ts:12 ; echo ../secret.txt:1\r')
    await page.waitForTimeout(1_500)

    // Inside the project: the menu lists VS Code (installed) and not Cursor or Zed (absent).
    await page.locator('.xterm').getByText('src/app.ts:12').first().click({ button: 'right' })
    const menu = page.getByRole('menu')
    await expect(menu.getByRole('menuitem', { name: /VS Code/ }), 'the installed editor is listed').toBeVisible({ timeout: 5_000 })
    expect(await menu.getByRole('menuitem', { name: /Cursor|Zed/ }).count(), 'absent editors are not listed').toBe(0)
    await expect(menu.getByRole('menuitem', { name: /Reveal|Show in (Explorer|Files|Finder)/ })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: /Copy path/ })).toBeVisible()
    // Keyboard: the menu takes arrows and Enter.
    await menu.getByRole('menuitem', { name: /VS Code/ }).focus()
    await page.keyboard.press('Enter')
    await expect.poll(() => existsSync(args) ? readFileSync(args, 'utf8') : '', { timeout: 5_000 }).toMatch(/--goto .*src[\\/]app\.ts:12/)

    // Outside the project: main refuses, nothing is launched, and the person is told.
    const before = readFileSync(args, 'utf8')
    await page.locator('.xterm').getByText('../secret.txt:1').first().click({ button: 'right' })
    const second = page.getByRole('menu')
    if (await second.getByRole('menuitem', { name: /VS Code/ }).isVisible().catch(() => false)) await second.getByRole('menuitem', { name: /VS Code/ }).click()
    await page.waitForTimeout(1_500)
    expect(readFileSync(args, 'utf8'), 'nothing launched for a path outside the project').toBe(before)

    // Main checks the path, never the renderer: the channel itself refuses .. and absolute paths outside the root.
    const refusals = await page.evaluate(async paths => {
      const openIn = (window as unknown as { oxe: { app: { openIn?: (i: { path: string; line?: number; target: string }) => Promise<unknown> } } }).oxe.app.openIn
      if (!openIn) return ['openIn missing']
      const out: string[] = []
      for (const path of paths) { try { await openIn({ path, line: 1, target: 'vscode' }); out.push(`accepted ${path}`) } catch (e) { out.push(`refused ${String((e as Error).message).slice(0, 80)}`) } }
      return out
    }, ['../secret.txt', join(profile.root, 'secret.txt'), 'src/../../secret.txt'])
    for (const r of refusals) expect(r).toMatch(/^refused /)
    expect(readFileSync(args, 'utf8'), 'still nothing launched').toBe(before)
  } finally { await quitReal(app) }
})
