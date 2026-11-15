// Frozen end-to-end acceptance test for 1.5.2 OxeCode/Shell F6 (Jira OXE-185, AG-04d, CA-4), in the built app with real
// services (OXESPACE_E2E_MOCK_NATIVE=0, real git, main's changed-files count). Written by the planner; the executor must
// not edit it. Red until T42 and T43.
// Contract: in a clean git repository the workspace bar's Changes button has no count; after a file changes on disk, the
// button reads "Changes, 1 file" without the Changes panel being opened.
import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, openDemoWorkspace, resizeWindow } from '../helpers/launch'

const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' })

test('AG-04d in the app: the Changes button counts the changed files without opening the panel', async () => {
  test.setTimeout(180_000)
  const { app, page, workspaceRoot } = await launchApp({ appearance: 'light', env: { OXESPACE_E2E_MOCK_NATIVE: '0' } })
  try {
    git(workspaceRoot, 'init', '-q', '-b', 'main')
    git(workspaceRoot, 'config', 'user.email', 'e2e@example.com')
    git(workspaceRoot, 'config', 'user.name', 'e2e')
    writeFileSync(join(workspaceRoot, 'README.md'), '# demo\n')
    git(workspaceRoot, 'add', '.')
    git(workspaceRoot, 'commit', '-q', '-m', 'init')
    await resizeWindow(app, 1440, 900)
    await openDemoWorkspace(page, workspaceRoot)
    const header = page.locator('header[aria-label="Workspace status"], [data-ui="workspace-header"]').first()
    await expect(header.getByRole('button', { name: /^Changes$/ })).toHaveCount(1)
    writeFileSync(join(workspaceRoot, 'README.md'), '# demo\nchanged\n')
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(header.getByRole('button', { name: 'Changes, 1 file' })).toHaveCount(1, { timeout: 30_000 })
    await expect(page.getByTestId('changes-panel')).toHaveCount(0)
  } finally {
    await app.close()
  }
})
