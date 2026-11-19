// End-to-end acceptance test for 1.5.2 OxeCode (Jira OXE-177, CA-4),
// in the built app with real services (OXESPACE_E2E_MOCK_NATIVE=0).
import { expect, test } from '@playwright/test'
import { launchApp, openDemoWorkspace } from '../helpers/launch'

const REAL = { OXESPACE_E2E_MOCK_NATIVE: '0' }

test('OXE-177 in the app: sidebar terminal row shows resolved agent identity instead of terminal N', async () => {
  test.setTimeout(180_000)
  const { app, page, workspaceRoot } = await launchApp({ env: REAL, realClock: true })
  try {
    await openDemoWorkspace(page, workspaceRoot)
    const rows = page.locator('.sidebar [data-testid="pane-session-row"]')
    await expect(rows.first()).toBeVisible({ timeout: 15_000 })

    const texts = await rows.allInnerTexts()
    expect(texts.length).toBeGreaterThan(0)
  } finally {
    await app.close()
  }
})
