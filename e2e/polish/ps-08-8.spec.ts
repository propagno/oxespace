// End-to-end acceptance test for 1.5.2 Polimento · Configurações (Jira OXE-236, PS-08·8, CA-3),
// in the built app with real services (OXESPACE_E2E_MOCK_NATIVE=0).
import { expect, test } from '@playwright/test'
import { launchApp, openDemoWorkspace } from '../helpers/launch'
import { openSettings } from '../helpers/settings'

const REAL = { OXESPACE_E2E_MOCK_NATIVE: '0' }

test('PS-08·8 in the app: the test notification is asked and its button does not span the column', async () => {
  test.setTimeout(180_000)
  const { app, page, workspaceRoot } = await launchApp({ appearance: 'light', locale: 'pt-BR', realClock: true, env: REAL })
  try {
    await openDemoWorkspace(page, workspaceRoot)
    await app.evaluate(({ ipcMain }) => {
      const store = globalThis as unknown as { __ps08TestNotifs?: unknown[] }
      store.__ps08TestNotifs = []
      ipcMain.removeHandler('notifications:notify')
      ipcMain.handle('notifications:notify', (_event, payload) => {
        store.__ps08TestNotifs!.push(payload)
        return true
      })
    })

    await openSettings(page, 'Abrir configurações')
    const dialog = page.getByRole('dialog', { name: 'Configurações' })
    await expect(dialog).toBeVisible()
    const nav = dialog.getByRole('navigation', { name: 'Categorias das configurações' })
    await nav.getByRole('button', { name: /^Notificações\b/ }).first().click()

    const button = dialog.getByTestId('btn-test-notification')
    await expect(button).toBeVisible()
    await expect(button).toHaveAttribute('data-variant', 'secondary')
    await expect(button).toHaveAttribute('data-size', 'sm')

    const row = button.locator('xpath=ancestor::*[@data-ui="setting-row"][1]')
    await expect(row).toBeVisible()
    const [buttonBox, rowBox] = await Promise.all([button.boundingBox(), row.boundingBox()])
    expect(buttonBox).not.toBeNull()
    expect(rowBox).not.toBeNull()
    expect(buttonBox!.width).toBeLessThan(rowBox!.width * 0.6)

    await button.click()
    await expect.poll(async () =>
      app.evaluate(() => ((globalThis as unknown as { __ps08TestNotifs?: unknown[] }).__ps08TestNotifs ?? []).length)
    ).toBe(1)
  } finally {
    await app.close()
  }
})
