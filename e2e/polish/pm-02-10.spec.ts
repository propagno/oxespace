// Frozen end-to-end acceptance test for 1.5.2 OxeCode/Shell F6 (Jira OXE-247, PM-02·10, CA-3), in the built app in pt-BR
// with real services (OXESPACE_E2E_MOCK_NATIVE=0). Written by the planner; the executor must not edit it. Red until the
// card's task.
// Contract: with a toast on screen (Ctrl+Shift+U with nothing waiting raises one), the accessibility tree has the region
// "Avisos" and, in it, the button "Dispensar aviso"; nothing is named "Notificações".
import { expect, test } from '@playwright/test'
import { launchApp, layoutAtWidth } from '../helpers/launch'

test('PM-02·10 in the app: the toasts are "Avisos", dismissed with "Dispensar aviso"', async () => {
  test.setTimeout(180_000)
  const { app, page } = await launchApp({ appearance: 'light', locale: 'pt-BR', env: { OXESPACE_E2E_MOCK_NATIVE: '0' } })
  try {
    await layoutAtWidth(app, page, 1440, 900)
    await page.keyboard.press('Control+Shift+U')
    const region = page.getByRole('region', { name: 'Avisos', exact: true })
    await expect(region).toHaveCount(1)
    await expect(region.getByRole('button', { name: 'Dispensar aviso', exact: true }).first()).toBeVisible()
    await expect(page.getByRole('region', { name: 'Notificações', exact: true })).toHaveCount(0)
  } finally {
    await app.close()
  }
})
