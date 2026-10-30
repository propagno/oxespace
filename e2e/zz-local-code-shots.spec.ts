// LOCAL ONLY — not committed. Captures the Code screens in both languages and modes for a manual review.
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, openDemoWorkspace, setAppearance } from './helpers/launch'

const OUT = join(process.cwd(), 'e2e', 'screenshots', 'code-i18n')

for (const locale of ['pt-BR', 'en']) {
  for (const mode of ['light', 'dark'] as const) {
    test(`code screens ${locale} ${mode}`, async () => {
      test.setTimeout(180_000)
      mkdirSync(OUT, { recursive: true })
      const { app, page, workspaceRoot } = await launchApp({ locale })
      const shot = (name: string, target: Page | ReturnType<Page['locator']> = page) => target.screenshot({ path: join(OUT, `${locale}-${mode}-${name}.png`) })
      try {
        execFileSync('git', ['init', '-q', '-b', 'main', workspaceRoot])
        writeFileSync(join(workspaceRoot, 'README.md'), '# demo\n\nhello world\n')
        writeFileSync(join(workspaceRoot, 'build.ps1'), 'Write-Host build\n')
        await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1360, 860); w.center() })
        await setAppearance(page, mode)
        await shot('00-empty')
        await page.getByTestId('btn-new-workspace').click()
        await page.getByTestId('wizard-dir-input').fill(workspaceRoot)
        await page.waitForTimeout(300)
        await shot('01-new-workspace')
        await page.getByTestId('wizard-layout-card-2').click()
        await page.getByTestId('wizard-launch-btn').click()
        await page.waitForSelector('[data-testid="workspace-grid"], [data-testid="workspace-split-grid"]')
        await page.waitForTimeout(800)
        await shot('02-workspace')
        const panelsBtn = page.locator('[data-testid="btn-open-tools"]:visible')
        const open = async (name: string) => { await panelsBtn.click(); await page.getByRole('menu').getByRole('menuitemcheckbox').filter({ hasText: name }).first().click(); await page.waitForTimeout(700) }
        const panelNames = locale === 'en'
          ? ['Changes', 'Commit & pull request', 'Files', 'Find in files', 'Scripts', 'Worktrees']
          : ['Alterações', 'Commit e pull request', 'Arquivos', 'Buscar nos arquivos', 'Scripts', 'Worktrees']
        await panelsBtn.click(); await page.waitForTimeout(300); await shot('03-panels-menu'); await page.keyboard.press('Escape')
        for (const [index, name] of panelNames.entries()) {
          await open(name)
          await shot(`1${index}-${name.replace(/[^a-z]/gi, '').toLowerCase()}`)
          await open(name)
        }
        await page.locator('.workspace-topbar-action').nth(1).click(); await page.waitForTimeout(600)
        await shot('20-mcp')
        const dialog = page.getByRole('dialog').first()
        await dialog.getByRole('tab').nth(1).click(); await page.waitForTimeout(400)
        await shot('21-mcp-installed')
        await page.keyboard.press('Escape')
        await page.locator('.workspace-topbar-action').nth(2).click(); await page.waitForTimeout(500)
        await shot('22-background')
        await page.locator('.workspace-topbar-action').nth(2).click()
        await page.locator('.ws-group-settings-btn').first().click(); await page.waitForTimeout(300)
        await shot('23-workspace-menu')
        await page.keyboard.press('Escape')
        await expect(page.locator('body')).toBeVisible()
      } finally {
        await app.close()
      }
    })
  }
}
