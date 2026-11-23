// Frozen end-to-end acceptance test for 1.5.2 Polimento 2 (Jira OXE-186, CA-4; A4), in the built app with real services
// (OXESPACE_E2E_MOCK_NATIVE=0, real git). Written by the planner; the executor must not edit it. In pt-BR the person
// creates a worktree in OxeCode's Worktrees panel: the panel and the creation notice the main process sends
// (shared/locales/pt-BR/main.json, messages.worktree.created) say "a worktree", never "o/um/do/no worktree" nor
// "Worktree criado". Red on main f65fa5374 ("Worktree criado em …"). The new-conversation screen of OxeChat is being
// replaced by OXE-168 (OxeChat F5), so this test reads the OxeCode panel only; the catalog test covers every string.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { launchApp, layoutAtWidth, openDemoWorkspace } from '../helpers/launch'

const read = (rel: string): Record<string, unknown> => JSON.parse(readFileSync(join(process.cwd(), rel), 'utf8'))
/** The pt-BR catalog text of `ns:key`, so the test finds what a person reads. */
function pt(ns: string, key: string): string {
  let node: unknown = read(`shared/locales/pt-BR/${ns}.json`)
  for (const part of key.split('.')) node = (node as Record<string, unknown> | undefined)?.[part]
  if (typeof node !== 'string') throw new Error(`the pt-BR ${ns} catalog has no key ${key}`)
  return node
}
const MASCULINE = /(?<![\p{L}.])(?:o|um|do|no|este|outro|nenhum)\s+worktree(?![\p{L}.])|worktree\s+(?:criado|removido|novo)(?![\p{L}])/iu

function gitRepo(root: string): void {
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root })
  execFileSync('git', ['-c', 'user.email=e2e@example.invalid', '-c', 'user.name=e2e', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: root })
}

async function openWorktreesPanel(page: Page): Promise<void> {
  const item = page.getByRole('menuitemcheckbox', { name: pt('code', 'panels.worktrees'), exact: true })
  const trigger = page.locator('[data-testid="btn-open-tools"]:visible').first()
  for (let attempt = 0; attempt < 3; attempt++) {
    await trigger.click()
    if (await item.waitFor({ state: 'visible', timeout: 3_000 }).then(() => true, () => false)) break
  }
  await item.click()
}

test('OXE-186 in the app: pt-BR Worktrees panel and worktree switch show feminine phrasing', async () => {
  test.setTimeout(180_000)
  const { app, page, workspaceRoot } = await launchApp({ locale: 'pt-BR', realClock: true, env: { OXESPACE_E2E_MOCK_NATIVE: '0' } })
  try {
    await layoutAtWidth(app, page, 1440, 900)
    gitRepo(workspaceRoot)
    await openDemoWorkspace(page, workspaceRoot)
    await page.getByTestId('terminal-pane').first().click()
    await openWorktreesPanel(page)
    const panel = page.getByTestId('workspace-worktree-panel')
    await expect(panel).toBeVisible({ timeout: 15_000 })

    await panel.getByRole('button', { name: pt('code', 'worktree.create.open') }).click()
    await panel.getByLabel(pt('code', 'worktree.create.branch')).fill('feat/e2e-genero')
    await panel.getByRole('button', { name: pt('code', 'worktree.create.submit'), exact: true }).click()
    // The main process's creation notice, in the panel.
    await expect(panel, 'the creation notice').toContainText(/Worktree cria/, { timeout: 60_000 })
    const text = await panel.innerText()
    await page.screenshot({ path: test.info().outputPath('worktree-gender.png') })
    expect(text, 'the panel says "a worktree"').not.toMatch(MASCULINE)
    expect(text).toMatch(/Worktree criada/)
  } finally {
    await app.close()
  }
})
