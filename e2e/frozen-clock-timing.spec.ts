import { expect, test } from '@playwright/test'
import { FIXED_NOW, launchApp } from './helpers/launch'

/**
 * F28: the frozen clock of the e2e launcher freezes time but keeps the user timing real. Playwright's fake
 * `performance` dropped marks and measures and returned [] from getEntriesByName, so Monaco's input-latency probe threw
 * page errors while a spec typed into the editor (e2e/close-guard.spec.ts, which now runs under the frozen clock too).
 */
test('the frozen clock keeps Date fixed and the user timing real; the timing stays real after a reload', async () => {
  const { app, page } = await launchApp()
  try {
    const probe = () => page.evaluate(() => {
      performance.mark('f28/start')
      performance.mark('f28/end')
      performance.measure('f28', 'f28/start', 'f28/end')
      const entry = performance.getEntriesByName('f28')[0]
      const found = performance.getEntriesByType('measure').some(item => item.name === 'f28')
      performance.clearMarks('f28/start'); performance.clearMarks('f28/end'); performance.clearMeasures('f28')
      return { now: Date.now(), measured: typeof entry?.duration === 'number', found, cleared: performance.getEntriesByName('f28').length === 0 }
    })
    expect(await probe()).toEqual({ now: FIXED_NOW, measured: true, found: true, cleared: true })
    // After a reload the user timing is real too (whether Date is still frozen there is the clock's business).
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    expect(await probe()).toMatchObject({ measured: true, found: true, cleared: true })
  } finally {
    await app.close()
  }
})
