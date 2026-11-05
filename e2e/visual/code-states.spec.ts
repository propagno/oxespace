import { test, expect, type Locator, type Page } from '@playwright/test'
import { launchApp, resizeWindow, type Appearance } from '../helpers/launch'
import { seedGitRepo } from '../helpers/seed'
import { expectSurface } from '../helpers/visual'

const THEMES: Appearance[] = ['light', 'dark']

async function openWorkspace(page: Page, repo: string, layoutCard: 1 | 2 | 4): Promise<void> {
  await page.getByTestId('btn-new-workspace').click()
  await page.getByTestId('wizard-dir-input').fill(repo)
  await page.getByTestId(`wizard-layout-card-${layoutCard}`).click()
  await page.getByTestId('wizard-launch-btn').click()
  await expect(page.getByTestId('terminal-pane')).toHaveCount(layoutCard)
}

async function openTool(page: Page, name: RegExp): Promise<void> {
  await page.getByTestId('btn-open-tools').click()
  await page.getByRole('menu', { name: 'Panels' }).getByRole('menuitemcheckbox', { name }).click()
}

/**
 * FL-15: Monaco sizes the line-number gutter from the digit width it measures, and measures again once the mono web
 * font has loaded. The update pass and the verify pass of one job caught the two layouts (the text 16 px apart), so
 * the shot waits for the fonts, then for the editor's geometry and line count to hold still over three polls.
 */
async function monacoDiffSettled(page: Page, editor: Locator): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  // FL-15 again (Windows, after #586): the fallback font's layout can hold still long enough to pass the poll below.
  // MonacoDiff marks its container once it has measured the loaded font and laid out again; wait for that first.
  await expect.poll(() => editor.evaluate(root => !!root.closest('[data-fonts-measured="true"]')), { timeout: 10_000 }).toBe(true)
  const geometry = (): Promise<string> => editor.evaluate(root => {
    const boxes = [...root.querySelectorAll('.margin, .lines-content, .view-lines, .line-numbers')].slice(0, 12)
      .map(element => { const box = element.getBoundingClientRect(); return `${Math.round(box.left)}:${Math.round(box.width)}` })
    return `${boxes.join(',')}|${root.querySelectorAll('.view-line').length}`
  })
  let last = '', still = 0
  await expect.poll(async () => {
    const now = await geometry()
    still = now === last ? still + 1 : 0
    last = now
    return still
  }, { intervals: [150], timeout: 10_000 }).toBeGreaterThanOrEqual(3)
}

// Terminals are hidden by expectSurface. The temp path and the sidebar age ("Just now" depends
// on the time of day relative to the frozen clock) vary, so they are hidden too.
const liveMasks = (page: Page) => [page.locator('.app-statusbar [class*="path"]'), page.locator('.pane-row-time')]

for (const theme of THEMES) {
  test(`code states with branch changes — ${theme}`, async () => {
    test.setTimeout(180_000)
    const { app, page, root, consoleErrors } = await launchApp({ appearance: theme })
    const repo = `${root}/repo`
    try {
      seedGitRepo(repo, { withBranchChanges: true })
      await resizeWindow(app, 1280, 800)
      await openWorkspace(page, repo, 1)

      await expectSurface(page, `code-single-terminal-${theme}`, { hide: liveMasks(page) })

      await page.getByTestId('btn-open-tools').click()
      await expect(page.getByRole('menu', { name: 'Panels' })).toBeVisible()
      await expectSurface(page, `code-tools-menu-${theme}`, { hide: liveMasks(page) })
      await page.keyboard.press('Escape')

      await page.keyboard.press('Control+k')
      await expect(page.locator('[cmdk-root]')).toBeVisible()
      // The workspace row prints the random temp directory; the rest of the list is stable.
      const randomPath = page.locator('[cmdk-item]', { hasText: 'oxespace-visual' }).locator('[class*="detail"]')
      await expectSurface(page, `code-command-palette-${theme}`, { hide: [...liveMasks(page), randomPath] })
      await page.keyboard.press('Escape')

      await openTool(page, /^Changes$/)
      const panel = page.getByTestId('changes-panel')
      await expect(panel).toBeVisible()
      await panel.getByRole('complementary', { name: 'Changed files' }).getByRole('treeitem', { name: 'app.ts' }).click()
      await expect(panel.locator('.monaco-diff-editor')).toContainText('unmodified lines', { timeout: 15_000 })
      // Monaco lays out the overview ruler a frame or two after the text, and the rows narrow to make room for it;
      // wait for it so the layout is always the final one. The cursor, current-line box and ruler marks then come and
      // go with focus, so a style rule (which also covers elements Monaco adds later) hides them.
      await expect(panel.locator('.monaco-diff-editor .decorationsOverviewRuler').first()).toBeAttached()
      await page.addStyleTag({ content: '.monaco-diff-editor :is(.cursors-layer, .current-line, .decorationsOverviewRuler, .diffOverview){visibility:hidden!important}' })
      await monacoDiffSettled(page, panel.locator('.monaco-diff-editor').first())
      await expectSurface(page, `code-changes-diff-${theme}`, { hide: liveMasks(page) })

      await openTool(page, /^Commit & pull request$/)
      await expect(page.getByTestId('workspace-github-panel')).toBeVisible()
      await expectSurface(page, `code-github-${theme}`, { hide: liveMasks(page) })

      await openTool(page, /^Find in files$/)
      // The panel may or may not take focus by the time of the capture; the focus ring then differs between
      // runs (953 px on the Windows runner). The field is focused on purpose so every run captures the same.
      const query = page.getByTestId('workspace-search-panel').getByPlaceholder('Find in files…')
      await query.focus()
      await expect(query).toBeFocused()
      await expectSurface(page, `code-search-${theme}`, { hide: liveMasks(page) })

      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
      expect(consoleErrors).toEqual([])
    } finally {
      await app.close()
    }
  })

  test(`code states without changes and with four terminals — ${theme}`, async () => {
    test.setTimeout(180_000)
    const { app, page, root, consoleErrors } = await launchApp({ appearance: theme })
    const repo = `${root}/repo`
    try {
      seedGitRepo(repo, { withBranchChanges: false })
      await resizeWindow(app, 1280, 800)
      await openWorkspace(page, repo, 4)
      await expectSurface(page, `code-four-terminals-${theme}`, { hide: liveMasks(page) })

      await openTool(page, /^Changes$/)
      await expect(page.getByTestId('changes-panel')).toBeVisible()
      await expectSurface(page, `code-changes-empty-${theme}`, { hide: liveMasks(page) })

      expect(consoleErrors).toEqual([])
    } finally {
      await app.close()
    }
  })
}
