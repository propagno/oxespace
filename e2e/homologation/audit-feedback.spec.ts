import { test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, openDemoWorkspace, resizeWindow } from '../helpers/launch'

/**
 * Redesign audit, part 2 (feedback), black box in pt-BR: errors a person causes on purpose (a folder that does not
 * exist, an empty or invalid field) and the words that come back; toasts fired in a burst (stacking, how long they
 * stay, keyboard, role); the copy feedback. Not part of CI. Output: e2e/screenshots/homologation/audit-feedback/
 */
const OUT = join(process.cwd(), 'e2e', 'screenshots', 'homologation', 'audit-feedback')
mkdirSync(OUT, { recursive: true })
const notes: Record<string, unknown> = {}
test.afterAll(() => writeFileSync(join(OUT, 'notes.json'), JSON.stringify(notes, null, 2)))
const shot = (page: Page, name: string) => page.screenshot({ path: join(OUT, `${name}.png`) })
const toasts = (page: Page) => page.evaluate(() => [...document.querySelectorAll('[data-sonner-toast], [role="status"], [role="alert"]')]
  .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 })
  .map(el => ({ role: el.getAttribute('role'), live: el.getAttribute('aria-live'), text: (el.textContent ?? '').trim().slice(0, 120) })))

test('feedback in pt-BR: a folder that does not exist', async () => {
  test.setTimeout(240_000)
  const { app, page, workspaceRoot, consoleErrors } = await launchApp({ locale: 'pt-BR', appearance: 'light' })
  try {
    await resizeWindow(app, 1280, 860)
    // 1. New workspace with a folder that does not exist, then an empty one.
    await page.getByTestId('btn-new-workspace').first().click()
    await page.getByTestId('wizard-dir-input').fill('C:\\nao\\existe\\pasta')
    await page.getByTestId('wizard-launch-btn').click()
    await page.waitForTimeout(1_000)
    notes.wizardMissingFolder = { dialog: (await page.getByRole('dialog').last().innerText().catch(() => '')).slice(0, 700), feedback: await toasts(page) }
    await shot(page, 'wizard-missing-folder')
    notes.createdWorkspaceForMissingFolder = await page.getByText('pasta', { exact: true }).count()
    notes.errors1 = consoleErrors
  } finally { await app.close() }
})

test('feedback in pt-BR: toasts in a burst', async () => {
  test.setTimeout(240_000)
  const { app, page, workspaceRoot, consoleErrors } = await launchApp({ locale: 'pt-BR', appearance: 'light' })
  try {
    await resizeWindow(app, 1280, 860)
    // 2. A real workspace, then a burst of toasts: copy path from the file tree, several times.
    await openDemoWorkspace(page, workspaceRoot)
    writeFileSync(join(workspaceRoot, 'a.md'), '# a\n')
    await page.keyboard.press('Control+k')
    await page.locator('[cmdk-item][data-value="cmd-tool-editor"]').click()
    const file = page.locator('.editor-browser-file', { hasText: 'a.md' })
    await file.waitFor({ timeout: 10_000 }).catch(() => undefined)
    const started = Date.now()
    for (let i = 0; i < 5; i++) {
      await file.click({ button: 'right' }).catch(() => undefined)
      await page.getByRole('menuitem').first().click().catch(() => undefined)
      await page.waitForTimeout(120)
    }
    notes.burst = await toasts(page)
    await shot(page, 'toast-burst')
    // How long does a toast stay?
    let gone = -1
    for (let t = 0; t < 30; t++) { await page.waitForTimeout(500); if ((await page.locator('[data-sonner-toast]').count()) === 0) { gone = Date.now() - started; break } }
    notes.toastLifetimeMs = gone
    // Keyboard: can a toast be reached and closed?
    await file.click({ button: 'right' }).catch(() => undefined)
    await page.getByRole('menuitem').first().click().catch(() => undefined)
    await page.waitForTimeout(200)
    notes.toastCloseButton = await page.locator('[data-sonner-toast] button').evaluateAll(buttons => buttons.map(b => b.getAttribute('aria-label') || b.textContent?.trim()))
    notes.errors = consoleErrors
  } finally { await app.close() }
})
