import { test } from '@playwright/test'
import { join } from 'node:path'
import { launchApp, openDemoWorkspace, resizeWindow } from '../helpers/launch'

/** P2-5: does a split past the largest layout break the palette? Runs the given palette commands, then reopens it. */
async function run(page: import('@playwright/test').Page, label: string) {
  await page.keyboard.press('Control+k'); await page.locator('[cmdk-root]').waitFor({ timeout: 5_000 })
  await page.keyboard.insertText(label)
  await page.locator('[cmdk-item]').first().click()
  await page.waitForTimeout(1_200)
}
for (const steps of [['Layout: 16 panes', 'Split pane right'], ['Layout: 8 panes', 'Split pane right']]) {
  test(`probe: ${steps.join(' → ')}`, async () => {
    test.setTimeout(120_000)
    const { app, page, workspaceRoot, consoleErrors } = await launchApp({ appearance: 'light' })
    try {
      await resizeWindow(app, 1280, 860)
      await openDemoWorkspace(page, workspaceRoot)
      for (const step of steps) await run(page, step)
      const panes = await page.locator('.xterm').count()
      await page.screenshot({ path: join(process.cwd(), 'e2e', 'screenshots', 'homologation', 'audit-menus', `probe-${steps[0].replace(/\W+/g, '_')}.png`) })
      for (let i = 0; i < 3; i++) await page.keyboard.press('Escape')
      await page.keyboard.press('Control+k')
      const reopened = await page.locator('[cmdk-root]').waitFor({ timeout: 3_000 }).then(() => true, () => false)
      const state = await page.evaluate(() => ({ focus: `${document.activeElement?.tagName} ${String((document.activeElement as HTMLElement)?.className ?? '').slice(0, 60)}`, dialogs: document.querySelectorAll('[role="dialog"]').length, overlay: !!document.querySelector('[data-state="open"]') }))
      console.log('PROBE', steps.join(' → '), JSON.stringify({ panes, reopened, state, errors: consoleErrors }))
    } finally { await app.close() }
  })
}
