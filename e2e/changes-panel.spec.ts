import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('Changes panel lists branch changes, switches base and shows a side-by-side diff', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oxe-changes-'))
  const repo = join(root, 'repo')
  mkdirSync(join(repo, 'src'), { recursive: true })
  const git = (...args: string[]): void => { execFileSync('git', args, { cwd: repo }) }
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'e2e@example.com'); git('config', 'user.name', 'E2E')
  writeFileSync(join(repo, 'src', 'app.ts'), Array.from({ length: 60 }, (_, index) => `line ${index + 1}`).join('\n') + '\n')
  writeFileSync(join(repo, 'README.md'), '# repo\n')
  git('add', '.'); git('commit', '-qm', 'base')
  git('checkout', '-qb', 'feature/changes')
  writeFileSync(join(repo, 'src', 'app.ts'), Array.from({ length: 60 }, (_, index) => index === 30 ? 'line 31 CHANGED' : `line ${index + 1}`).join('\n') + '\n')
  writeFileSync(join(repo, 'docs.md'), 'new file\n')
  git('add', '.'); git('commit', '-qm', 'feature')

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
    await expect(page.getByTestId('terminal-pane')).toHaveCount(1)

    await page.getByTestId('btn-open-tools').click()
    await page.getByTestId('tools-modal').getByRole('menuitem', { name: /^Review/ }).click()
    const panel = page.getByTestId('changes-panel')
    await expect(panel).toBeVisible()

    await expect(panel.getByLabel('Total changes')).toContainText('+')
    await expect(panel.getByRole('button', { name: 'Compare branches' })).toContainText('main')

    const files = panel.getByRole('complementary', { name: 'Changed files' })
    await expect(files.getByRole('treeitem', { name: 'app.ts' })).toBeVisible()
    await expect(files.getByRole('treeitem', { name: 'docs.md' })).toBeVisible()
    await files.getByRole('treeitem', { name: 'app.ts' }).click()
    await expect(panel.locator('.changes-file-path strong')).toHaveText('app.ts')
    // Monaco renders both sides and folds the unchanged regions.
    await expect(panel.locator('.monaco-diff-editor')).toBeVisible({ timeout: 15000 })
    await expect(panel.locator('.monaco-diff-editor')).toContainText('unmodified lines')
    await expect(panel.locator('.monaco-diff-editor')).not.toContainText('hidden lines')
    await page.screenshot({ path: test.info().outputPath('changes-panel.png') })

    // "Viewed" persists per file and is summarised under the tree.
    const viewed = panel.getByRole('button', { name: 'Viewed', exact: true })
    await expect(viewed).toHaveAttribute('aria-pressed', 'false')
    await viewed.click()
    await expect(viewed).toHaveAttribute('aria-pressed', 'true')
    await expect(files.getByText('1/2 viewed')).toBeVisible()

    // Line comments: hover a changed line, use the "+" in the gutter, save, then discard.
    await panel.locator('.monaco-diff-editor .modified .view-line', { hasText: 'CHANGED' }).first().hover()
    await panel.locator('.oxe-diff-add-glyph').first().click()
    // The comment box is an overlay widget inside Monaco, located structurally.
    await panel.locator('.oxe-line-composer textarea').fill('Please rename this value')
    await panel.locator('.oxe-line-composer button.is-primary').click()
    await expect(panel.getByRole('group', { name: 'Review comments' })).toContainText('1 comment')
    await expect(panel.locator('.oxe-line-comment')).toContainText('Please rename this value')
    await page.screenshot({ path: test.info().outputPath('changes-comment.png') })
    if (process.env.OXESPACE_README_SHOTS) await page.screenshot({ path: 'docs/assets/screenshots/code-review.png' })
    await panel.locator('.oxe-line-comment-remove').click()
    await expect(panel.getByRole('group', { name: 'Review comments' })).toHaveCount(0)

    await files.getByLabel('Filter files').fill('docs')
    await expect(files.getByRole('treeitem', { name: 'app.ts' })).toHaveCount(0)
    await expect(panel.locator('.changes-file-path strong')).toHaveText('docs.md')

    await panel.getByRole('button', { name: 'Change scope' }).click()
    await page.getByRole('menuitemradio', { name: 'Uncommitted changes' }).click()
    await expect(panel.getByText('No changes')).toBeVisible()
    if (process.env.OXESPACE_README_SHOTS) {
      await page.getByTestId('btn-open-tools').click()
      await page.getByTestId('tools-modal').getByRole('menuitem', { name: /^MCP Servers/ }).click()
      await expect(page.getByRole('dialog', { name: 'Connections' })).toBeVisible()
      await page.waitForTimeout(600)
      await page.screenshot({ path: 'docs/assets/screenshots/mcp-catalog.png' })
    }
  } finally { await app.close() }
})
