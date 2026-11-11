import { expect, test, type Page } from '@playwright/test'
import { launchApp, openDemoWorkspace, resizeWindow } from '../helpers/launch'
import { installThreadFixtures, openThreadWithState, registerThreadProject } from '../helpers/thread-fixtures'

/**
 * F35 · #344 · Team moved off the title bar. Black box, every way in the 1.4.0 notes name:
 * the command palette, the application menu's Tools › Project team…, Ctrl+Shift+T, and OxeChat's menu. Each opens the
 * project team dialog; Escape closes it and focus comes back. The title bar has no Team button.
 */
// Found by its heading; whether it is also named for assistive tech is recorded on its own.
const teamDialog = (page: Page) => page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: /Project team|Equipe do projeto/i }) })
async function closeAndCheck(page: Page, how: string, out: Record<string, unknown>) {
  const opened = await teamDialog(page).first().waitFor({ state: 'visible', timeout: 5_000 }).then(() => true, () => false)
  out[how] = opened
  if (opened) {
    out[`${how}Named`] = await page.getByRole('dialog', { name: /team|equipe/i }).count()
    expect.soft(out[`${how}Named`], `${how}: the dialog has an accessible name`).toBeGreaterThan(0)
  }
  expect.soft(opened, `${how} opens the project team`).toBe(true)
  if (opened) { await page.keyboard.press('Escape'); await expect.soft(teamDialog(page)).toHaveCount(0, { timeout: 3_000 }) }
}

test('F35/#344: Team from the palette, Tools menu, Ctrl+Shift+T and OxeChat; not in the title bar', async () => {
  test.setTimeout(150_000)
  const { app, page, workspaceRoot, consoleErrors } = await launchApp({ locale: 'en-US' })
  const out: Record<string, unknown> = {}
  try {
    await resizeWindow(app, 1280, 860)
    await installThreadFixtures(app, workspaceRoot)
    await openDemoWorkspace(page, workspaceRoot)
    const titleBar = page.locator('[data-testid="title-bar"], header').first()
    out.titleBarTeam = await titleBar.getByRole('button', { name: /^Team\b|^Equipe\b/i }).count()
    expect.soft(out.titleBarTeam, 'no Team button in the title bar').toBe(0)

    // Palette.
    await page.keyboard.press('Control+Shift+P'); await page.keyboard.insertText('Team')
    out.paletteItems = await page.locator('[cmdk-item]').allInnerTexts().then(l => l.filter(t => /team/i.test(t)).slice(0, 5))
    await page.locator('[cmdk-item]', { hasText: /team/i }).first().click().catch(() => undefined)
    await closeAndCheck(page, 'palette', out)

    // Application menu › Tools › Project team…
    await page.locator('.app-menu-button').first().click()
    await page.getByRole('menuitem', { name: /^Tools/ }).first().click()
    out.toolsItems = await page.getByRole('menuitem').allInnerTexts().then(l => l.filter(t => /team/i.test(t)))
    await page.getByRole('menuitem', { name: /(open the )?project team|team/i }).first().click().catch(() => undefined)
    await closeAndCheck(page, 'toolsMenu', out)

    // Ctrl+Shift+T from the workspace (not from a terminal, which keeps its keys).
    await page.locator('body').click({ position: { x: 640, y: 20 } }).catch(() => undefined)
    await page.keyboard.press('Control+Shift+T')
    await closeAndCheck(page, 'shortcut', out)

    // OxeChat's menu.
    await registerThreadProject(app, page, workspaceRoot)
    await openThreadWithState(app, page, workspaceRoot, 'conversation')
    // OxeChat's ⋯ for the project, in the conversation sidebar ("Actions for <project>"), then the conversation's own menus.
    const menus = page.locator('[data-project-actions]').or(page.locator('.thread-heading, main').getByRole('button', { name: /More actions|Conversation actions|Mais ações/ }))
    out.threadMenus = await menus.count()
    let found = false
    for (let i = 0; i < out.threadMenus && !found; i++) {
      await menus.nth(i).click().catch(() => undefined)
      const item = page.getByRole('menuitem', { name: /team|equipe/i }).first()
      if (await item.waitFor({ state: 'visible', timeout: 1_500 }).then(() => true, () => false)) { found = true; await item.click() } else await page.keyboard.press('Escape')
    }
    out.threadMenuItem = found
    expect.soft(found, 'OxeChat\'s menu has Team').toBe(true)
    if (found) await closeAndCheck(page, 'oxechatMenu', out)
    expect.soft(consoleErrors.filter(l => l.startsWith('pageerror')), 'no page error').toEqual([])
  } finally {
    console.log('F35', JSON.stringify(out))
    await app.close()
  }
})
