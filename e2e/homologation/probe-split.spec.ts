import { test } from '@playwright/test'
import { join } from 'node:path'
import { launchApp, openDemoWorkspace, resizeWindow } from '../helpers/launch'

test('probe: Split pane right from the palette, then the palette again', async () => {
  test.setTimeout(90_000)
  const { app, page, workspaceRoot, consoleErrors } = await launchApp({ appearance: 'light' })
  try {
    await resizeWindow(app, 1280, 860)
    await openDemoWorkspace(page, workspaceRoot)
    await page.keyboard.press('Control+k'); await page.locator('[cmdk-root]').waitFor()
    await page.keyboard.insertText('Split pane right')
    await page.locator('[cmdk-item]').first().click()
    await page.waitForTimeout(1_000)
    const focus = await page.evaluate(() => { const e = document.activeElement as HTMLElement; return `${e?.tagName} ${e?.className?.toString().slice(0, 60)}` })
    await page.screenshot({ path: join(process.cwd(), 'e2e', 'screenshots', 'homologation', 'audit-menus', 'after-split.png') })
    await page.keyboard.press('Control+k')
    const reopened = await page.locator('[cmdk-root]').waitFor({ timeout: 3_000 }).then(() => true, () => false)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: /Files & commands/ }).first().click().catch(e => console.log('BUTTON', String(e).slice(0, 100)))
    const reopenedByButton = await page.locator('[cmdk-root]').waitFor({ timeout: 3_000 }).then(() => true, () => false)
    const panes = await page.locator('.xterm').count()
    console.log('SPLIT', JSON.stringify({ focus, reopened, reopenedByButton, panes, errors: consoleErrors.map(e => e.slice(0, 300)) }))
  } finally { await app.close() }
})
