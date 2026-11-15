// Frozen end-to-end acceptance test for 1.5.2 OxeCode/Shell F6 (Jira OXE-183, AG-04b, CA-5), in the built app with real
// services (OXESPACE_E2E_MOCK_NATIVE=0, real git). Written by the planner; the executor must not edit it. Red until T39 and T40.
// Contract: with a git repository and a worktree of it, a pane rooted in the worktree (workspace.setPaneRootPath, main's
// real workspace service) makes the Changes panel read the worktree; pinning there and then activating a pane of the root
// keeps the panel on the worktree (the badge still names it, and its title says "Pinned to <worktree folder>").
import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, openDemoWorkspace, resizeWindow } from '../helpers/launch'

const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' })

test('AG-04b in the app: the pin keeps the worktree being read', async () => {
  test.setTimeout(180_000)
  const { app, page, root, workspaceRoot } = await launchApp({ appearance: 'light', env: { OXESPACE_E2E_MOCK_NATIVE: '0' } })
  try {
    git(workspaceRoot, 'init', '-q', '-b', 'main')
    git(workspaceRoot, 'config', 'user.email', 'e2e@example.com')
    git(workspaceRoot, 'config', 'user.name', 'e2e')
    writeFileSync(join(workspaceRoot, 'README.md'), '# demo\n')
    git(workspaceRoot, 'add', '.')
    git(workspaceRoot, 'commit', '-q', '-m', 'init')
    const worktree = join(root, 'hotfix-pix')
    git(workspaceRoot, 'worktree', 'add', '-q', '-b', 'hotfix/pix', worktree)
    await resizeWindow(app, 1440, 900)
    await openDemoWorkspace(page, workspaceRoot)
    const panes = await page.evaluate(() => (window as unknown as { oxe: { workspace: { list(): Promise<Array<{ panes: Array<{ id: string; type: string }> }>> } } }).oxe.workspace.list()
      .then(list => list.flatMap(workspace => workspace.panes).filter(pane => pane.type === 'terminal').map(pane => pane.id)))
    expect(panes.length).toBeGreaterThanOrEqual(2)
    await page.evaluate(input => (window as unknown as { oxe: { workspace: { setPaneRootPath(input: unknown): Promise<unknown> } } }).oxe.workspace.setPaneRootPath(input), { paneId: panes[1], rootPath: worktree })
    await page.reload()
    await page.waitForSelector('[data-testid="pane-container"]')
    await page.locator(`[data-testid="pane-container"][data-pane-id="${panes[1]}"]`).click()
    await page.getByTestId('btn-open-tools').click()
    await page.getByRole('menu', { name: 'Panels' }).getByRole('menuitemcheckbox', { name: /^Changes$/ }).click()
    const badge = page.getByTestId('panel-scope-badge').first()
    await expect(badge).toContainText('hotfix/pix')
    await badge.click()
    await expect(badge).toHaveAttribute('title', 'Pinned to hotfix-pix')
    await page.locator(`[data-testid="pane-container"][data-pane-id="${panes[0]}"]`).click()
    await expect(badge).toContainText('hotfix/pix')
    await expect(badge).toHaveAttribute('aria-pressed', 'true')
  } finally {
    await app.close()
  }
})
