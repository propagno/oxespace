// Acceptance test for 1.5.2 Polimento · OxeCode superfície (Jira OXE-253, PC-04·6, CA-4), in the built app with real
// services (OXESPACE_E2E_MOCK_NATIVE=0) in pt-BR.
// Contract: opening the slash command overlay in the OxeCode terminal shows the /new hint as "Começar do zero"
// (never "Reiniciar do zero").
import { expect, test } from '@playwright/test'
import { launchApp, layoutAtWidth, openDemoWorkspace } from '../helpers/launch'

test('PC-04·6 in the app: in pt-BR the /new hint of the OxeCode terminal says Começar do zero', async () => {
  test.setTimeout(180_000)
  const { app, page, workspaceRoot } = await launchApp({
    appearance: 'light',
    locale: 'pt-BR',
    env: { OXESPACE_E2E_MOCK_NATIVE: '0' }
  })
  try {
    await layoutAtWidth(app, page, 1440, 900)
    await openDemoWorkspace(page, workspaceRoot)
    const terminal = page.locator('[data-testid="pane-container"] .xterm').first()
    await expect(terminal).toBeVisible({ timeout: 20_000 })
    await terminal.click()
    await page.keyboard.press('Control+Slash')
    const newOption = page.getByRole('option', { name: /\/new/i })
    await expect(newOption).toBeVisible()
    await expect(newOption).toContainText('Começar do zero')
    await expect(newOption).not.toContainText(/reiniciar do zero/i)
  } finally {
    await app.close()
  }
})
