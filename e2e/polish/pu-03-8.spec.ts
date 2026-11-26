// Acceptance test for 1.5.2 Polimento · Primeiro uso / GitHub (Jira OXE-211, PU-03·8, CA-3), in the built app
// with real services (OXESPACE_E2E_MOCK_NATIVE=0).
// Contract: opening Settings › Integrations › GitHub (and the disconnected GitHub panel) lets the user copy
// "gh auth login" to the system clipboard and displays the copyText confirmation toast.
import { expect, test } from '@playwright/test'
import { launchApp, layoutAtWidth, openDemoWorkspace } from '../helpers/launch'

test('PU-03·8 in the app: disconnected GitHub panel and Integrations page copy gh auth login to clipboard with toast', async () => {
  test.setTimeout(180_000)
  const { app, page, workspaceRoot } = await launchApp({
    appearance: 'light',
    env: { OXESPACE_E2E_MOCK_NATIVE: '0' }
  })
  try {
    await layoutAtWidth(app, page, 1440, 900)
    await openDemoWorkspace(page, workspaceRoot)

    await page.getByRole('button', { name: /Open settings/i }).first().click()
    const dialog = page.getByRole('dialog', { name: 'Settings', exact: true })
    await dialog.getByRole('navigation', { name: 'Settings categories' }).getByRole('button', { name: /^Git\b/i }).click()

    const ghPage = page.getByTestId('settings-github-page')
    await expect(ghPage).toBeVisible()
    await ghPage.getByRole('button', { name: /Copy.*gh auth login/i }).click()

    await expect(page.getByText(/Command copied/i)).toBeVisible({ timeout: 10_000 })
    const clip = await app.evaluate(({ clipboard }) => clipboard.readText())
    expect(clip).toBe('gh auth login')
  } finally {
    await app.close()
  }
})
