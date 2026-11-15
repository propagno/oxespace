import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { togglePanel } from './helpers/panels'

/**
 * OXE-273: after a pane moves into a worktree through the Worktrees panel, that row reads as current (aria-current,
 * disabled) and the main row does not. A real repository and worktree, real terminals.
 */
test('the Worktrees panel marks the worktree the active pane moved into', async () => {
  test.setTimeout(90_000)
  const root = mkdtempSync(join(tmpdir(), 'oxe-wt-current-'))
  const repo = join(root, 'repo')
  const tree = join(root, 'repo-hotfix')
  mkdirSync(repo, { recursive: true })
  const git = (...args: string[]): void => { execFileSync('git', args, { cwd: repo }) }
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'e2e@example.com'); git('config', 'user.name', 'E2E')
  writeFileSync(join(repo, 'README.md'), '# repo\n')
  git('add', '.'); git('commit', '-qm', 'base')
  git('worktree', 'add', '-q', '-b', 'hotfix', tree)

  const app = await electron.launch({ args: [join(process.cwd(), 'e2e/electron-main.cjs')], env: {
    ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '0', OXESPACE_DB_PATH: join(root, 'db.sqlite3')
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
    await pane.first().click()

    await togglePanel(page, 'Worktrees')
    const panel = page.getByTestId('workspace-worktree-panel')
    const rowOf = (branch: string) => panel.locator('.worktree-menu-item-select').filter({ has: page.getByText(branch, { exact: true }) })
    await expect(rowOf('main')).toHaveAttribute('aria-current', 'true', { timeout: 15_000 })
    await expect(rowOf('hotfix')).toBeEnabled()

    await rowOf('hotfix').click()
    try {
      await expect(rowOf('hotfix')).toHaveAttribute('aria-current', 'true', { timeout: 15_000 })
    } catch (error) {
      // What the app holds when it does not mark the row: the pane's saved root and the panel's own text.
      const panes = await page.evaluate(() => window.oxe.workspace.list().then(list => list.flatMap(item => item.panes.map(one => one.rootPath ?? null))))
      console.log(`[worktree-current] pane roots ${JSON.stringify(panes)}; worktree ${tree}; panel: ${(await panel.innerText()).slice(0, 400).replace(/\s+/g, ' ')}`)
      throw error
    }
    await expect(rowOf('hotfix')).toBeDisabled()
    await expect(rowOf('main')).not.toHaveAttribute('aria-current', 'true')
  } finally {
    await Promise.race([app.close().catch(() => undefined), new Promise(resolve => setTimeout(resolve, 4000))])
    rmSync(root, { recursive: true, force: true, maxRetries: 3 })
  }
})
