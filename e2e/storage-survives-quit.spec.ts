// OXE-396: a side-by-side view changed about 300 ms before a normal quit comes back at the next start. Chromium writes
// localStorage to disk only a few seconds after a change; without a flush on quit, a process that ended early lost it
// (cause proven in runs 45073897324 and 45076001890). The second case quits normally but ends the process at
// will-quit, after the drain, as OXE-392's abort on quit does; it lost the view every time before the flush.
// Linux only, as ag06: the stand-in agent is a script, and on Windows the app launches only a native .exe.
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { withoutLiveApp } from './helpers/live-app-env'

const resize = (): string => {
  const catalog = JSON.parse(readFileSync(join(process.cwd(), 'shared/locales/en/thread.json'), 'utf8')) as { grid?: { resize?: unknown } }
  if (typeof catalog.grid?.resize !== 'string') throw new Error('the en thread catalog has no grid.resize')
  return catalog.grid.resize
}
const STAND_IN = String.raw`#!/usr/bin/env node
const args = process.argv.slice(2)
if (args[0] === '--version' || args[0] === '-v') { process.stdout.write('2.1.0 (Claude Code)\n'); process.exit(0) }
if (args[0] === 'auth' && args[1] === 'status') { process.stdout.write(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'stand-in' })); process.exit(0) }
process.stdin.on('data', () => undefined)
process.stdin.on('end', () => process.exit(0))
`

/** A fresh profile: its repo, the stand-in agent on PATH, and the database and user data every launch reuses. */
function profile(): { root: string; repo: string; bin: string } {
  const root = mkdtempSync(join(tmpdir(), 'oxe-storage-quit-'))
  const repo = join(root, 'repo'), bin = join(root, 'bin')
  mkdirSync(repo, { recursive: true }); mkdirSync(bin, { recursive: true })
  writeFileSync(join(bin, 'claude'), STAND_IN); chmodSync(join(bin, 'claude'), 0o755)
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo })
  execFileSync('git', ['-c', 'user.email=e2e@example.invalid', '-c', 'user.name=e2e', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: repo })
  return { root, repo, bin }
}
async function launch(p: { root: string; bin: string }): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e', 'electron-main.cjs')], env: {
    ...withoutLiveApp(process.env), TZ: 'UTC', OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '0', OXESPACE_LOCALE: 'en-US',
    OXESPACE_DB_PATH: join(p.root, 'oxespace.sqlite3'), PATH: `${p.bin}${delimiter}${process.env.PATH ?? ''}`,
    CLAUDE_CONFIG_DIR: join(p.root, 'claude-config'), CODEX_HOME: join(p.root, 'codex-home'), ANTHROPIC_API_KEY: '', OPENAI_API_KEY: ''
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

/** Two conversations side by side at 65 %, the change made just now. */
async function arrangeSplit(page: Page, repo: string): Promise<void> {
  await page.getByTestId('btn-new-workspace').click()
  await page.getByTestId('wizard-dir-input').fill(repo)
  await page.getByTestId('wizard-launch-btn').click()
  await page.waitForSelector('[data-testid="workspace-grid"], [data-testid="workspace-split-grid"]', { timeout: 15_000 })
  const project = await oxe<{ projectId: string }>(page, 'thread.addProject', realpathSync.native(repo))
  const ids: string[] = []
  for (const title of ['Alpha work', 'Beta review']) {
    const snap = await oxe<{ thread: { id: string } }>(page, 'thread.create', { projectId: project.projectId, rootPath: realpathSync.native(repo), provider: 'claude' })
    await oxe(page, 'thread.command', snap.thread.id, `/rename ${title}`)
    ids.push(snap.thread.id)
  }
  await page.locator('button[data-app-mode="thread"]').first().click()
  const row = page.locator(`[data-thread-row="${ids[0]}"] [data-list-item]`).first()
  await expect(row).toBeVisible({ timeout: 30_000 })
  await row.click()
  await page.locator(`[data-thread-row="${ids[1]}"]`).getByRole('button', { name: 'Open Beta review side by side' }).click({ force: true })
  const divider = page.getByRole('separator', { name: resize() })
  await expect(divider).toBeVisible({ timeout: 15_000 })
  await divider.focus()
  await page.keyboard.press('End')
  await expect(divider).toHaveAttribute('aria-valuenow', '65')
}

async function expectSplitBack(page: Page): Promise<void> {
  await page.locator('button[data-app-mode="thread"]').first().click()
  const divider = page.getByRole('separator', { name: resize() })
  await expect(divider, 'the side-by-side view comes back').toBeVisible({ timeout: 15_000 })
  await expect(divider).toHaveAttribute('aria-valuenow', '65')
}

test.skip(process.platform === 'win32', 'the stand-in agent is a script; on Windows the app launches only a native .exe')

test('a split changed 300 ms before a normal quit is there at the next start', async () => {
  test.setTimeout(120_000)
  const p = profile()
  let { app, page } = await launch(p)
  try {
    await arrangeSplit(page, p.repo)
    await page.waitForTimeout(300)
    await app.close()
    ;({ app, page } = await launch(p))
    await expectSplitBack(page)
  } finally {
    await app.close().catch(() => undefined)
  }
})

test('a normal quit whose process ends at will-quit, after the drain, keeps the split', async () => {
  test.setTimeout(120_000)
  const p = profile()
  let { app, page } = await launch(p)
  try {
    await arrangeSplit(page, p.repo)
    await page.waitForTimeout(300)
    // As OXE-392's abort on quit: the drain and every before-quit listener run, then the process dies at once.
    await app.evaluate(({ app: electronApp }) => { electronApp.once('will-quit', () => { process.kill(process.pid, 'SIGKILL') }) })
    const ended = new Promise<string>(resolve => app.process().once('exit', (code, signal) => resolve(`${code}/${signal}`)))
    await app.evaluate(({ app: electronApp }) => { electronApp.quit() })
    expect(await ended, 'the process ended at will-quit').toBe('null/SIGKILL')
    ;({ app, page } = await launch(p))
    await expectSplitBack(page)
  } finally {
    await app.close().catch(() => undefined)
  }
})
