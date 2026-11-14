import { expect, test, type Locator } from '@playwright/test'
import { launchApp, resizeWindow } from './helpers/launch'
import { seedGitRepo } from './helpers/seed'
import { togglePanel } from './helpers/panels'

/**
 * OXE-158: the line comments' "+" (diffLineComments) and the hunk glyphs (diffHunkOpen) live in the glyph margin of
 * both diff editors. In the inline view (the Changes panel is narrower than Monaco's 900 px breakpoint) Monaco turns
 * the original side's lane off each time the diff's options are applied again, and a re-render after mount did that,
 * so the old side had a 0 px lane: no "+" on a removed line, and the whole diff 16 px off its first layout (FL-15).
 */
const lane = (diff: Locator, side: 'original' | 'modified'): Promise<number> =>
  diff.evaluate((root, s) => Math.round(root.querySelector(`.editor.${s} .glyph-margin`)?.getBoundingClientRect().width ?? 0), side)
const plus = (diff: Locator, side: 'original' | 'modified'): Promise<number> =>
  diff.evaluate((root, s) => Math.round(root.querySelector(`.editor.${s} .oxe-diff-add-glyph`)?.getBoundingClientRect().width ?? 0), side)

test('the Changes diff keeps a glyph lane on both sides, with the comment "+" on the hovered line', async () => {
  test.setTimeout(120_000)
  const { app, page, root } = await launchApp({ realClock: true })
  const repo = `${root}/repo`
  try {
    seedGitRepo(repo, { withBranchChanges: true })
    await resizeWindow(app, 1280, 800)
    await page.getByTestId('btn-new-workspace').click()
    await page.getByTestId('wizard-dir-input').fill(repo)
    await page.getByTestId('wizard-layout-card-1').click()
    await page.getByTestId('wizard-launch-btn').click()
    await expect(page.getByTestId('terminal-pane')).toHaveCount(1)

    await togglePanel(page, 'Changes')
    const panel = page.getByTestId('changes-panel')
    await panel.getByRole('complementary', { name: 'Changed files' }).getByRole('treeitem', { name: 'app.ts' }).click()
    const diff = panel.locator('.monaco-diff-editor').first()
    await expect(diff).toContainText('unmodified lines', { timeout: 15_000 })
    // After the font pass (MonacoDiff marks it) every post-mount render and layout has run.
    await expect.poll(() => diff.evaluate(element => !!element.closest('[data-fonts-measured="true"]')), { timeout: 10_000 }).toBe(true)
    // The case under test: the panel is narrow, so Monaco shows the diff inline (where it drops the old side's lane).
    expect(await diff.evaluate(element => element.classList.contains('side-by-side')), 'diff should be inline at this width').toBe(false)

    await expect.poll(() => lane(diff, 'modified'), { timeout: 10_000 }).toBeGreaterThan(0)
    await expect.poll(() => lane(diff, 'original'), { timeout: 10_000 }).toBeGreaterThan(0)

    // Old side: hover the removed line's number; its "+" shows in the lane and opens the comment box for that line.
    await diff.locator('.editor.original .line-numbers', { hasText: /^31$/ }).hover()
    await expect.poll(() => plus(diff, 'original'), { timeout: 5_000 }).toBeGreaterThan(0)
    await diff.locator('.editor.original .oxe-diff-add-glyph').click()
    await expect(panel.locator('.oxe-line-composer textarea')).toHaveAttribute('aria-label', /31/)
    await panel.locator('.oxe-line-composer textarea').press('Escape')
    await expect(panel.locator('.oxe-line-composer')).toHaveCount(0)

    // New side: the changed line gets its "+" too.
    await diff.locator('.editor.modified .view-line', { hasText: 'CHANGED' }).first().hover()
    await expect.poll(() => plus(diff, 'modified'), { timeout: 5_000 }).toBeGreaterThan(0)
    // Both lanes are still there after the hovers re-rendered the decorations.
    expect(await lane(diff, 'original')).toBeGreaterThan(0)
  } finally { await app.close() }
})
