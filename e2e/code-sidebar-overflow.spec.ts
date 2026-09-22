import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('Code keeps navigation footer visible while a long workspace list scrolls', async () => {
  const root = mkdtempSync(join(tmpdir(), 'oxe-sidebar-overflow-'))
  const projects = Array.from({ length: 18 }, (_, index) => join(root, `workspace-${String(index + 1).padStart(2, '0')}`))
  projects.forEach(project => mkdirSync(project))
  const app = await electron.launch({ args: [join(process.cwd(), 'e2e/electron-main.cjs')], env: {
    ...process.env, OXESPACE_DISABLE_SINGLE_INSTANCE: '1', OXESPACE_E2E_MOCK_NATIVE: '1', OXESPACE_DB_PATH: join(root, 'db.sqlite3')
  } })
  try {
    const page = await app.firstWindow()
    await page.setViewportSize({ width: 1000, height: 600 })
    await expect(page.getByTestId('btn-new-workspace')).toBeVisible()
    await page.evaluate(async roots => {
      for (const rootPath of roots) await window.oxe.workspace.create({ rootPath, layoutPreset: 1, autoStart: false })
    }, projects)
    await page.reload()
    await expect(page.getByTestId('sidebar-workspace-select')).toHaveCount(projects.length)
    await expect(page.getByRole('button', { name: 'Collapse sidebar', exact: true })).toBeVisible()
    const geometry = await page.evaluate(() => {
      const list = document.querySelector('.ws-group-list') as HTMLElement
      const footer = document.querySelector('.desktop-nav-footer') as HTMLElement
      return {
        listClientHeight: list.clientHeight,
        listScrollHeight: list.scrollHeight,
        footerBottom: footer.getBoundingClientRect().bottom,
        viewportHeight: window.innerHeight
      }
    })
    expect(geometry.listScrollHeight).toBeGreaterThan(geometry.listClientHeight)
    expect(geometry.footerBottom).toBeLessThanOrEqual(geometry.viewportHeight)
  } finally { await app.close() }
})
