// Frozen end-to-end acceptance test for 1.5.2 Polimento 2 (Jira OXE-268, PP-05·13, CA-3; A12), in the built app with real
// services (OXESPACE_E2E_MOCK_NATIVE=0). Written by the planner; the executor must not edit it. In pt-BR, in OxeChat with
// a project, the person looks for the accounts in the command palette: the command reads "Contas dos agentes" and opens
// the dialog titled "Contas dos agentes" (one dialog, one name). Red on main f65fa5374: the command says
// "Contas dos provedores" (common:commands.thread.accounts).
import { execFileSync } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { launchApp, layoutAtWidth, openDemoWorkspace } from '../helpers/launch'

const read = (rel: string): Record<string, unknown> => JSON.parse(readFileSync(join(process.cwd(), rel), 'utf8'))
function pt(ns: string, key: string): string {
  let node: unknown = read(`shared/locales/pt-BR/${ns}.json`)
  for (const part of key.split('.')) node = (node as Record<string, unknown> | undefined)?.[part]
  if (typeof node !== 'string') throw new Error(`the pt-BR ${ns} catalog has no key ${key}`)
  return node
}
function gitRepo(root: string): string {
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root })
  execFileSync('git', ['-c', 'user.email=e2e@example.invalid', '-c', 'user.name=e2e', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: root })
  return realpathSync.native(root)
}
/** The palette by its global shortcut, as e2e/command-palette.spec.ts opens it: OxeChat has no palette button (CR-32). */
async function openPalette(page: Page): Promise<void> {
  const input = page.getByPlaceholder('Buscar arquivos e comandos…')
  for (let attempt = 0; attempt < 3 && !(await input.isVisible()); attempt++) {
    await page.locator('body').press('Control+Shift+P')
    await input.waitFor({ timeout: 2_000 }).catch(() => undefined)
  }
  await expect(input).toBeVisible()
}

test('PP-05·13 in the app: in pt-BR menu entry "Contas dos agentes" opens the dialog titled "Contas dos agentes"', async () => {
  test.setTimeout(180_000)
  const { app, page, workspaceRoot } = await launchApp({ locale: 'pt-BR', realClock: true, env: { OXESPACE_E2E_MOCK_NATIVE: '0' } })
  try {
    await layoutAtWidth(app, page, 1440, 900)
    const root = gitRepo(workspaceRoot)
    await openDemoWorkspace(page, root)
    await page.evaluate(path => window.oxe.thread!.addProject(path), root)
    await page.locator('button[data-app-mode="thread"]').first().click()
    await expect(page.locator('.thread-project-name').first()).toBeVisible({ timeout: 30_000 })

    await openPalette(page)
    await page.getByPlaceholder('Buscar arquivos e comandos…').fill('Contas dos agentes')
    const command = page.locator('[cmdk-item][data-value^="cmd-thread.accounts"]')
    await expect(command, 'the accounts command is listed').toBeVisible({ timeout: 10_000 })
    // The command starts with a verb (docs/design/commands.md; CR-34) and names the dialog inside it, in any case.
    await expect(command).toContainText('Contas dos agentes', { ignoreCase: true })
    await expect(command).not.toContainText('Contas dos provedores', { ignoreCase: true })
    await command.click()
    const dialog = page.getByRole('dialog', { name: pt('thread', 'accounts.title'), exact: true })
    await expect(dialog).toBeVisible()
    expect(pt('thread', 'accounts.title')).toBe('Contas dos agentes')
    await page.screenshot({ path: test.info().outputPath('pp-05-13.png') })
  } finally {
    await app.close()
  }
})
