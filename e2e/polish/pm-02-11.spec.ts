// Frozen end-to-end acceptance test for 1.5.2 OxeCode/Shell F6 (Jira OXE-248, PM-02·11 (a) as narrowed by the coordination
// on 15/11), in the built app with real services (OXESPACE_E2E_MOCK_NATIVE=0, real terminals). The one fixture is the
// provider's usage reading: main's agent-credits:get handler is replaced with an available snapshot, as launchApp pins the
// RTK check, since the usage endpoint needs a signed-in account. Written by the planner; the executor must not edit it.
// Red until the card's task (after T28).
// Contract: the status bar's usage reading ([data-testid=usage-status]) is at least 24px tall (--target-min).
import { expect, test } from '@playwright/test'
import { launchApp, layoutAtWidth, openDemoWorkspace } from '../helpers/launch'

test('PM-02·11 in the app: the status bar\'s usage target is 24px', async () => {
  test.setTimeout(180_000)
  const { app, page, workspaceRoot } = await launchApp({ appearance: 'light', env: { OXESPACE_E2E_MOCK_NATIVE: '0' } })
  try {
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('agent-credits:get')
      ipcMain.handle('agent-credits:get', (_event, input: { provider?: string } | string) => {
        const provider = typeof input === 'string' ? input : input?.provider ?? 'claude'
        const weekly = { kind: 'weekly', usedPct: 30, resetsAtMs: Date.now() + 86_400_000 }
        return { provider, available: true, installed: true, planLabel: null, display: weekly, windows: [{ kind: 'session', usedPct: 40, resetsAtMs: Date.now() + 3_600_000 }, weekly], error: null, source: 'oauth', observedAtMs: Date.now() }
      })
    })
    await layoutAtWidth(app, page, 1440, 900)
    await openDemoWorkspace(page, workspaceRoot)
    const usage = page.getByTestId('usage-status').first()
    await expect(usage).toBeVisible({ timeout: 30_000 })
    const box = await usage.boundingBox()
    // Layout rounding under fractional scaling (Windows, 1/64 px); the target is var(--target-min). Off Windows the exact measure stays.
    if (process.platform === 'win32') expect(box?.height ?? 0).toBeGreaterThanOrEqual(24 - 0.05)
    else expect(box?.height ?? 0).toBeGreaterThanOrEqual(24)
  } finally {
    await app.close()
  }
})
