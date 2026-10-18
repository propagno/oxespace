import { _electron as electron, expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { togglePanel, openConnections } from './helpers/panels'

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

    await togglePanel(page, 'Changes')
    const panel = page.getByTestId('changes-panel')
    await expect(panel).toBeVisible()

    await expect(panel.getByLabel('Total changes')).toContainText('+')
    await expect(panel.getByRole('button', { name: 'Base (side A)' })).toContainText('main')

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
    await page.getByRole('menuitemcheckbox', { name: 'Uncommitted changes' }).click()
    await expect(panel.getByText('No changes')).toBeVisible()
    if (process.env.OXESPACE_README_SHOTS) {
      await openConnections(page)
      await expect(page.getByRole('dialog', { name: 'Connections' })).toBeVisible()
      await page.waitForTimeout(600)
      await page.screenshot({ path: 'docs/assets/screenshots/mcp-catalog.png' })
    }
  } finally { await app.close() }
})

test('Changes panel compares any two sides: a branch that is not checked out, swapped sides, another worktree', async () => {
  test.setTimeout(90_000)
  const root = mkdtempSync(join(tmpdir(), 'oxe-changes-sides-'))
  const repo = join(root, 'repo')
  const tree = join(root, 'repo-tree')
  mkdirSync(repo, { recursive: true })
  const git = (...args: string[]): void => { execFileSync('git', args, { cwd: repo }) }
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'e2e@example.com'); git('config', 'user.name', 'E2E')
  writeFileSync(join(repo, 'README.md'), '# repo\n')
  git('add', '.'); git('commit', '-qm', 'base')
  git('checkout', '-qb', 'feature/other')
  writeFileSync(join(repo, 'feature-only.ts'), 'export const feature = 1\n')
  git('add', '.'); git('commit', '-qm', 'feature')
  git('checkout', '-q', 'main')
  writeFileSync(join(repo, 'main-only.ts'), 'export const main = 1\n')
  git('add', '.'); git('commit', '-qm', 'main later')
  git('checkout', '-qb', 'feature/tree')
  git('checkout', '-q', 'main')
  git('worktree', 'add', '-q', tree, 'feature/tree')
  writeFileSync(join(tree, 'in-tree.ts'), 'uncommitted in the other worktree\n')

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
    await togglePanel(page, 'Changes')
    const panel = page.getByTestId('changes-panel')
    const files = panel.getByRole('complementary', { name: 'Changed files' })
    await expect(panel).toBeVisible()
    // main checked out against base main: nothing differs.
    await expect(panel.getByText('No changes')).toBeVisible()

    // Side B: a branch that is not checked out.
    await panel.getByRole('button', { name: 'Compare (side B)' }).click()
    await page.getByRole('dialog', { name: 'Compare (side B)' }).getByRole('button', { name: 'feature/other' }).click()
    await expect(panel.getByRole('button', { name: 'Compare (side B)' })).toContainText('feature/other')
    await expect(files.getByRole('treeitem', { name: 'feature-only.ts' })).toBeVisible()
    await expect(files.getByRole('treeitem', { name: 'main-only.ts' })).toHaveCount(0)
    await expect(panel.locator('.monaco-diff-editor')).toContainText('export const feature', { timeout: 15000 })

    // Swap: feature/other becomes the base and main the compared side.
    await panel.getByRole('button', { name: 'Swap sides' }).click()
    await expect(panel.getByRole('button', { name: 'Base (side A)' })).toContainText('feature/other')
    await expect(files.getByRole('treeitem', { name: 'main-only.ts' })).toBeVisible()
    await expect(files.getByRole('treeitem', { name: 'feature-only.ts' })).toHaveCount(0)

    // Side B: another worktree, uncommitted files included, read from that worktree.
    await panel.getByRole('button', { name: 'Base (side A)' }).click()
    await page.getByRole('dialog', { name: 'Base (side A)' }).getByRole('button', { name: 'main', exact: true }).click()
    await panel.getByRole('button', { name: 'Compare (side B)' }).click()
    await page.getByRole('dialog', { name: 'Compare (side B)' }).getByRole('button', { name: /feature\/tree · worktree/ }).click()
    await files.getByRole('treeitem', { name: 'in-tree.ts' }).click()
    await expect(panel.locator('.monaco-diff-editor')).toContainText('uncommitted in the other worktree', { timeout: 15000 })
    await page.screenshot({ path: test.info().outputPath('changes-sides.png') })

    // The classic review takes the same two sides.
    await page.getByText('Classic', { exact: true }).first().click()
    const classic = page.locator('.review-pane')
    // It used to collapse to zero width in the side panel.
    await expect(classic).toBeVisible()
    expect((await classic.boundingBox())?.width ?? 0).toBeGreaterThan(300)
    await classic.getByRole('button', { name: 'Compare (side B)' }).click()
    await page.getByRole('dialog', { name: 'Compare (side B)' }).getByRole('button', { name: 'feature/other' }).click()
    await expect(classic).toContainText('feature-only.ts')
    await expect(classic.getByRole('button', { name: 'Uncommitted' })).toBeDisabled()
    await page.screenshot({ path: test.info().outputPath('classic-sides.png') })
  } finally { await app.close() }
})

test('the editor opens a file in Changes, where any branch can be picked against it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oxe-changes-from-editor-'))
  const repo = join(root, 'repo')
  mkdirSync(join(repo, 'src'), { recursive: true })
  const git = (...args: string[]): void => { execFileSync('git', args, { cwd: repo }) }
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'e2e@example.com'); git('config', 'user.name', 'E2E')
  writeFileSync(join(repo, 'src', 'app.ts'), 'export const a = 1\n')
  writeFileSync(join(repo, 'README.md'), '# repo\n')
  git('add', '.'); git('commit', '-qm', 'base')
  git('checkout', '-qb', 'feature/editor')
  writeFileSync(join(repo, 'src', 'app.ts'), 'export const a = 2\n')
  writeFileSync(join(repo, 'README.md'), '# repo, changed\n')
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

    await togglePanel(page, 'Files')
    const editor = page.getByTestId('workspace-editor-panel')
    await editor.getByRole('tree', { name: 'Files' }).getByRole('treeitem', { name: 'src' }).click()
    await editor.getByRole('tree', { name: 'Files' }).getByRole('treeitem', { name: 'app.ts' }).click()
    await editor.getByTestId('editor-open-in-changes').click()

    const panel = page.getByTestId('changes-panel')
    const files = panel.getByRole('complementary', { name: 'Changed files' })
    await expect(files.getByLabel('Filter files')).toHaveValue('src/app.ts')
    await expect(files.getByRole('treeitem', { name: 'app.ts' })).toBeVisible()
    await expect(files.getByRole('treeitem', { name: 'README.md' })).toHaveCount(0)
    await expect(panel.locator('.changes-file-path strong')).toHaveText('app.ts')
  } finally { await app.close() }
})
