import { test, expect, type Page } from '@playwright/test'
import { scanSurface, writeReport, type Violation } from '../helpers/a11y'
import { launchApp, openDemoWorkspace, resizeWindow, type Appearance } from '../helpers/launch'
import { seedGitRepo } from '../helpers/seed'
import { installThreadFixtures, openThreadWithState, registerThreadProject, setThreadState, THREAD_STATES, type ThreadStateName } from '../helpers/thread-fixtures'

/**
 * Accessibility scan (axe, WCAG 2.0/2.1 A and AA) over the surfaces the visual suite already
 * reaches, in both themes. Run with `npm run test:a11y`.
 *
 * Informative for 1.0: it records what it finds in a JSON-lines report (OXE_A11Y_REPORT, default
 * test-results/a11y-report.jsonl) and does not fail. Set OXE_A11Y_STRICT=1 to fail on any violation.
 */
const REPORT = process.env.OXE_A11Y_REPORT ?? 'test-results/a11y-report.jsonl'
const STRICT = process.env.OXE_A11Y_STRICT === '1'
const THEMES: Appearance[] = ['light', 'dark']
const THREAD_SURFACES: ThreadStateName[] = ['empty', 'conversation', 'approval', 'question', 'usage-failure', 'workbench']

async function record(violations: Violation[], found: Violation[]): Promise<void> {
  found.push(...violations)
  writeReport(REPORT, violations)
}

async function openTool(page: Page, name: RegExp): Promise<void> {
  await page.getByTestId('btn-open-tools').click()
  await page.getByTestId('tools-modal').getByRole('menuitem', { name }).click()
}

for (const theme of THEMES) {
  test(`a11y: empty state and Code surfaces — ${theme}`, async () => {
    test.setTimeout(180_000)
    const found: Violation[] = []
    const { app, page, root } = await launchApp({ appearance: theme })
    try {
      await resizeWindow(app, 1280, 800)
      await page.waitForSelector('[data-testid="btn-new-workspace"]')
      await record(await scanSurface(page, `${theme}/empty`), found)

      const repo = `${root}/repo`
      seedGitRepo(repo, { withBranchChanges: true })
      await page.getByTestId('btn-new-workspace').click()
      await page.getByTestId('wizard-dir-input').fill(repo)
      await page.getByTestId('wizard-layout-card-1').click()
      await record(await scanSurface(page, `${theme}/new-workspace-wizard`), found)
      await page.getByTestId('wizard-launch-btn').click()
      await expect(page.getByTestId('terminal-pane')).toHaveCount(1)
      await record(await scanSurface(page, `${theme}/workspace`), found)

      await page.getByTestId('btn-open-tools').click()
      await expect(page.getByTestId('tools-modal')).toBeVisible()
      await record(await scanSurface(page, `${theme}/tools-menu`), found)
      await page.keyboard.press('Escape')

      await page.keyboard.press('Control+k')
      await expect(page.locator('[cmdk-root]')).toBeVisible()
      await record(await scanSurface(page, `${theme}/command-palette`), found)
      await page.keyboard.press('Escape')

      await openTool(page, /^Review/)
      const panel = page.getByTestId('changes-panel')
      await expect(panel).toBeVisible()
      await panel.getByRole('complementary', { name: 'Changed files' }).getByRole('treeitem', { name: 'app.ts' }).click()
      await expect(panel.locator('.monaco-diff-editor')).toContainText('unmodified lines', { timeout: 15_000 })
      await record(await scanSurface(page, `${theme}/changes`), found)

      await openTool(page, /^GitHub/)
      await expect(page.getByTestId('workspace-github-panel')).toBeVisible()
      await record(await scanSurface(page, `${theme}/github`), found)
    } finally {
      await app.close()
    }
    if (STRICT) expect(found, JSON.stringify(found.map(v => `${v.surface} ${v.rule}`))).toEqual([])
  })

  test(`a11y: Thread states — ${theme}`, async () => {
    test.setTimeout(180_000)
    const found: Violation[] = []
    const { app, page, workspaceRoot } = await launchApp({ appearance: theme })
    try {
      await page.evaluate(() => localStorage.setItem('oxe.thread.viewMode', 'verbose'))
      await page.reload()
      await page.waitForLoadState('load')
      await resizeWindow(app, 1280, 800)
      await installThreadFixtures(app, workspaceRoot)
      await openDemoWorkspace(page, workspaceRoot)
      await registerThreadProject(app, page, workspaceRoot)
      await openThreadWithState(app, page, workspaceRoot, THREAD_SURFACES[0])
      for (const state of THREAD_SURFACES) {
        await setThreadState(app, workspaceRoot, state)
        await expect(page.locator('.thread-view')).toContainText(THREAD_STATES[state].title.split(' ')[0])
        await record(await scanSurface(page, `${theme}/thread-${state}`), found)
      }
    } finally {
      await app.close()
    }
    if (STRICT) expect(found, JSON.stringify(found.map(v => `${v.surface} ${v.rule}`))).toEqual([])
  })
}
