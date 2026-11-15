// Frozen end-to-end acceptance test for 1.5.2 OxeCode/Shell F6 (Jira OXE-77, BRD-12), in the built app on a fresh profile
// with real services (OXESPACE_E2E_MOCK_NATIVE=0; the agents' states are what the machine has). Written by the planner;
// the executor must not edit it. Red until T31 lands.
// Contract: the first run shows the Ramo mark ([data-ui=brand-mark]), the display title ([data-ui=first-run-title]) and
// exactly three [data-ui=first-run-step] with a data-state; no "Clone"/"Clonar"; no disabled button in a step that is
// "next"; and OxeCode's empty state never shows the first-run checklist ([data-testid=first-run-checklist]).
import { expect, test } from '@playwright/test'
import { launchApp, layoutAtWidth } from '../../helpers/launch'

test('BRD-12 in the app: one start in three steps, with the mark and the display title', async () => {
  test.setTimeout(180_000)
  const { app, page } = await launchApp({ appearance: 'light', env: { OXESPACE_E2E_MOCK_NATIVE: '0' } })
  try {
    await layoutAtWidth(app, page, 1440, 900)
    const first = page.getByTestId('first-run')
    await expect(first).toBeVisible()
    await expect(first.locator('svg[data-ui="brand-mark"]')).not.toHaveCount(0)
    await expect(first.locator('[data-ui="first-run-title"]')).toHaveCount(1)
    const steps = first.locator('[data-ui="first-run-step"]')
    await expect(steps).toHaveCount(3)
    for (const step of await steps.all()) expect(['done', 'current', 'next']).toContain(await step.getAttribute('data-state'))
    await expect(first).not.toContainText(/Clon(e|ar)/)
    await expect(first.locator('[data-ui="first-run-step"][data-state="next"] button:disabled')).toHaveCount(0)
    await expect(page.getByTestId('first-run-checklist')).toHaveCount(0)
  } finally {
    await app.close()
  }
})
