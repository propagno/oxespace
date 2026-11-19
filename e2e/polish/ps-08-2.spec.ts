// End-to-end acceptance test for 1.5.2 Polimento · Configurações (Jira OXE-233, PS-08·2, CA-4),
// in the built app with real services (OXESPACE_E2E_MOCK_NATIVE=0) in pt-BR.
import { expect, test } from '@playwright/test'
import { launchApp, openDemoWorkspace } from '../helpers/launch'
import { openSettings } from '../helpers/settings'

const REAL = { OXESPACE_E2E_MOCK_NATIVE: '0' }

test('PS-08·2 in the app: MCP servers and skills in pt-BR cite the menu path and never say habilidades', async () => {
  test.setTimeout(180_000)
  const { app, page, workspaceRoot } = await launchApp({ appearance: 'light', locale: 'pt-BR', realClock: true, env: REAL })
  try {
    await openDemoWorkspace(page, workspaceRoot)
    await openSettings(page, 'Abrir configurações')
    const dialog = page.getByRole('dialog', { name: 'Configurações' })
    await expect(dialog).toBeVisible()
    const nav = dialog.getByRole('navigation', { name: 'Categorias das configurações' })
    await nav.getByRole('button', { name: /^Integrações\b/ }).first().click()
    const whereToAdd = dialog.getByTestId('tools-where-to-add')
    await expect(whereToAdd).toBeVisible()
    await expect(whereToAdd).toContainText('Ferramentas › Gerenciar servidores MCP')
    const text = (await dialog.innerText()).toLowerCase()
    expect(text).not.toContain('habilidades')
  } finally {
    await app.close()
  }
})
