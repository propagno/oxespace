// Frozen end-to-end acceptance test for 1.5.2 Polimento 2 (Jira OXE-188, AG-06, CA-6; A22), in the built app with real
// services (OXESPACE_E2E_MOCK_NATIVE=0). Written by the planner; the executor must not edit it. Two conversations of a
// stand-in Claude (no paid account, no turn sent) side by side: the person moves the divider to 65 %, makes the right
// column active and picks a third conversation in the sidebar, which replaces the right column; after a restart of the
// app (same database and user data) the share is still 65 % (± 2 px). Red on main f65fa5374: there is no divider.
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { withoutLiveApp } from '../helpers/live-app-env'

const read = (rel: string): Record<string, unknown> => JSON.parse(readFileSync(join(process.cwd(), rel), 'utf8'))
function cat(ns: string, key: string, vars: Record<string, string> = {}): string {
  let node: unknown = read(`shared/locales/en/${ns}.json`)
  for (const part of key.split('.')) node = (node as Record<string, unknown> | undefined)?.[part]
  if (typeof node !== 'string') throw new Error(`the en ${ns} catalog has no key ${key}`)
  return node.replace(/\{\{(\w+)\}\}/g, (_, name: string) => vars[name] ?? `{{${name}}}`)
}

// A stand-in `claude` that answers --version and auth status, so conversations can be created (no turn is sent).
const STAND_IN = String.raw`#!/usr/bin/env node
const args = process.argv.slice(2)
if (args[0] === '--version' || args[0] === '-v') { process.stdout.write('2.1.0 (Claude Code)\n'); process.exit(0) }
if (args[0] === 'auth' && args[1] === 'status') { process.stdout.write(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'stand-in' })); process.exit(0) }
process.stdin.on('data', () => undefined)
process.stdin.on('end', () => process.exit(0))
`
const root = mkdtempSync(join(tmpdir(), 'oxe-ag06-'))
const repo = join(root, 'repo')
const bin = join(root, 'bin')
function setup(): void {
  mkdirSync(repo, { recursive: true }); mkdirSync(bin, { recursive: true })
  writeFileSync(join(bin, 'claude'), STAND_IN); chmodSync(join(bin, 'claude'), 0o755)
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo })
  execFileSync('git', ['-c', 'user.email=e2e@example.invalid', '-c', 'user.name=e2e', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: repo })
}
/** The app on the same database and user data every time, so a relaunch is a restart. */
async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e', 'electron-main.cjs')], env: {
    ...withoutLiveApp(process.env), TZ: 'UTC', OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '0', OXESPACE_LOCALE: 'en-US',
    OXESPACE_DB_PATH: join(root, 'oxespace.sqlite3'), PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`,
    CLAUDE_CONFIG_DIR: join(root, 'claude-config'), CODEX_HOME: join(root, 'codex-home'), ANTHROPIC_API_KEY: '', OPENAI_API_KEY: ''
  } })
  const page = await app.firstWindow()
  await page.waitForLoadState('load')
  await page.setViewportSize({ width: 1500, height: 900 })
  return { app, page }
}
const oxe = <T>(page: Page, path: string, ...args: unknown[]) => page.evaluate(([p, a]) => {
  const [group, fn] = (p as string).split('.')
  const api = (window as unknown as { oxe: Record<string, Record<string, (...x: unknown[]) => Promise<unknown>>> }).oxe
  return api[group][fn](...(a as unknown[]))
}, [path, args] as const) as Promise<T>
async function conversation(page: Page, projectId: string, title: string): Promise<string> {
  const snap = await oxe<{ thread: { id: string } }>(page, 'thread.create', { projectId, rootPath: realpathSync.native(repo), provider: 'claude' })
  await oxe(page, 'thread.command', snap.thread.id, `/rename ${title}`)
  return snap.thread.id
}
const rowOf = (page: Page, id: string) => page.locator(`[data-thread-row="${id}"] [data-list-item]`).first()
/** The first column's width over the grid's: the share the divider set. */
async function share(page: Page): Promise<{ first: number; grid: number }> {
  return page.locator('.thread-grid.is-split').evaluate(grid => ({ first: (grid.querySelector('.thread-cell') as HTMLElement).getBoundingClientRect().width, grid: grid.getBoundingClientRect().width }))
}

test.skip(process.platform === 'win32', 'the stand-in agent is a script; on Windows the app launches only a native .exe')

test('AG-06 in the app: side-by-side Splitter persists 65 percent ratio across restart and targets active column', async () => {
  test.setTimeout(300_000)
  setup()
  let { app, page } = await launch()
  try {
    await page.getByTestId('btn-new-workspace').click()
    await page.getByTestId('wizard-dir-input').fill(repo)
    await page.getByTestId('wizard-launch-btn').click()
    await page.waitForSelector('[data-testid="workspace-grid"], [data-testid="workspace-split-grid"]', { timeout: 15_000 })
    const project = await oxe<{ projectId: string }>(page, 'thread.addProject', realpathSync.native(repo))
    const a = await conversation(page, project.projectId, 'Alpha work')
    const b = await conversation(page, project.projectId, 'Beta review')
    const c = await conversation(page, project.projectId, 'Gamma fix')
    await page.locator('button[data-app-mode="thread"]').first().click()
    await expect(rowOf(page, a)).toBeVisible({ timeout: 30_000 })
    await rowOf(page, a).click()
    await page.locator(`[data-thread-row="${b}"]`).getByRole('button', { name: cat('thread', 'sidebar.openSideNamed', { name: 'Beta review' }) }).click({ force: true })
    const divider = page.getByRole('separator', { name: cat('thread', 'grid.resize') })
    await expect(divider).toBeVisible({ timeout: 15_000 })
    await divider.focus()
    await page.keyboard.press('End')
    await expect(divider).toHaveAttribute('aria-valuenow', '65')
    const moved = await share(page)
    expect(Math.abs(moved.first - moved.grid * 0.65), `first column ${moved.first}px of ${moved.grid}px`).toBeLessThanOrEqual(2)

    // The right column active: the sidebar's pick replaces it, the left one stays.
    const cells = page.locator('.thread-grid.is-split > .thread-cell')
    await cells.nth(1).locator('.thread-workbench').first().click({ position: { x: 40, y: 200 } })
    await expect(cells.nth(1)).toHaveClass(/is-active/)
    await rowOf(page, c).click()
    await expect(cells.nth(1).locator('.thread-heading-title-main')).toContainText('Gamma fix', { timeout: 15_000 })
    await expect(cells.nth(0).locator('.thread-heading-title-main')).toContainText('Alpha work')

    await app.close()
    ;({ app, page } = await launch())
    await page.locator('button[data-app-mode="thread"]').first().click()
    const again = page.getByRole('separator', { name: cat('thread', 'grid.resize') })
    await expect(again, 'the side-by-side view comes back').toBeVisible({ timeout: 30_000 })
    await expect(again).toHaveAttribute('aria-valuenow', '65')
    const restored = await share(page)
    expect(Math.abs(restored.first - restored.grid * 0.65), `after restart ${restored.first}px of ${restored.grid}px`).toBeLessThanOrEqual(2)
    await page.screenshot({ path: test.info().outputPath('ag06-side-by-side.png') })
  } finally {
    await app.close().catch(() => undefined)
  }
})
