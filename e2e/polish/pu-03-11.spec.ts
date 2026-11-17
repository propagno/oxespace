// Frozen end-to-end acceptance test for 1.5.2 OxeCode/Shell F6 (Jira OXE-213, PU-03·11 as narrowed by the coordination on
// 15/11: the version in About, never in the status bar), in the built app with real services (OXESPACE_E2E_MOCK_NATIVE=0;
// the updater is main's, which reports a development build here). Written by the planner; the executor must not edit it.
// Red until the card's interface task (after its backend task and T36).
// Contract: Settings › About shows `v<package.json version>`; the status bar ([data-ui=status-bar] after T28, else the
// app-statusbar footer) shows no version.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchApp, layoutAtWidth, openDemoWorkspace } from '../helpers/launch'
import { openSettings } from '../helpers/settings'

const VERSION = (JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { version: string }).version

test('PU-03·11 in the app: About shows the installed version, the status bar none', async () => {
  test.setTimeout(180_000)
  const { app, page, workspaceRoot } = await launchApp({ appearance: 'light', env: { OXESPACE_E2E_MOCK_NATIVE: '0' } })
  try {
    await layoutAtWidth(app, page, 1440, 900)
    await openDemoWorkspace(page, workspaceRoot)
    const status = page.locator('[data-ui="status-bar"], footer.app-statusbar').first()
    await expect(status).toBeVisible()
    await expect(status).not.toContainText(VERSION)
    await expect(status).not.toContainText(/OXESpace\s+\d/)
    await openSettings(page)
    const dialog = page.getByRole('dialog', { name: 'Settings', exact: true })
    await dialog.waitFor()
    await dialog.getByRole('navigation', { name: 'Settings categories' }).getByRole('button', { name: /^About/ }).click()
    await expect(dialog.getByText(`v${VERSION}`, { exact: true }).first()).toBeVisible()
  } finally {
    await app.close()
  }
})
