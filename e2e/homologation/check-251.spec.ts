import { test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, openDemoWorkspace, resizeWindow } from '../helpers/launch'

/**
 * #251 (F7 perceived performance) on main, black box: how fast Settings shows something after Ctrl+, (shell, skeleton,
 * real content), whether the layout jumps while it loads (CLS-like), and the same for the first open of OxeQuery and
 * OxeChat. Three runs, cold then warm. en, light. Output: e2e/screenshots/homologation/check-251/
 */
const OUT = join(process.cwd(), 'e2e', 'screenshots', 'homologation', 'check-251')
mkdirSync(OUT, { recursive: true })

async function watch(page: Page, trigger: () => Promise<void>, selectors: { shell: string; content: string }) {
  await page.evaluate(() => { const w = window as unknown as { __shift: number }; w.__shift = 0; new PerformanceObserver(list => { for (const e of list.getEntries() as unknown as Array<{ value: number; hadRecentInput: boolean }>) if (!e.hadRecentInput) w.__shift += e.value }).observe({ type: 'layout-shift', buffered: false }) })
  const t0 = Date.now(); await trigger()
  const seen: Record<string, number | null> = { shell: null, skeleton: null, content: null }
  for (let i = 0; i < 200 && seen.content === null; i++) {
    const s = await page.evaluate(sel => ({ shell: !!document.querySelector(sel.shell), skeleton: !!document.querySelector('[aria-busy="true"], [class*="skeleton" i]'), content: !!document.querySelector(sel.content) }), selectors)
    const t = Date.now() - t0
    if (s.shell && seen.shell === null) seen.shell = t
    if (s.skeleton && seen.skeleton === null) seen.skeleton = t
    if (s.content && seen.content === null) seen.content = t
    await page.waitForTimeout(16)
  }
  return { ...seen, layoutShift: Number((await page.evaluate(() => (window as unknown as { __shift: number }).__shift)).toFixed(4)) }
}

test('perceived performance: Settings, OxeQuery, OxeChat (en)', async () => {
  test.setTimeout(180_000)
  const notes: Record<string, unknown> = {}
  const t0 = Date.now()
  const { app, page, workspaceRoot, consoleErrors } = await launchApp({ appearance: 'light' })
  try {
    await page.getByTestId('btn-new-workspace').first().waitFor()
    notes.interactiveMs = Date.now() - t0
    await resizeWindow(app, 1280, 860)
    await openDemoWorkspace(page, workspaceRoot)
    const runs: unknown[] = []
    for (let r = 0; r < 3; r++) {
      runs.push({ settings: await watch(page, () => page.keyboard.press('Control+,'), { shell: '.settings-center', content: '.settings-center h1, .settings-center h2' }) })
      for (let i = 0; i < 3; i++) await page.keyboard.press('Escape')
      await page.waitForTimeout(300)
    }
    notes.settings = runs
    notes.oxequery = await watch(page, () => page.locator('button[data-app-mode="data"]').click(), { shell: '.oq-sidebar, [class*="oxequery" i]', content: '.oq-sidebar' })
    notes.oxechat = await watch(page, () => page.locator('button[data-app-mode="thread"]').click(), { shell: '.thread-navigation', content: '.thread-navigation' })
    await page.screenshot({ path: join(OUT, 'end.png') })
    notes.errors = consoleErrors
  } finally {
    writeFileSync(join(OUT, 'notes.json'), JSON.stringify(notes, null, 2))
    await app.close()
  }
})
