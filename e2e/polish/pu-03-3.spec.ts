// Frozen end-to-end acceptance test for 1.5.2 OxeCode/Shell F6 (Jira OXE-208, PU-03·3, CA-3), in the built app on a fresh
// profile with real services (OXESPACE_E2E_MOCK_NATIVE=0). Written by the planner; the executor must not edit it. Red until
// the card's task (after T31, whose OxeMark carries data-ui="brand-mark").
// Contract: in the dark theme, every OxeLogo tile on the first run's window (the title bar's app icon and the first run's
// mark, when it has a tile) has a computed stroke equal to --bd-subtle; in the light theme the tile has no stroke.
import { expect, test, type Page } from '@playwright/test'
import { launchApp, layoutAtWidth, setAppearance } from '../helpers/launch'

/** The colour a token resolves to here, read through a probe element. */
const tokenColor = (page: Page, token: string): Promise<string> => page.evaluate(name => {
  const probe = document.createElement('div')
  probe.style.color = `var(${name})`
  document.body.appendChild(probe)
  const value = getComputedStyle(probe).color
  probe.remove()
  return value
}, token)
const strokes = (page: Page): Promise<string[]> => page.locator('svg[data-ui="brand-mark"] rect').evaluateAll(rects => rects.map(rect => getComputedStyle(rect).stroke))

test('PU-03·3 in the app: the Ramo tile is outlined in --bd-subtle on the dark canvas, and only there', async () => {
  test.setTimeout(180_000)
  const { app, page } = await launchApp({ appearance: 'dark', env: { OXESPACE_E2E_MOCK_NATIVE: '0' } })
  try {
    await layoutAtWidth(app, page, 1440, 900)
    await expect(page.getByTestId('first-run')).toBeVisible()
    await expect(page.locator('svg[data-ui="brand-mark"] rect')).not.toHaveCount(0)
    const subtle = await tokenColor(page, '--bd-subtle')
    for (const stroke of await strokes(page)) expect(stroke).toBe(subtle)

    await setAppearance(page, 'light')
    await expect(page.getByTestId('first-run')).toBeVisible()
    await expect(page.locator('svg[data-ui="brand-mark"] rect')).not.toHaveCount(0)
    for (const stroke of await strokes(page)) expect(stroke).toBe('none')
  } finally {
    await app.close()
  }
})
