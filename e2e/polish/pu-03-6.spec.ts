// Frozen end-to-end acceptance test for 1.5.2 OxeCode/Shell F6 (Jira OXE-210, PU-03·6, CA-3), in the built app on a fresh
// profile with real services (OXESPACE_E2E_MOCK_NATIVE=0). Written by the planner; the executor must not edit it. Red until
// the card's task (after T31).
// Contract: the first run's headings, read from the accessibility tree (role heading and its level), start with one level
// 1 and skip no level; each of the three steps' titles is level 2.
import { expect, test } from '@playwright/test'
import { launchApp, resizeWindow } from '../helpers/launch'

test('PU-03·6 in the app: one h1, then h2 step titles, no skipped level', async () => {
  test.setTimeout(180_000)
  const { app, page } = await launchApp({ appearance: 'light', env: { OXESPACE_E2E_MOCK_NATIVE: '0' } })
  try {
    await resizeWindow(app, 1440, 900)
    const first = page.getByTestId('first-run')
    await expect(first).toBeVisible()
    const levels = await first.getByRole('heading').evaluateAll(els => els.map(el => Number(el.getAttribute('aria-level') ?? el.tagName.slice(1))))
    expect(levels[0]).toBe(1)
    expect(levels.filter(level => level === 1)).toHaveLength(1)
    for (let index = 1; index < levels.length; index++) expect(levels[index], `heading ${index + 1}`).toBeLessThanOrEqual(levels[index - 1] + 1)
    const steps = first.locator('[data-ui="first-run-step"]')
    await expect(steps).toHaveCount(3)
    for (const step of await steps.all()) await expect(step.getByRole('heading', { level: 2 })).toHaveCount(1)
  } finally {
    await app.close()
  }
})
