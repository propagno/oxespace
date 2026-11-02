import { expect, test, type Page } from '@playwright/test'
import { launchApp } from './helpers/launch'

/**
 * F17: every palette label reads "<Category>: <Action>" in English and in Portuguese, terminals and workspaces sit in
 * one short "Go to" group (the full path only in the tooltip), and a search for an old name still finds the command.
 */
const LANGUAGES = [
  { locale: 'en', placeholder: 'Search files and commands…', button: 'Files & commands', goTo: 'Go to',
    labels: ['Help: Show keyboard shortcuts', 'View: Toggle sidebar', 'Activity: Mark all as read', 'OxeQuery: Open', 'Layout: Use 2 panes', 'OxeChat: Start a new conversation'],
    oldName: ['Keyboard shortcuts', 'Help: Show keyboard shortcuts'] },
  { locale: 'pt-BR', placeholder: 'Buscar arquivos e comandos…', button: 'Arquivos e comandos', goTo: 'Ir para',
    labels: ['Ajuda: Mostrar os atalhos de teclado', 'Exibir: Mostrar ou ocultar a barra lateral', 'Atividade: Marcar tudo como lido', 'OxeQuery: Abrir', 'Layout: Usar 2 painéis', 'OxeChat: Iniciar uma nova conversa'],
    oldName: ['Atalhos de teclado', 'Ajuda: Mostrar os atalhos de teclado'] }
] as const

async function openPalette(page: Page, button: string, placeholder: string): Promise<void> {
  const input = page.getByPlaceholder(placeholder)
  for (let attempt = 0; attempt < 3 && !(await input.isVisible()); attempt++) {
    await page.getByRole('button', { name: button }).first().click()
    await input.waitFor({ timeout: 2_000 }).catch(() => undefined)
  }
  await expect(input).toBeVisible()
}

for (const language of LANGUAGES) {
  test(`palette labels in ${language.locale}`, async () => {
    test.setTimeout(90_000)
    const { app, page, workspaceRoot } = await launchApp({ locale: language.locale })
    try {
      await page.evaluate(root => window.oxe.workspace.create({ rootPath: root, layoutPreset: 2, autoStart: false }), workspaceRoot)
      await page.reload()
      await page.waitForLoadState('load')
      await expect(page.locator('[data-testid="pane-container"]').first()).toBeVisible()
      await openPalette(page, language.button, language.placeholder)
      const input = page.getByPlaceholder(language.placeholder)

      // Static and state-built commands, every one "<Category>: <Action>".
      await expect.poll(async () => (await page.locator('[cmdk-item][data-value^="cmd-oxequery."]').count())).toBeGreaterThan(0)
      const labels = await page.locator('[cmdk-item][data-value^="cmd-"] [class*="label"]').allTextContents()
      // Enabled commands only: the palette hides the ones that need a running terminal or a conversation.
      expect(labels.length).toBeGreaterThan(70)
      expect(labels.filter(label => !/^[^:]+: \S/.test(label))).toEqual([])
      for (const label of language.labels) expect(labels).toContain(label)

      // Go to: the workspace and its terminals in one group, with a short folder; the full path is the tooltip.
      const goTo = page.locator('[cmdk-group]', { has: page.locator('[cmdk-group-heading]', { hasText: language.goTo }) })
      await expect(goTo.getByRole('option', { name: new RegExp(`^${language.goTo}: demo-repo`) })).toBeVisible()
      await expect(goTo.locator('[cmdk-item][data-value^="pane-"]').first()).toContainText(`${language.goTo}: `)
      await expect(goTo).not.toContainText(workspaceRoot)
      await expect(goTo.locator('[cmdk-item][data-value^="ws-"]').first()).toHaveAttribute('title', workspaceRoot)
      // The full path is still searchable.
      const folder = workspaceRoot.split(/[\\/]/).filter(Boolean).at(-2)!
      await input.fill(folder)
      await expect(page.locator('[cmdk-item][data-value^="ws-"]').first()).toBeVisible()

      // An old name finds the renamed command first.
      await input.fill(language.oldName[0])
      await expect(page.locator('[cmdk-item][data-value^="cmd-"]').first()).toContainText(language.oldName[1])
      await page.screenshot({ path: `test-results/palette-labels-${language.locale}.png` })
    } finally {
      await Promise.race([app.close().catch(() => undefined), new Promise(resolve => setTimeout(resolve, 4000))])
    }
  })
}
