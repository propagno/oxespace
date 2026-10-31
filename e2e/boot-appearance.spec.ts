import { expect, test } from '@playwright/test'
import { launchApp } from './helpers/launch'

/**
 * Homologation R1: the boot splash follows the appearance chosen in Settings, not only the operating system's. The
 * window is reloaded with the app's bundle blocked, so only index.html, its boot script and the stylesheet draw it, as
 * on a cold start.
 */
const canvas = (page: import('@playwright/test').Page) => page.locator('.oxe-splash').evaluate(element => getComputedStyle(element).backgroundColor)

test('the splash opens in the chosen mode even when the system asks for the other', async () => {
  test.setTimeout(120_000)
  const { app, page } = await launchApp({ appearance: 'light' })
  try {
    // Dark chosen in the app, light in the system.
    await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('oxe-settings') || '{"state":{}}')
      localStorage.setItem('oxe-settings', JSON.stringify({ ...saved, state: { ...saved.state, appearance: 'dark', motion: 'reduce' } }))
    })
    await page.emulateMedia({ colorScheme: 'light' })
    page.on('console', m => console.log('CONSOLE', m.type(), m.text()))
    page.on('pageerror', e => console.log('PAGEERR', e.message))
    // The app's bundle stays out; public/boot-appearance.js, which runs before the first paint, is kept.
    await page.route(/[\\/]assets[\\/].*\.js(\?.*)?$/, route => route.abort())
    await page.reload()
    await expect(page.locator('.oxe-splash')).toBeVisible()
    console.log('DBG', await page.evaluate(() => [typeof document.getElementById('oxe-boot-appearance'), document.querySelectorAll('script').length].join(',')), await page.evaluate(() => document.documentElement.outerHTML.slice(0, 200)))
    expect(await page.evaluate(() => [document.documentElement.dataset.mode, document.documentElement.dataset.motion])).toEqual(['dark', 'reduce'])
    const dark = await canvas(page)

    // Light chosen, dark system: the other way round.
    await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('oxe-settings') || '{"state":{}}')
      localStorage.setItem('oxe-settings', JSON.stringify({ ...saved, state: { ...saved.state, appearance: 'light' } }))
    })
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.reload()
    expect(await page.evaluate(() => document.documentElement.dataset.mode)).toBe('light')
    expect(await canvas(page)).not.toBe(dark)

    // System follows the operating system through the stylesheet.
    await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('oxe-settings') || '{"state":{}}')
      localStorage.setItem('oxe-settings', JSON.stringify({ ...saved, state: { ...saved.state, appearance: 'system' } }))
    })
    await page.reload()
    expect(await page.evaluate(() => document.documentElement.dataset.mode ?? null)).toBeNull()
    expect(await canvas(page)).toBe(dark)
  } finally {
    await app.close()
  }
})
