// Frozen end-to-end acceptance test for 1.5.2 OxeCode/Shell F6 (Jira OXE-207, PU-03·2, CA-3), in the built app with real
// services (OXESPACE_E2E_MOCK_NATIVE=0). Written by the planner; the executor must not edit it. Red until the card's task.
// Contract: under prefers-reduced-motion: reduce, the boot splash's arms (the markup of index.html, styled by the built
// splash stylesheet) compute animation-name none; and a saved "Reduced" motion choice marks the document
// data-motion="reduce" when the page loads again.
// React replaces the splash on its first render, so the spec puts the splash's own markup back in the loaded page to read
// the stylesheet's result.
import { expect, test } from '@playwright/test'
import { launchApp } from '../helpers/launch'

const SPLASH = '<div class="oxe-splash" data-e2e-splash=""><svg width="72" height="72" viewBox="0 0 48 48"><rect class="oxe-splash-tile" width="48" height="48" rx="11"/>'
  + '<g><path class="oxe-splash-arm" d="M12 15h8v8h-8z"/><path class="oxe-splash-arm oxe-splash-arm-late" d="M28 18h8v8h-8z"/></g></svg></div>'

test('PU-03·2 in the app: the splash does not animate under reduced motion', async () => {
  test.setTimeout(180_000)
  const { app, page } = await launchApp({ appearance: 'light', env: { OXESPACE_E2E_MOCK_NATIVE: '0' } })
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.evaluate(html => { document.body.insertAdjacentHTML('beforeend', html) }, SPLASH)
    const names = await page.locator('[data-e2e-splash] .oxe-splash-arm').evaluateAll(arms => arms.map(arm => getComputedStyle(arm).animationName))
    expect(names).toEqual(['none', 'none'])

    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.evaluate(() => {
      const raw = localStorage.getItem('oxe-settings')
      const saved = raw ? JSON.parse(raw) as { state?: Record<string, unknown>; version?: number } : { state: {}, version: 3 }
      localStorage.setItem('oxe-settings', JSON.stringify({ ...saved, state: { ...(saved.state ?? {}), motion: 'reduce' } }))
    })
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.motion)).toBe('reduce')
    await page.evaluate(html => { document.body.insertAdjacentHTML('beforeend', html) }, SPLASH)
    const saved = await page.locator('[data-e2e-splash] .oxe-splash-arm').evaluateAll(arms => arms.map(arm => getComputedStyle(arm).animationName))
    expect(saved).toEqual(['none', 'none'])
  } finally {
    await app.close()
  }
})
