import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { launchApp, openDemoWorkspace } from './helpers/launch'

// The main Code flow on a Brazilian Portuguese system: workspace, panels, Git, search and MCP read in Portuguese.
test('Code speaks Brazilian Portuguese end to end', async () => {
  test.setTimeout(90_000)
  const { app, page, workspaceRoot, consoleErrors } = await launchApp({ locale: 'pt-BR' })
  try {
    execFileSync('git', ['init', '-q', '-b', 'main', workspaceRoot])
    await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR')
    await expect(page.getByText('Nenhum workspace ainda.')).toBeVisible()

    await page.getByTestId('btn-new-workspace').click()
    const wizard = page.getByRole('dialog', { name: 'Criar um workspace' })
    await expect(wizard).toBeVisible()
    await expect(wizard.getByRole('radiogroup', { name: 'Layout predefinido' }).getByRole('radio', { name: '4 painéis', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await openDemoWorkspace(page, workspaceRoot)

    await expect(page.getByRole('navigation', { name: 'Workspaces' })).toBeVisible()
    await expect(page.getByRole('searchbox', { name: 'Filtrar workspaces' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Arquivos e comandos' })).toHaveCount(1)
    await expect(page.locator('.app-statusbar')).toContainText('painéis')

    // Panels menu: every panel is named in Portuguese.
    await page.locator('[data-testid="btn-open-tools"]:visible').click()
    const menu = page.getByRole('menu')
    for (const name of ['Alterações', 'Navegador', 'Commit e pull request', 'Arquivos', 'Buscar nos arquivos', 'Scripts', 'Worktrees']) {
      await expect(menu.getByRole('menuitemcheckbox', { name, exact: true })).toBeVisible()
    }
    await menu.getByRole('menuitemcheckbox', { name: 'Alterações', exact: true }).click()
    const changes = page.getByTestId('changes-panel')
    await expect(changes.getByRole('button', { name: /^Escopo das alterações/ })).toBeVisible()
    await expect(changes.getByRole('complementary', { name: 'Arquivos alterados' })).toBeVisible()

    await page.locator('[data-testid="btn-open-tools"]:visible').click()
    await page.getByRole('menuitemcheckbox', { name: 'Commit e pull request', exact: true }).click()
    await expect(page.locator('.git-control').getByText('Árvore de trabalho limpa')).toBeVisible()
    await expect(page.locator('.git-control').getByText('Upstream não definido')).toBeVisible()

    await page.locator('[data-testid="btn-open-tools"]:visible').click()
    await page.getByRole('menuitemcheckbox', { name: 'Buscar nos arquivos', exact: true }).click()
    await expect(page.getByRole('searchbox', { name: 'Termo de busca' })).toHaveAttribute('placeholder', 'Buscar nos arquivos…')

    await page.getByRole('button', { name: 'Abrir os servidores MCP' }).click()
    const mcp = page.getByRole('dialog', { name: 'Servidores MCP' })
    await expect(mcp.getByRole('tab', { name: 'Catálogo' })).toBeVisible()
    await expect(mcp.getByText('Populares')).toBeVisible()
    await expect(mcp.getByRole('button', { name: 'Adicionar servidor MCP' })).toBeVisible()
    await mcp.getByRole('button', { name: 'Fechar', exact: true }).click()

    await page.getByRole('button', { name: 'Mostrar ou ocultar a atividade em segundo plano' }).click()
    const background = page.getByTestId('workspace-background-panel')
    await expect(background.getByRole('button', { name: 'Tarefas locais' })).toBeVisible()
    await expect(background.getByText('Nenhuma tarefa', { exact: true })).toBeVisible()

    expect(consoleErrors.filter(line => line.includes('pageerror'))).toEqual([])
  } finally {
    await app.close()
  }
})
