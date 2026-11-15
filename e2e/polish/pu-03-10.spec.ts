// Frozen end-to-end acceptance test for 1.5.2 OxeCode/Shell F6 (Jira OXE-212, PU-03·10 as narrowed by the coordination on
// 15/11: the activity center and the shortcut, no pill), in the built app in pt-BR with real services
// (OXESPACE_E2E_MOCK_NATIVE=0). Written by the planner; the executor must not edit it. Red until the card's task.
// Contract: with nothing waiting, the bell's activity center says "Nada esperando por você" and Ctrl+Shift+U says the same
// in a toast (the pill at zero is BRD-09's, brd09-shell.spec.ts).
import { expect, test } from '@playwright/test'
import { launchApp, resizeWindow } from '../helpers/launch'

test('PU-03·10 in the app: one wording for nothing waiting, in the activity center and the shortcut', async () => {
  test.setTimeout(180_000)
  const { app, page } = await launchApp({ appearance: 'light', locale: 'pt-BR', env: { OXESPACE_E2E_MOCK_NATIVE: '0' } })
  try {
    await resizeWindow(app, 1440, 900)
    await page.getByTestId('activity-bell').click()
    await expect(page.getByText('Nada esperando por você', { exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByText('Nada esperando por você', { exact: true })).toHaveCount(0)
    await page.keyboard.press('Control+Shift+U')
    await expect(page.getByText('Nada esperando por você', { exact: true })).toBeVisible()
  } finally {
    await app.close()
  }
})
