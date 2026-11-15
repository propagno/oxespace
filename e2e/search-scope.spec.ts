import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { togglePanel } from './helpers/panels'

/**
 * OXE-191: Find in files follows the panels' scope. With the active pane in a git worktree, Files, Git and Changes
 * read the worktree, while Search kept searching the main checkout. A real repository, a real worktree and the
 * app's real search (ripgrep in the main process); only the terminals are mocked, none is used here.
 */
test('Find in files searches the active pane\'s worktree, and the workspace root once pinned', async () => {
  test.setTimeout(90_000)
  const root = mkdtempSync(join(tmpdir(), 'oxe-search-scope-'))
  const repo = join(root, 'repo')
  const tree = join(root, 'repo-hotfix')
  mkdirSync(repo, { recursive: true })
  const git = (...args: string[]): void => { execFileSync('git', args, { cwd: repo }) }
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'e2e@example.com'); git('config', 'user.name', 'E2E')
  writeFileSync(join(repo, 'main-only.ts'), 'export const marker = "needle-in-main"\n')
  git('add', '.'); git('commit', '-qm', 'base')
  git('worktree', 'add', '-q', '-b', 'hotfix', tree)
  writeFileSync(join(tree, 'hotfix-only.ts'), 'export const marker = "needle-in-hotfix"\n')

  const app = await electron.launch({ args: [join(process.cwd(), 'e2e/electron-main.cjs')], env: {
    ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_DB_PATH: join(root, 'db.sqlite3')
  } })
  try {
    const page = await app.firstWindow()
    await page.setViewportSize({ width: 1500, height: 900 })
    await page.getByTestId('btn-new-workspace').click()
    await page.getByTestId('wizard-dir-input').fill(repo)
    await page.getByTestId('wizard-layout-card-1').click()
    await page.getByTestId('wizard-launch-btn').click()
    const pane = page.getByTestId('terminal-pane')
    await expect(pane).toHaveCount(1)
    const paneId = await pane.first().getAttribute('data-pane-id')
    expect(paneId).toBeTruthy()

    // The pane moves into the hotfix worktree, as the Worktrees panel does.
    await page.evaluate(({ paneId, rootPath }) => window.oxe.workspace.setPaneRootPath({ paneId, rootPath }), { paneId: paneId ?? '', rootPath: tree })
    await pane.first().click()

    await togglePanel(page, 'Find in files')
    const panel = page.getByTestId('workspace-search-panel')
    await expect(panel).toBeVisible()
    // The header names what it searches: the worktree.
    await expect(panel.getByTestId('panel-scope-badge')).toHaveClass(/is-worktree/)

    await panel.getByLabel('Search query').fill('needle-in')
    await expect(panel.getByText('hotfix-only.ts')).toBeVisible({ timeout: 15_000 })
    await expect(panel.getByText('main-only.ts')).toHaveCount(0)

    // Pinned to the workspace root, the same search reads the main checkout.
    await panel.getByTestId('panel-scope-badge').click()
    await expect(panel.getByTestId('panel-scope-badge')).toHaveClass(/is-pinned/)
    await panel.getByLabel('Search query').fill('needle-in-')
    await expect(panel.getByText('main-only.ts')).toBeVisible({ timeout: 15_000 })
    await expect(panel.getByText('hotfix-only.ts')).toHaveCount(0)
  } finally {
    await Promise.race([app.close().catch(() => undefined), new Promise(resolve => setTimeout(resolve, 4000))])
    rmSync(root, { recursive: true, force: true, maxRetries: 3 })
  }
})
