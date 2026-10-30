import { _electron as electron, expect, test } from '@playwright/test'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connectFromContainer } from './helpers/oxepod'

/**
 * Every OxeQuery dialog, menu and popover opens with focus inside it, keeps Tab inside (dialogs),
 * closes on Escape and gives focus back to the control that opened it.
 */
test('OxeQuery overlays take focus, trap Tab, close on Escape and return focus', async () => {
  test.setTimeout(240_000)
  const root = mkdtempSync(join(tmpdir(), 'oxespace-oxequery-overlays-'))
  const repo = join(root, 'repo'); mkdirSync(repo)
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e/electron-main.cjs')], env: {
    ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_DB_PATH: join(root, 'app.sqlite3')
  } })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.getByTestId('btn-new-workspace').click()
    await page.getByTestId('wizard-dir-input').fill(repo)
    await page.getByTestId('wizard-layout-card-1').click()
    await page.getByTestId('wizard-launch-btn').click()
    await page.getByRole('navigation', { name: 'Application view' }).getByRole('button', { name: 'OxeQuery' }).click()

    const insideOverlay = (): Promise<boolean> => page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"], [role="alertdialog"], [role="menu"], [aria-modal="true"]')))
    const focusedName = (): Promise<string> => page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute('aria-label') ?? document.activeElement?.textContent?.trim() ?? '')

    /** Opens, checks focus and Tab, closes with Escape and checks that focus came back to `opener`. */
    const exercise = async (name: string, opener: () => ReturnType<typeof page.getByRole>, surface: () => ReturnType<typeof page.getByRole>, options: { trapsTab?: boolean } = {}): Promise<void> => {
      const trigger = opener()
      await trigger.focus()
      await trigger.click()
      const overlay = surface()
      await expect(overlay, `${name} opens`).toBeVisible()
      await expect.poll(insideOverlay, { message: `${name} moves focus inside` }).toBe(true)
      if (options.trapsTab !== false) {
        for (let index = 0; index < 8; index++) {
          await page.keyboard.press('Tab')
          expect(await insideOverlay(), `${name} keeps Tab inside (press ${index + 1})`).toBe(true)
        }
      }
      await page.keyboard.press('Escape')
      await expect(overlay, `${name} closes on Escape`).toBeHidden()
      await expect.poll(async () => (await trigger.evaluate(element => element === document.activeElement)), { message: `${name} returns focus to its opener (focus is on "${await focusedName()}")` }).toBe(true)
    }

    // The welcome page.
    await exercise('New connection', () => page.getByRole('button', { name: 'New connection' }).first(), () => page.getByRole('dialog', { name: 'New connection' }))
    await exercise('New database', () => page.getByRole('button', { name: 'New local database' }), () => page.getByRole('dialog', { name: 'New database' }))
    await exercise('OxeQuery settings', () => page.getByRole('button', { name: 'OxeQuery settings' }), () => page.getByRole('dialog', { name: 'OxeQuery settings' }))

    // SQL workbench.
    await connectFromContainer(page, 'pg-dev')
    await expect(page.getByRole('tab', { name: 'pg-dev' })).toBeVisible()
    await exercise('Edit connection', () => page.getByRole('button', { name: 'Edit pg-dev' }), () => page.getByRole('dialog', { name: 'Edit connection' }))
    await exercise('Server panel', () => page.getByRole('button', { name: 'Server: databases and roles' }), () => page.getByRole('dialog', { name: /Server of/ }))
    await exercise('Library', () => page.getByRole('button', { name: 'Library' }), () => page.getByRole('dialog', { name: 'Saved queries and history' }), { trapsTab: false })
    await exercise('Ask agent menu', () => page.getByRole('button', { name: 'Ask agent' }), () => page.getByRole('menu', { name: 'Ask agent' }), { trapsTab: false })
  } finally { await app.close() }
})
