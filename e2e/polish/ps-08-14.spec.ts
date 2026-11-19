// End-to-end acceptance test for 1.5.2 Polimento · Configurações (Jira OXE-241, PS-08·14, CA-4),
// in the built app with real services (OXESPACE_E2E_MOCK_NATIVE=0).
import { expect, test } from '@playwright/test'
import { launchApp, openDemoWorkspace } from '../helpers/launch'
import { openSettings } from '../helpers/settings'

const REAL = { OXESPACE_E2E_MOCK_NATIVE: '0' }

test('PS-08·14 in the app: Manage MCP servers… opens the MCP catalog', async () => {
  const { electronApp, page } = await launchApp({ env: REAL })
  try {
    await openDemoWorkspace(page)
    await openSettings(page)

    const nav = page.getByRole('navigation')
    await nav.getByRole('button', { name: /MCP|Tools|Ferramentas/i }).first().click()

    const tools = page.getByTestId('tools-settings')
    await expect(tools).toBeVisible({ timeout: 10_000 })
    await expect(tools.locator('h4')).toHaveCount(0)

    const manageBtn = tools.getByRole('button', { name: /Manage MCP servers|Gerenciar servidores MCP/i })
    await expect(manageBtn).toBeVisible()
    await manageBtn.click()

    await expect(page.locator('.mcp-panel')).toBeVisible({ timeout: 10_000 })
  } finally {
    await electronApp.close()
  }
})
