// End-to-end acceptance test for 1.5.2 Polimento · Configurações (Jira OXE-232, PS-08·1, CA-3),
// in the built app with real services (OXESPACE_E2E_MOCK_NATIVE=0) in pt-BR.
import { expect, test } from '@playwright/test'
import { launchApp, openDemoWorkspace } from '../helpers/launch'
import { openSettings } from '../helpers/settings'

const REAL = { OXESPACE_E2E_MOCK_NATIVE: '0' }

test('PS-08·1 in the app: Settings › Appearance in pt-BR has exactly one Fechar button', async () => {
  test.setTimeout(180_000)
  const { app, page, workspaceRoot } = await launchApp({ appearance: 'light', locale: 'pt-BR', realClock: true, env: REAL })
  try {
    await openDemoWorkspace(page, workspaceRoot)
    await openSettings(page, 'Abrir configurações')
    const dialog = page.getByRole('dialog', { name: 'Configurações' })
    await expect(dialog).toBeVisible()
    const nav = dialog.getByRole('navigation', { name: 'Categorias das configurações' })
    await nav.getByRole('button', { name: /^Aparência\b/ }).first().click()
    await expect(dialog.getByRole('heading', { name: 'Aparência' })).toBeVisible()
    const closeButtons = dialog.getByRole('button', { name: /fechar/i })
    await expect(closeButtons).toHaveCount(1)
    await expect(closeButtons.first()).toBeVisible()
  } finally {
    await app.close()
  }
})
