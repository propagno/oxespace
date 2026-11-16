// Frozen end-to-end acceptance test for 1.5.2 OxeCode/Shell F6 (Jira OXE-243, PM-02·1, CA-4), in the built app with real
// services (OXESPACE_E2E_MOCK_NATIVE=0, real terminals). Written by the planner; the executor must not edit it. Red until
// T27 and the card's task.
// Contract: in the dark theme, after the person picks OxeChat, the selected mode tab computes the dark theme's selected-tab
// colour of the src/ui Tabs list (BRD-09 wins over the card's --fill-selected pair: --tx-primary) and differs from an
// unselected tab's, so the dark theme never falls back to the light rule.
import { expect, test, type Page } from '@playwright/test'
import { launchApp, layoutAtWidth, openDemoWorkspace } from '../helpers/launch'

const tokenColor = (page: Page, token: string): Promise<string> => page.evaluate(name => {
  const probe = document.createElement('div')
  probe.style.color = `var(${name})`
  document.body.appendChild(probe)
  const value = getComputedStyle(probe).color
  probe.remove()
  return value
}, token)

test('PM-02·1 in the app: the selected mode reads in the dark theme', async () => {
  test.setTimeout(180_000)
  const { app, page, workspaceRoot } = await launchApp({ appearance: 'dark', env: { OXESPACE_E2E_MOCK_NATIVE: '0' } })
  try {
    await layoutAtWidth(app, page, 1440, 900)
    await openDemoWorkspace(page, workspaceRoot)
    expect(await page.evaluate(() => document.documentElement.dataset.mode)).toBe('dark')
    const tabs = page.locator('[data-ui="tabs"][role="tablist"]').filter({ has: page.locator('[data-app-mode]') })
    await expect(tabs).toHaveCount(1)
    await tabs.locator('[data-app-mode="thread"]').click()
    const selected = tabs.locator('[data-app-mode="thread"]')
    await expect(selected).toHaveAttribute('aria-selected', 'true')
    const color = await selected.evaluate(async el => { await Promise.all(el.getAnimations().map(animation => animation.finished)); return getComputedStyle(el).color })
    expect(color).toBe(await tokenColor(page, '--tx-primary'))
    expect(color).not.toBe(await tabs.locator('[data-app-mode="data"]').evaluate(el => getComputedStyle(el).color))
  } finally {
    await app.close()
  }
})
