import { _electron as electron, expect, test } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from '../helpers/launch'

/**
 * #337 (test runs never reach the running app) black box. The run is started with SENTINEL values in place of the live
 * app's variables (the caller sets them; the person's real values are never in play). Checks that none survives:
 * - in the spec's own process (the config scrubs it);
 * - in the main process of an app started by the shared launchApp helper (mock) and by a careless real-app launch that
 *   passes ...process.env;
 * - in a real pane terminal of that app (what an agent would inherit), beyond the values the app sets itself.
 * Output: e2e/screenshots/homologation/check-337/notes.json
 */
const OUT = join(process.cwd(), 'e2e', 'screenshots', 'homologation', 'check-337')
mkdirSync(OUT, { recursive: true })
const SENTINEL = /acc-sentinel/
const notes: Record<string, unknown> = {}
const sentinelKeys = (env: Record<string, string | undefined>) => Object.entries(env).filter(([, v]) => v && SENTINEL.test(v)).map(([k]) => k)

test.afterAll(() => writeFileSync(join(OUT, 'notes.json'), JSON.stringify(notes, null, 2)))

test('#337: the spec process carries no sentinel', () => {
  notes.specProcess = sentinelKeys(process.env)
  // Test switches the scrub must leave alone (the run sets them to acc-keep).
  notes.kept = ['OXESPACE_MEMORY_RUNNER', 'EXPERIMENTAL_MEMORY', 'AI_MEMORY_TEST_BINARY'].map(k => `${k}=${process.env[k] ?? '(gone)'}`)
  expect(notes.specProcess).toEqual([])
  expect(notes.kept).toEqual(['OXESPACE_MEMORY_RUNNER=acc-keep', 'EXPERIMENTAL_MEMORY=acc-keep', 'AI_MEMORY_TEST_BINARY=acc-keep'])
})

test('#337: the shared launchApp helper starts the app without them', async () => {
  const { app } = await launchApp({ locale: 'en-US' })
  try {
    notes.launchAppMain = await app.evaluate(() => Object.entries(process.env).filter(([, v]) => v && /acc-sentinel/.test(v)).map(([k]) => k))
    expect(notes.launchAppMain).toEqual([])
  } finally { await app.close() }
})

test('#337: a careless real-app launch and its pane terminal stay clear', async () => {
  test.setTimeout(120_000)
  const root = mkdtempSync(join(tmpdir(), 'oxespace-hml-337-'))
  const repo = join(root, 'repo'); mkdirSync(repo)
  const dump = join(root, 'pane-env.json')
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e', 'electron-main.cjs')], env: { ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_DB_PATH: join(root, 'oxespace.sqlite3') } as Record<string, string> })
  try {
    notes.realMain = await app.evaluate(() => Object.entries(process.env).filter(([, v]) => v && /acc-sentinel/.test(v)).map(([k]) => k))
    const page = await app.firstWindow()
    await page.getByTestId('btn-new-workspace').first().waitFor({ timeout: 30_000 })
    await page.getByTestId('btn-new-workspace').first().click()
    await page.getByTestId('wizard-dir-input').fill(repo)
    await page.getByTestId('wizard-launch-btn').click()
    await page.locator('[data-testid="pane-container"] .xterm').first().click({ timeout: 20_000 })
    const script = join(root, 'dump.js')
    writeFileSync(script, `require('fs').writeFileSync(${JSON.stringify(dump)}, JSON.stringify(Object.fromEntries(Object.entries(process.env).filter(([k]) => /^OXESPACE_/i.test(k)).map(([k, v]) => [k, /acc-sentinel/.test(v) ? 'SENTINEL' : 'own']))))`)
    await page.keyboard.type(`node "${script}"`); await page.keyboard.press('Enter')
    await expect.poll(() => existsSync(dump), { timeout: 15_000 }).toBe(true)
    notes.paneTerminal = JSON.parse(readFileSync(dump, 'utf8'))
    expect(notes.realMain, 'main of a careless launch').toEqual([])
    expect(Object.entries(notes.paneTerminal as Record<string, string>).filter(([, v]) => v === 'SENTINEL').map(([k]) => k), 'pane terminal').toEqual([])
  } finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined) }
})
