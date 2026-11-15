// Frozen end-to-end acceptance test for 1.5.2 OxeCode/Shell F6 (Jira OXE-209, PU-03·5, CA-3), in the built app on a fresh
// profile in pt-BR with real services (OXESPACE_E2E_MOCK_NATIVE=0). Written by the planner; the executor must not edit
// it. Red until the card's task (after T31).
// Contract: the first run's title [data-ui=first-run-title] computes font-size equal to --fs-display, font-stretch equal
// to --stretch-display, and a balanced wrap (text-wrap / text-wrap-style balance), in both densities.
import { expect, test, type Page } from '@playwright/test'
import { launchApp, resizeWindow, setAppearance } from '../helpers/launch'

const token = (page: Page, prop: 'font-size' | 'font-stretch', name: string): Promise<string> => page.evaluate(([property, tokenName]) => {
  const probe = document.createElement('div')
  probe.style.setProperty(property, `var(${tokenName})`)
  document.body.appendChild(probe)
  const value = getComputedStyle(probe).getPropertyValue(property)
  probe.remove()
  return value
}, [prop, name] as const)

test('PU-03·5 in the app: the first run\'s title is --fs-display, --stretch-display and balanced', async () => {
  test.setTimeout(180_000)
  const { app, page } = await launchApp({ appearance: 'light', locale: 'pt-BR', env: { OXESPACE_E2E_MOCK_NATIVE: '0' } })
  try {
    await resizeWindow(app, 1440, 900)
    for (const density of ['compact', 'comfortable'] as const) {
      await setAppearance(page, 'light', density)
      const title = page.locator('[data-ui="first-run-title"]')
      await expect(title).toHaveCount(1)
      const style = await title.evaluate(el => { const s = getComputedStyle(el); return { size: s.fontSize, stretch: s.fontStretch, wrap: `${s.getPropertyValue('text-wrap')} ${s.getPropertyValue('text-wrap-style')}` } })
      expect(style.size, density).toBe(await token(page, 'font-size', '--fs-display'))
      expect(style.stretch, density).toBe(await token(page, 'font-stretch', '--stretch-display'))
      expect(style.wrap, density).toMatch(/balance/)
    }
  } finally {
    await app.close()
  }
})
