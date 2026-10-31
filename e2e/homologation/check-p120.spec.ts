import { _electron as electron, test } from '@playwright/test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connectFromContainer } from '../helpers/oxepod'

/**
 * Without the helper's frozen clock: (1) P1-20, typing in the OxeQuery editor raises no pageerror; (2) #234, the
 * checklist's "Agent settings" opens Settings › Agents with its readiness. Mock mode, throwaway profile, en.
 */
const OUT = join(process.cwd(), 'e2e', 'screenshots', 'homologation', 'check-p120')
mkdirSync(OUT, { recursive: true })
test('no frozen clock: OxeQuery typing and Agent settings', async () => {
  test.setTimeout(180_000)
  const root = mkdtempSync(join(tmpdir(), 'oxespace-hml-p120-'))
  const repo = join(root, 'repo'); mkdirSync(repo)
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e', 'electron-main.cjs')], env: { ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_DB_PATH: join(root, 'app.sqlite3') } })
  const notes: Record<string, unknown> = {}
  const errors: string[] = []
  try {
    const page = await app.firstWindow()
    page.on('pageerror', e => errors.push(`pageerror: ${String(e).slice(0, 200)}`))
    page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 200)}`) })
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1280, 860) })
    await page.getByTestId('btn-new-workspace').first().waitFor({ timeout: 30_000 })
    // #234: Agent settings from the checklist.
    await page.getByRole('button', { name: /^Agent settings$/ }).first().click()
    await page.waitForTimeout(2_500)
    notes.agentSettings = (await page.locator('.settings-center, [role="dialog"]').last().innerText().catch(() => '')).slice(0, 900)
    await page.screenshot({ path: join(OUT, 'agent-settings.png') })
    notes.errorsAfterSettings = [...errors]
    for (let i = 0; i < 3; i++) await page.keyboard.press('Escape')
    // P1-20: OxeQuery editor typing, the same keys as the audit.
    await page.getByTestId('btn-new-workspace').first().click()
    await page.getByTestId('wizard-dir-input').fill(repo)
    await page.getByTestId('wizard-layout-card-1').click()
    await page.getByTestId('wizard-launch-btn').click()
    await connectFromContainer(page, 'pg-dev')
    const editor = page.locator('.oq-editor .monaco-editor')
    const before = errors.length
    for (const sql of ['SELECT id FROM users', "UPDATE users SET name = 'x' WHERE id = 1", 'DELETE FROM users']) {
      await editor.click(); await page.keyboard.press('Control+A'); await page.keyboard.insertText(sql); await page.keyboard.type(' -- typed', { delay: 30 })
      await page.waitForTimeout(500)
    }
    notes.typingErrors = errors.slice(before)
    await page.screenshot({ path: join(OUT, 'oxequery-typing.png') })
  } finally {
    writeFileSync(join(OUT, 'notes.json'), JSON.stringify({ ...notes, errors }, null, 2))
    await app.close()
  }
})
