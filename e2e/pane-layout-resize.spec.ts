import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('three terminals resize in both axes without replacing terminal DOM', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oxe-layout-'))
  const repo = join(root, 'repo'); mkdirSync(repo)
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e/electron-main.cjs')], env: {
    ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_DB_PATH: join(root, 'db.sqlite3')
  } })
  try {
    const page = await app.firstWindow()
    await page.setViewportSize({ width: 1360, height: 900 })
    await page.getByTestId('btn-new-workspace').click()
    await page.getByTestId('wizard-dir-input').fill(repo)
    await page.getByTestId('wizard-layout-card-2').click()
    await page.getByTestId('wizard-launch-btn').click()
    await expect(page.getByTestId('terminal-pane')).toHaveCount(2)
    await page.getByRole('button', { name: 'More pane actions' }).nth(1).click()
    await page.getByRole('menuitem', { name: 'Dividir horizontal', exact: true }).click()
    await expect(page.getByTestId('terminal-pane')).toHaveCount(3)
    const grid = page.getByTestId('workspace-split-grid')
    await grid.evaluate(el => { el.querySelectorAll('.terminal-pane').forEach(node => node.setAttribute('data-preserved', 'yes')) })
    for (const orientation of ['horizontal', 'vertical']) {
      const handle = grid.locator(`[role="separator"][aria-orientation="${orientation}"]`).first()
      await expect(handle).toHaveCSS('position', 'absolute')
      const box = (await handle.boundingBox())!
      const x = box.x + box.width / 2, y = box.y + box.height / 2
      expect(await page.evaluate(({x,y}) => document.elementFromPoint(x,y)?.getAttribute('role'), {x,y})).toBe('separator')
      await page.mouse.move(x, y)
      await page.mouse.down()
      await page.mouse.move(x + (orientation === 'vertical' ? 40 : 0), y + (orientation === 'horizontal' ? 40 : 0), { steps: 5 })
      await page.mouse.up()
      const after = (await handle.boundingBox())!
      expect(Math.abs(orientation === 'vertical' ? after.x - box.x : after.y - box.y)).toBeGreaterThan(25)
    }
    await expect(grid.locator('.terminal-pane[data-preserved="yes"]')).toHaveCount(3)
    const keyboardHandle = grid.getByRole('separator', { name: 'Resize rows' })
    const beforeKeyboard = (await keyboardHandle.boundingBox())!
    await keyboardHandle.focus()
    await page.keyboard.press('ArrowDown')
    expect((await keyboardHandle.boundingBox())!.y).toBeGreaterThan(beforeKeyboard.y)
    const persisted = await page.evaluate(() => localStorage.getItem('oxe-pane-layout-trees-v1'))
    await page.reload()
    await expect(page.getByTestId('terminal-pane')).toHaveCount(3)
    expect(await page.evaluate(() => localStorage.getItem('oxe-pane-layout-trees-v1'))).toBe(persisted)
    await page.screenshot({ path: test.info().outputPath('three-panes.png') })
    await page.setViewportSize({ width: 900, height: 650 })
    await expect(grid).toBeVisible()
    await page.screenshot({ path: test.info().outputPath('compact-panes.png') })
    await page.getByRole('button', { name: 'More pane actions' }).last().click()
    await expect(page.getByRole('menuitem', { name: 'Equilibrar divisões' })).toBeVisible()
    await page.getByRole('menuitem', { name: 'Equilibrar divisões' }).scrollIntoViewIfNeeded()
    const menuBox = (await page.getByTestId('pane-actions-menu').boundingBox())!
    expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(650)
    await page.screenshot({ path: test.info().outputPath('layout-menu.png') })
  } finally { await app.close() }
})
