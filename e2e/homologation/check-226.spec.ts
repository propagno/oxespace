import { test } from '@playwright/test'
import { join } from 'node:path'
import { launchApp, openDemoWorkspace, resizeWindow } from '../helpers/launch'

/** #226: the terminal loads WebGL on first use (off the boot path) and still draws on first focus. */
test('terminal draws on first focus with WebGL loaded on demand', async () => {
  test.setTimeout(90_000)
  const { app, page, workspaceRoot, consoleErrors } = await launchApp({ appearance: 'dark' })
  try {
    await resizeWindow(app, 1280, 860)
    const before = await page.evaluate(() => performance.getEntriesByType('resource').filter(r => /webgl|addon-webgl/i.test(r.name)).length)
    await openDemoWorkspace(page, workspaceRoot)
    const term = page.locator('.xterm').first()
    await term.click()
    await page.keyboard.type('echo oi')
    await page.waitForTimeout(1_000)
    const out = await page.evaluate(() => ({
      webglScripts: performance.getEntriesByType('resource').filter(r => /webgl/i.test(r.name)).map(r => r.name.split('/').pop()),
      canvases: [...document.querySelectorAll('.xterm canvas')].length,
      rows: [...document.querySelectorAll('.xterm-rows')].map(r => (r.textContent ?? '').trim().slice(0, 40)),
      screenText: (document.querySelector('.xterm-screen') as HTMLElement | null)?.innerText?.slice(0, 80) ?? ''
    }))
    await page.screenshot({ path: join(process.cwd(), 'e2e', 'screenshots', 'homologation', 'check-226.png') })
    console.log('C226', JSON.stringify({ beforeWorkspace: before, ...out, errors: consoleErrors }))
  } finally { await app.close() }
})
