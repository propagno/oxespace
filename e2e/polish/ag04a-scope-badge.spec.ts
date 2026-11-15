// Frozen end-to-end acceptance test for 1.5.2 OxeCode/Shell F6 (Jira OXE-182, AG-04a, CA-3), in the built app with real
// services (OXESPACE_E2E_MOCK_NATIVE=0, real git). Written by the planner; the executor must not edit it. Red until T38.
// Contract: in a workspace whose folder has no .git (launchApp's demo-repo), the Changes panel's scope badge
// ([data-testid=panel-scope-badge]) shows the folder name, never "Branch unavailable".
import { expect, test } from '@playwright/test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, openDemoWorkspace, resizeWindow } from '../helpers/launch'

test('AG-04a in the app: a folder without git is named by its folder in the scope badge', async () => {
  test.setTimeout(180_000)
  const { app, page, workspaceRoot } = await launchApp({ appearance: 'light', env: { OXESPACE_E2E_MOCK_NATIVE: '0' } })
  try {
    expect(existsSync(join(workspaceRoot, '.git')), 'the demo folder has no git').toBe(false)
    await resizeWindow(app, 1440, 900)
    await openDemoWorkspace(page, workspaceRoot)
    await page.getByTestId('btn-open-tools').click()
    await page.getByRole('menu', { name: 'Panels' }).getByRole('menuitemcheckbox', { name: /^Changes$/ }).click()
    const badge = page.getByTestId('panel-scope-badge').first()
    await expect(badge).toBeVisible()
    await expect(badge).toContainText('demo-repo')
    await expect(badge).not.toContainText(/branch unavailable/i)
  } finally {
    await app.close()
  }
})
