// Frozen end-to-end acceptance test for 1.5.2 OxeCode/Shell F6 (Jira OXE-79, BRD-13), in the built app with real
// terminals and git (OXESPACE_E2E_MOCK_NATIVE=0). Written by the planner; the executor must not edit it. Red until T32.
// Contract: OxeCode's [data-ui=workspace-header] names the workspace (demo-repo), shows no pane count ("N panes") and no
// "OxeCode ·"; its [data-ui=panel-group] holds only buttons with a name and a tooltip; the branch shows only when git
// knows it (never "Branch unavailable").
import { expect, test } from '@playwright/test'
import { launchApp, layoutAtWidth, openDemoWorkspace } from '../../helpers/launch'

test('BRD-13 in the app: the workspace header is the workspace, the panel group is labelled', async () => {
  test.setTimeout(180_000)
  const { app, page, workspaceRoot } = await launchApp({ appearance: 'light', env: { OXESPACE_E2E_MOCK_NATIVE: '0' } })
  try {
    await layoutAtWidth(app, page, 1440, 900)
    await openDemoWorkspace(page, workspaceRoot)
    const header = page.locator('[data-ui="workspace-header"]')
    await expect(header).toHaveCount(1)
    // liberação de teste congelado: coordenação 20/11 (OXE-279 / POLISH-09 #2(b)), 'demo-repo' no workspace-header é verificado com a lateral recolhida; nenhuma outra asserção do BRD-13 muda
    await page.getByRole('button', { name: /Collapse the sidebar/i }).click()
    await expect(header).toContainText('demo-repo')
    await expect(header).not.toContainText(/\d+\s+(panes?|painéis|painel)/i)
    await expect(header).not.toContainText(/OxeCode\s*·/)
    await expect(header).not.toContainText(/branch unavailable/i)
    const buttons = header.locator('[data-ui="panel-group"] button')
    await expect.poll(() => buttons.count()).toBeGreaterThan(1)
    for (const button of await buttons.all()) {
      expect(await button.getAttribute('aria-label'), 'a name').toBeTruthy()
      expect(await button.getAttribute('title'), 'a tooltip').toBeTruthy()
    }
  } finally {
    await app.close()
  }
})
