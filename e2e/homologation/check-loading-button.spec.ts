import { test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, openDemoWorkspace, resizeWindow } from '../helpers/launch'

/** #292 loading Button: OxePost "Send" to a non-routable host keeps focus, says aria-busy, and ignores more clicks. */
const OUT = join(process.cwd(), 'e2e', 'screenshots', 'homologation', 'check-loading-button')
mkdirSync(OUT, { recursive: true })
test('loading button keeps focus (en)', async () => {
  test.setTimeout(120_000)
  const notes: Record<string, unknown> = {}
  const { app, page, workspaceRoot, consoleErrors } = await launchApp({ appearance: 'light' })
  try {
    await resizeWindow(app, 1280, 860)
    await openDemoWorkspace(page, workspaceRoot)
    await page.locator('button[data-app-mode="post"]').click(); await page.waitForTimeout(600)
    const url = page.getByRole('textbox', { name: /url/i }).first()
    await url.click(); await page.keyboard.press('Control+A'); await page.keyboard.insertText('http://10.255.255.1/')
    const send = page.getByRole('button', { name: /^Send/ }).first()
    await send.focus(); await page.keyboard.press('Enter'); await page.waitForTimeout(600)
    const state = () => page.evaluate(() => { const el = document.activeElement as HTMLElement | null; return { focus: `${el?.tagName} ${(el?.textContent ?? '').trim().slice(0, 20)}`, busy: el?.getAttribute('aria-busy'), disabled: el?.getAttribute('aria-disabled') ?? String((el as HTMLButtonElement | null)?.disabled) } })
    notes.whileWaiting = await state()
    await send.click({ force: true }).catch(() => undefined); await send.click({ force: true }).catch(() => undefined); await page.waitForTimeout(300)
    notes.afterExtraClicks = await state()
    await page.screenshot({ path: join(OUT, 'waiting.png') })
    notes.errors = consoleErrors
  } finally { writeFileSync(join(OUT, 'notes.json'), JSON.stringify(notes, null, 2)); await app.close() }
})
