// Frozen end-to-end acceptance test for 1.5.2 OxeCode/Shell F6 (Jira OXE-206, PU-03·1, CA-3), in the built app on a fresh
// profile with real services (OXESPACE_E2E_MOCK_NATIVE=0; the agents' states are what the machine has). Written by the
// planner; the executor must not edit it. Red until the card's task (after T31).
// Contract: with forced colours emulated and no workspace, the first run's step 1 is aria-current="step" with a 2px
// outline, and every agent row's state is a [data-ui=status-signal] with an accessible name.
import { expect, test } from '@playwright/test'
import { launchApp, layoutAtWidth } from '../helpers/launch'

test('PU-03·1 in the app: forced colours show the current step and each agent\'s state', async () => {
  test.setTimeout(180_000)
  const { app, page } = await launchApp({ appearance: 'light', env: { OXESPACE_E2E_MOCK_NATIVE: '0' } })
  try {
    await layoutAtWidth(app, page, 1440, 900)
    await page.emulateMedia({ forcedColors: 'active' })
    const first = page.getByTestId('first-run')
    await expect(first).toBeVisible()
    const steps = first.locator('[data-ui="first-run-step"]')
    await expect(steps).toHaveCount(3)
    await expect(steps.nth(0)).toHaveAttribute('aria-current', 'step')
    await expect(first.locator('[aria-current="step"]')).toHaveCount(1)
    // A visible outline in every harness: the harness zoom snaps it to device pixels (1.125px on Linux, 1.40625px on
    // Windows). The 2px itself is proved by pu03-first-run-forced › has a forced-colors rule for the current step.
    const outline = await steps.nth(0).evaluate(el => ({ width: getComputedStyle(el).outlineWidth, style: getComputedStyle(el).outlineStyle }))
    expect(outline.style).not.toBe('none')
    expect(parseFloat(outline.width)).toBeGreaterThanOrEqual(1)
    const signals = steps.nth(1).locator('[data-ui="status-signal"]')
    await expect(signals).not.toHaveCount(0)
    for (const signal of await signals.all()) expect(((await signal.getAttribute('aria-label')) ?? '').trim().length).toBeGreaterThan(0)
  } finally {
    await app.close()
  }
})
