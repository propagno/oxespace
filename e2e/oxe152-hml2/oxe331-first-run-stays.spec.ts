// Frozen end-to-end acceptance test for 1.5.2 HML fixes, pass 2 (Jira OXE-331, P0; 152hml2). Written by the planner; the
// executor must not edit it. HML round 1 (07d8df07c): in the first run, Step 1's "Choose folder" opens the New workspace
// wizard (OXE-77/POLISH-03 keep it: the first run has no other New workspace button), and finishing it ends the first run
// and drops the person in OxeCode, skipping Step 2 (connect an agent) and Step 3 (first conversation) (src/App.tsx
// handleLaunch; FirstRun.tsx createWorkspace).
// 8e's decision (21/11): keep the wizard; a workspace made from the first run's Step 1 leaves the person in the first run,
// with Step 1 done (its folder shown) and Step 2 current. The first run ends as before when the person leaves it: the
// footer's OxeCode or OxeQuery, or the first conversation. The e2e helpers that make a workspace through the first run
// (e2e/helpers/launch.ts openDemoWorkspace, e2e/acceptance/real-app.ts openRepo) then continue to OxeCode the way a person
// does, by the footer's OxeCode.
import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('OXE-331: a workspace made from Step 1 keeps the first run open at Step 2; the footer OxeCode then opens it', async () => {
  test.setTimeout(120_000)
  const root = mkdtempSync(join(tmpdir(), 'oxe-first-run-331-'))
  const folder = mkdtempSync(join(tmpdir(), 'oxe-first-run-331-folder-'))
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e/electron-main.cjs')], env: {
    ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_DB_PATH: join(root, 'app.sqlite3')
  } })
  try {
    const page = await app.firstWindow()
    await app.evaluate(({ ipcMain }) => {
      for (const channel of ['agent:get-readiness', 'agent:discover']) ipcMain.removeHandler(channel)
      // No agent ready, so Step 2 stays the current step once Step 1 is done.
      const readiness = [{ provider: 'claude', command: 'claude', status: 'missing' }, { provider: 'codex', command: 'codex', status: 'missing' }]
      ipcMain.handle('agent:get-readiness', () => readiness)
      ipcMain.handle('agent:discover', () => readiness)
    })
    await page.reload()

    const guide = page.getByTestId('first-run')
    await expect(guide).toBeVisible()
    await guide.getByTestId('btn-new-workspace').click()
    await page.getByTestId('wizard-dir-input').fill(folder)
    await page.getByTestId('wizard-launch-btn').click()

    // The first run is still the screen, Step 1 done with its folder, Step 2 current; OxeCode's grid is not shown.
    await expect(guide).toBeVisible({ timeout: 15_000 })
    const steps = guide.locator('[data-ui="first-run-step"]')
    await expect(steps.nth(0)).toHaveAttribute('data-state', 'done')
    await expect(steps.nth(1)).toHaveAttribute('data-state', 'current')
    await expect(steps.nth(1)).toHaveAttribute('aria-current', 'step')
    await expect(steps.nth(0)).toContainText(folder.split(/[\\/]/).pop() as string)
    await expect(page.locator('[data-testid="workspace-grid"], [data-testid="workspace-split-grid"]')).toHaveCount(0)

    // Leaving by the footer's OxeCode ends the first run and shows the workspace that was made.
    await guide.getByRole('button', { name: /^OxeCode\b/ }).click()
    await expect(guide).toBeHidden()
    await expect(page.locator('[data-testid="workspace-grid"], [data-testid="workspace-split-grid"]').first()).toBeVisible({ timeout: 15_000 })
  } finally {
    await app.close()
  }
})
