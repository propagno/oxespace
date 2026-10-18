import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * A pane shows the branch its agent works on. The agent hooks report the session's directory; when the agent
 * moves into a worktree of the same repository, the pane badge and the Review panel follow it, and when the
 * agent ends they return to the pane's own directory. The hook server does not run in mock mode, so the
 * report is delivered on its IPC channel the way the main process sends it.
 */
test('pane branch and Review follow the worktree the agent reports working in', async () => {
  test.setTimeout(90_000)
  const root = mkdtempSync(join(tmpdir(), 'oxe-location-'))
  const repo = join(root, 'repo')
  const tree = join(root, 'repo-agent')
  mkdirSync(repo, { recursive: true })
  const git = (...args: string[]): void => { execFileSync('git', args, { cwd: repo }) }
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'e2e@example.com'); git('config', 'user.name', 'E2E')
  writeFileSync(join(repo, 'README.md'), '# repo\n')
  git('add', '.'); git('commit', '-qm', 'base')
  git('worktree', 'add', '-q', '-b', 'agent/fix', tree)
  writeFileSync(join(tree, 'agent-file.ts'), 'export const fixed = true\n')

  const app = await electron.launch({ args: [join(process.cwd(), 'e2e/electron-main.cjs')], env: {
    ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_E2E_REAL_GIT_BRANCH: '1', OXESPACE_DB_PATH: join(root, 'db.sqlite3')
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
    const badge = page.getByTestId('pane-branch-badge').first()
    await expect(badge).toContainText('main')

    const paneId = await pane.getAttribute('data-pane-id')
    // The renderer keys the location by pane; the workspace id is informational.
    const workspaceId = ''
    const send = (channel: string, payload: unknown): Promise<void> => app.evaluate(({ BrowserWindow }, [name, body]) => {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send(name as string, body)
    }, [channel, payload] as const)

    await send('agent-hooks:on-location', { paneId, workspaceId, agent: 'claude-code', sessionId: 's', at: 1, cwd: tree, checkoutRoot: tree, sameRepository: true })
    await expect(badge).toContainText('agent/fix')
    await expect(badge).toHaveAttribute('data-moved', 'true')

    // The Review panel reads the worktree the agent is in.
    await page.getByTestId('btn-open-tools').click()
    await page.getByTestId('tools-modal').getByRole('menuitem', { name: /^Review/ }).click()
    const changes = page.getByTestId('changes-panel')
    await expect(changes.getByRole('button', { name: 'Compare (side B)' })).toContainText('agent/fix')
    await expect(changes.getByRole('complementary', { name: 'Changed files' }).getByRole('treeitem', { name: 'agent-file.ts' })).toBeVisible()
    await page.screenshot({ path: test.info().outputPath('session-location.png') })

    // The agent ends: the pane is back on its own branch.
    await send('agent-hooks:on-status', { paneId, workspaceId, agent: 'claude-code', state: 'ended', event: 'SessionEnd', at: 2, sessionId: 's' })
    await expect(badge).toContainText('main')
    await expect(badge).not.toHaveAttribute('data-moved', 'true')
  } finally { await app.close() }
})
