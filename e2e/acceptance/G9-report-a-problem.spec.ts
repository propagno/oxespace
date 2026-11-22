import { expect, test } from '@playwright/test'
import { launchReal, quitReal, realProfile } from './real-app'

/**
 * G9 · the 1.4.0 notes say "Report a problem… (the menu button beside the logo › Help, or the command palette)".
 * REAL app, black box, by mouse and by keyboard: the title bar's menu button, Help, Report a problem; the report
 * dialog opens, and nothing is sent. en and pt-BR.
 */
for (const locale of ['en-US', 'pt-BR'] as const) {
  test(`G9 Report a problem from the menu button beside the logo (${locale})`, async () => {
    test.setTimeout(120_000)
    const profile = realProfile(`g9${locale.slice(0, 2)}`, { OXESPACE_LOCALE: locale })
    const { app, page } = await launchReal(profile)
    const en = locale === 'en-US'
    try {
      await app.evaluate(({ dialog, shell }) => {
        const g = globalThis as Record<string, unknown>; g.opened = []
        dialog.showMessageBox = (() => new Promise(() => undefined)) as typeof dialog.showMessageBox
        dialog.showMessageBoxSync = (() => 0) as typeof dialog.showMessageBoxSync
        shell.openExternal = (async (url: string) => { (g.opened as string[]).push(url) }) as typeof shell.openExternal
      })
      // Since 1.5.0 (#760) the menus sit inline beside the logo (File … Help); the compact menu button is for narrow widths.
      const button = page.locator('.app-menubar-inline').getByRole('button', { name: en ? 'Help' : 'Ajuda', exact: true })
      await expect(button, 'Help is in the title bar').toBeVisible()
      const box = await button.boundingBox()
      console.log('G9-BUTTON', locale, JSON.stringify({ box, label: await button.innerText() }))
      await button.click()
      await page.getByRole('menuitem', { name: en ? /Report a problem/ : /Relatar um problema/ }).first().click()
      const report = page.getByRole('dialog', { name: en ? 'Report a problem' : /Relatar um problema/ })
      await expect(report, 'the report dialog opens').toBeVisible({ timeout: 10_000 })
      const text = await report.innerText()
      console.log('G9-REPORT', locale, text.replace(/\s+/g, ' ').slice(0, 300))
      expect.soft(await app.evaluate(() => (globalThis as Record<string, unknown>).opened), 'nothing is sent or opened by itself').toEqual([])
      await page.keyboard.press('Escape')
      await expect.soft(report, 'Escape closes it').toHaveCount(0)
      // By keyboard: focus Help, open it with Enter, arrow to the item.
      await button.focus(); await page.keyboard.press('Enter')
      const item = page.getByRole('menuitem', { name: en ? /Report a problem/ : /Relatar um problema/ }).first()
      for (let i = 0; i < 12 && !(await item.evaluate(e => e === document.activeElement).catch(() => false)); i++) await page.keyboard.press('ArrowDown')
      await page.keyboard.press('Enter')
      await expect.soft(report, 'by keyboard too').toBeVisible({ timeout: 10_000 })
    } finally { await quitReal(app) }
  })
}
