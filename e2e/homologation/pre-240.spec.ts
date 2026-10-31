import { _electron as electron, test, type Page } from '@playwright/test'
import { cleanEnv } from './clean-env'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp, openDemoWorkspace, resizeWindow } from '../helpers/launch'

/**
 * #240 (F19) pre-homologation, black box: a split past the largest layout, then split spam by shortcut and palette,
 * in the mock (any size) and in the real app (which refuses), in pt-BR. The window must stay, the palette must open,
 * and a refusal must be a translated sentence. Output: e2e/screenshots/homologation/pre-240/
 */
const OUT = join(process.cwd(), 'e2e', 'screenshots', 'homologation', 'pre-240')
mkdirSync(OUT, { recursive: true })
const notes: Record<string, unknown> = {}
test.afterAll(() => writeFileSync(join(OUT, 'notes.json'), JSON.stringify(notes, null, 2)))

async function command(page: Page, value: string, typed: string) {
  for (let i = 0; i < 3; i++) await page.keyboard.press('Escape')
  await page.keyboard.press('Control+k')
  if (!(await page.locator('[cmdk-root]').waitFor({ timeout: 3_000 }).then(() => true, () => false))) return 'palette did not open'
  await page.keyboard.insertText(typed)
  await page.waitForTimeout(200)
  const option = page.locator(`[cmdk-item][data-value="${value}"]`).first()
  if (!(await option.isVisible().catch(() => false))) return `not found: ${typed}`
  await option.click()
  await page.waitForTimeout(900)
  return 'ok'
}
const state = (page: Page) => page.evaluate(() => ({
  panes: document.querySelectorAll('.xterm').length,
  toasts: [...document.querySelectorAll('[data-sonner-toast]')].map(t => (t.textContent ?? '').trim().slice(0, 160)),
  boundaries: [...document.querySelectorAll('[role="alert"]')].map(t => (t.textContent ?? '').trim().slice(0, 120)),
  sidebar: !!document.querySelector('[data-testid="btn-new-workspace"]')
}))
async function scenario(page: Page, label: string, errors: string[]) {
  const steps: unknown[] = []
  steps.push(['layout 16', await command(page, 'cmd-layout-16', '16'), await state(page)])
  steps.push(['split right', await command(page, 'cmd-split-vertical', 'split'), await state(page)])
  await page.screenshot({ path: join(OUT, `${label}-after-split.png`) })
  // Spam: the shortcut five times on whatever pane has focus, then the palette again.
  await page.locator('.xterm').last().click().catch(() => undefined)
  for (let i = 0; i < 5; i++) { await page.keyboard.press('Control+Shift+Backslash'); await page.waitForTimeout(150) }
  await page.waitForTimeout(800)
  steps.push(['shortcut x5', await state(page)])
  steps.push(['split right again', await command(page, 'cmd-split-vertical', 'split'), await state(page)])
  steps.push(['layout 1', await command(page, 'cmd-layout-1', '1'), await state(page)])
  steps.push(['layout 16 again', await command(page, 'cmd-layout-16', '16'), await state(page)])
  await page.waitForTimeout(4_000)
  steps.push(['titles after 4s', await page.evaluate(() => [...document.querySelectorAll('.xterm')].map(x => { const pane = x.closest('[class*="pane"]'); const head = pane?.querySelector('[class*="title"], [class*="header"]'); return `${(head?.textContent ?? '').trim().slice(0, 24)}|${((x.querySelector('.xterm-rows')?.textContent) ?? '').trim().length}` }))])
  await page.screenshot({ path: join(OUT, `${label}${process.env.HML_TAG ?? ''}-end.png`) })
  await page.keyboard.press('Control+k')
  const reopened = await page.locator('[cmdk-root]').waitFor({ timeout: 3_000 }).then(() => true, () => false)
  notes[label] = { steps, reopened, errors: [...errors] }
  console.log('PRE240', label, JSON.stringify({ reopened, last: steps.at(-1), errors: errors.filter(e => /rows|TypeError|boundary/i.test(e)) }))
}

test('mock: past the presets, pt-BR dark', async () => {
  test.setTimeout(180_000)
  const { app, page, workspaceRoot, consoleErrors } = await launchApp({ locale: 'pt-BR', appearance: 'dark' })
  try {
    await resizeWindow(app, 1280, 860)
    await openDemoWorkspace(page, workspaceRoot)
    await scenario(page, 'mock-pt', consoleErrors)
  } finally { await app.close() }
})

test('real app refuses: pt-BR light', async () => {
  test.setTimeout(240_000)
  const root = mkdtempSync(join(tmpdir(), 'oxespace-hml-240-'))
  const repo = join(root, 'demo-repo'); mkdirSync(repo)
  execFileSync('git', ['init', '-q'], { cwd: repo })
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e', 'electron-main.cjs')], env: { ...cleanEnv(), OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_DB_PATH: join(root, 'oxespace.sqlite3'), OXESPACE_LOCALE: 'pt-BR' } })
  const errors: string[] = []
  try {
    const page = await app.firstWindow()
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
    page.on('pageerror', e => errors.push(String(e)))
    await page.setViewportSize({ width: 1280, height: 860 }).catch(() => undefined)
    await page.getByTestId('btn-new-workspace').first().waitFor({ timeout: 30_000 })
    await page.getByTestId('btn-new-workspace').first().click()
    await page.getByTestId('wizard-dir-input').fill(repo)
    await page.getByTestId('wizard-launch-btn').click()
    await page.waitForTimeout(4_000)
    await scenario(page, 'real-pt', errors)
  } finally { await app.close() }
})
