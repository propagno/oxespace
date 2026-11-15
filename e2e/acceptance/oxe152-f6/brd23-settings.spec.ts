// Frozen end-to-end acceptance test for 1.5.2 OxeCode/Shell F6 (Jira OXE-100, BRD-23), in the built app
// (OXESPACE_E2E_MOCK_NATIVE=0). Written by the planner; the executor must not edit it. Red until T36 lands.
// Contract: Settings opens on the app scope with the 9 sections of the target in order in "Settings categories"; the
// [data-ui=settings-scope] selector switches to the workspace, whose sections are General, Projects and Policy.
import { expect, test } from '@playwright/test'
import { launchApp, layoutAtWidth, openDemoWorkspace } from '../../helpers/launch'
import { openSettings } from '../../helpers/settings'

const SECTIONS = ['General', 'Appearance', 'Agents & permissions', 'Notifications', 'Keyboard', 'Terminal', 'Integrations', 'Data & diagnostics', 'About']

test('BRD-23 in the app: nine sections and the App / workspace selector', async () => {
  test.setTimeout(180_000)
  const { app, page, workspaceRoot } = await launchApp({ appearance: 'light', env: { OXESPACE_E2E_MOCK_NATIVE: '0' } })
  try {
    await layoutAtWidth(app, page, 1440, 900)
    await openDemoWorkspace(page, workspaceRoot)
    await openSettings(page)
    const dialog = page.getByRole('dialog', { name: 'Settings', exact: true })
    await dialog.waitFor()
    const nav = dialog.getByRole('navigation', { name: 'Settings categories' })
    const names = async (): Promise<string[]> => (await nav.getByRole('button').all()).length ? Promise.all((await nav.getByRole('button').all()).map(async button => ((await button.getAttribute('aria-label')) ?? (await button.textContent()) ?? '').trim())) : []
    await expect.poll(async () => (await names()).length).toBe(9)
    ;(await names()).forEach((name, index) => expect(name.startsWith(SECTIONS[index]), `${index + 1}: ${name}`).toBe(true))
    const scope = dialog.locator('[data-ui="settings-scope"]')
    await expect(scope).toHaveCount(1)
    await scope.getByText('demo-repo').click()
    await expect.poll(async () => (await names()).length).toBe(3)
    ;(await names()).forEach((name, index) => expect(name.startsWith(['General', 'Projects', 'Policy'][index]), name).toBe(true))
  } finally {
    await app.close()
  }
})
