import { _electron as electron, expect, test, type Locator, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connectFromContainer } from './helpers/oxepod'

async function drag(page: Page, handle: Locator, dx: number, dy: number): Promise<void> {
  const box = (await handle.boundingBox())!
  const x = box.x + box.width / 2, y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx / 2, y + dy / 2)
  await page.mouse.move(x + dx, y + dy)
  await page.mouse.up()
}
const height = (locator: Locator) => locator.evaluate(el => Math.round(el.getBoundingClientRect().height))
const width = (locator: Locator) => locator.evaluate(el => Math.round(el.getBoundingClientRect().width))

test('the query editor, the table list and the sidebar are resized by dragging their dividers', async () => {
  test.setTimeout(90000)
  const root = mkdtempSync(join(tmpdir(), 'oxespace-oq-resize-'))
  const repo = join(root, 'repo'); mkdirSync(repo)
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e/electron-main.cjs')], env: { ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_DB_PATH: join(root, 'app.sqlite3') } })
  try {
    const page = await app.firstWindow()
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.waitForLoadState('domcontentloaded')
    await page.getByTestId('btn-new-workspace').click()
    await page.getByTestId('wizard-dir-input').fill(repo)
    await page.getByTestId('wizard-layout-card-1').click()
    await page.getByTestId('wizard-launch-btn').click()
    await page.getByRole('navigation', { name: 'Application view' }).getByRole('button', { name: 'OxeQuery' }).click()
    await connectFromContainer(page, 'pg-dev')
    await expect(page.getByRole('tab', { name: 'pg-dev' })).toBeVisible()

    // Editor and results.
    const editor = page.locator('.oq-editor'), results = page.locator('.oq-results')
    const editorSplit = page.getByRole('separator', { name: 'Query editor height' })
    const before = await height(editor)
    await drag(page, editorSplit, 0, 120)
    await expect.poll(() => height(editor)).toBeGreaterThan(before + 100)
    // However far it is dragged, the results keep their minimum height.
    await drag(page, editorSplit, 0, 2000)
    expect(await height(results)).toBeGreaterThanOrEqual(119)
    await editorSplit.dblclick()
    await expect.poll(() => height(editor)).toBe(170)
    await editorSplit.focus()
    await page.keyboard.press('ArrowDown')
    await expect.poll(() => height(editor)).toBe(186)
    await page.screenshot({ path: 'test-results/oxequery-resized.png' })

    // Table list.
    const tree = page.locator('.oq-tree')
    const treeSplit = page.getByRole('separator', { name: 'Table list width' })
    const treeBefore = await width(tree)
    await drag(page, treeSplit, 100, 0)
    await expect.poll(() => width(tree)).toBeGreaterThan(treeBefore + 80)
    await treeSplit.focus()
    await page.keyboard.press('Home')
    await expect.poll(() => width(tree)).toBe(180)

    // App sidebar.
    const sidebar = page.getByRole('complementary', { name: 'OxeQuery sidebar' })
    const sidebarSplit = page.getByRole('separator', { name: 'OxeQuery sidebar width' })
    const sidebarBefore = await width(sidebar)
    await drag(page, sidebarSplit, 60, 0)
    await expect.poll(() => width(sidebar)).toBeGreaterThan(sidebarBefore + 40)

    // The sizes are remembered.
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('oxe.oxequery.layout') ?? '{}').state)
    expect(saved).toMatchObject({ editorHeight: 186, treeWidth: 180 })
  } finally { await app.close() }
})
