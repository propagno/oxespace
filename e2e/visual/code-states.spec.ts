import { test, expect, type Locator, type Page } from '@playwright/test'
import { launchApp, pinWorkspaceColor, resizeWindow, type Appearance } from '../helpers/launch'
import { seedGitRepo } from '../helpers/seed'
import { expectSurface } from '../helpers/visual'

const THEMES: Appearance[] = ['light', 'dark']

async function openWorkspace(page: Page, repo: string, layoutCard: 1 | 2 | 4): Promise<void> {
  await page.getByTestId('btn-new-workspace').click()
  await page.getByTestId('wizard-dir-input').fill(repo)
  await page.getByTestId(`wizard-layout-card-${layoutCard}`).click()
  await page.getByTestId('wizard-launch-btn').click()
  await expect(page.getByTestId('terminal-pane')).toHaveCount(layoutCard)
  await pinWorkspaceColor(page)
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
  // FL-15 on Linux: the two passes drew the gutter in two fonts. The shot needs IBM Plex Mono itself loaded, not only
  // the mark; the CI images ship the font through @fontsource, so this holds on both runners.
  await expect.poll(() => page.evaluate(() => [...document.fonts].some(face => face.family.replace(/^['"]|['"]$/g, '') === 'IBM Plex Mono' && face.status === 'loaded')), { timeout: 10_000 }).toBe(true)
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
  // FL-15 diagnostic (windows, run 42426690630): with the same font in both passes, the whole inline diff still sat a
  // few px apart. One line per shot, so the generate and verify logs of a failing run show which number differs.
  const diag = await editor.evaluate(root => {
    const box = (selector: string): string => {
      const element = root.querySelector(selector)
      if (!element) return `${selector}=none`
      const rect = element.getBoundingClientRect()
      return `${selector}=${Math.round(rect.left)}+${Math.round(rect.width)}`
    }
    const numbers = root.querySelector('.line-numbers')
    return [
      `dpr=${window.devicePixelRatio}`, `inner=${window.innerWidth}x${window.innerHeight}`, `zoom=${getComputedStyle(document.documentElement).zoom}`,
      `editor=${Math.round(root.getBoundingClientRect().left)}+${Math.round(root.getBoundingClientRect().width)}`,
      `font=${numbers ? getComputedStyle(numbers).fontFamily.split(',')[0] : 'none'}`,
      box('.editor.original'), box('.editor.modified'), box('.margin'), box('.glyph-margin'), box('.line-numbers'), box('.lines-content'),
      `inline=${root.querySelector('.monaco-diff-editor.side-by-side') ? 'no' : 'yes'}`
    ].join(' ')
  })
  console.log(`[FL-15-DIAG] ${diag}`)
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
      const changes = page.getByTestId('changes-panel')
      await expect(changes).toBeVisible()
      // FL-23 (windows 42443679631): one pass shot the panel still on "Loading changes…" with its spinner, the other the
      // settled empty state. Shoot only once the empty state is in and nothing is loading.
      await expect(changes.getByText('No changes', { exact: true })).toBeVisible()
      await expect(changes.getByText('Loading changes…')).toHaveCount(0)
      // While a load runs (the first one, or the 10 s poll) the refresh button is a disabled spinner.
      await expect(changes.getByRole('button', { name: 'Refresh changes' })).toBeEnabled()
      await expectSurface(page, `code-changes-empty-${theme}`, { hide: liveMasks(page) })

      expect(consoleErrors).toEqual([])
    } finally {
      await app.close()
    }
  })
}
