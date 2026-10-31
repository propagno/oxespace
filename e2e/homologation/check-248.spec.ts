import { test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, openDemoWorkspace, resizeWindow } from '../helpers/launch'

/** #248 on main: OxePod status dots are round 8×8 in light and dark, and nothing else picks up the dot look. */
const OUT = join(process.cwd(), 'e2e', 'screenshots', 'homologation', 'check-248')
mkdirSync(OUT, { recursive: true })
for (const appearance of ['light', 'dark'] as const) {
  test(`OxePod dots: ${appearance}`, async () => {
    test.setTimeout(120_000)
    const { app, page, workspaceRoot, consoleErrors } = await launchApp({ appearance })
    try {
      await resizeWindow(app, 1280, 860)
      await openDemoWorkspace(page, workspaceRoot)
      await page.keyboard.press('Control+4')
      await page.waitForTimeout(1_500)
      const dots = await page.evaluate(() => [...document.querySelectorAll('main *, [class*="pod" i] *')].filter(el => {
        const r = el.getBoundingClientRect(); return r.width > 0 && r.width <= 14 && r.height <= 14 && /dot|status/i.test(String((el as HTMLElement).className))
      }).map(el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return `${String((el as HTMLElement).className).slice(0, 50)} ${Math.round(r.width * 10) / 10}x${Math.round(r.height * 10) / 10} radius=${s.borderRadius} bg=${s.backgroundColor}` }))
      await page.screenshot({ path: join(OUT, `${appearance}.png`) })
      writeFileSync(join(OUT, `${appearance}.json`), JSON.stringify({ dots: [...new Set(dots)], errors: consoleErrors }, null, 2))
    } finally { await app.close() }
  })
}
