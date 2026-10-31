import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, openDemoWorkspace, resizeWindow } from '../helpers/launch'

/**
 * Pre-homologation of #186 (F4 WCAG 2.2, parts 1–2), keyboard only and in pt-BR: the dividers open their menu with
 * Enter and give focus back, the file tree's menu opens with Shift+F10, targets under 24px are counted, and
 * prefers-contrast: more is captured in both modes. Not part of CI.
 */
const OUT = join(process.cwd(), 'e2e', 'screenshots', 'homologation', 'pre-186')
mkdirSync(OUT, { recursive: true })
const notes: Record<string, unknown> = {}
test.afterAll(() => writeFileSync(join(OUT, 'notes.json'), JSON.stringify(notes, null, 2)))
const shot = (page: Page, name: string) => page.screenshot({ path: join(OUT, `${name}.png`) })

/** Visible controls smaller than 24×24 px (WCAG 2.5.8), with their names. */
const smallTargets = (page: Page) => page.evaluate(() => [...document.querySelectorAll('button,a[href],input,select,textarea,[role="button"],[role="tab"],[role="menuitem"],[role="separator"][tabindex]')]
  .filter(el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && (r.width < 24 || r.height < 24) })
  .map(el => { const r = el.getBoundingClientRect(); return `${el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 30) || el.tagName} ${Math.round(r.width)}x${Math.round(r.height)}` }))

test('keyboard alternatives to dragging, pt-BR', async () => {
  test.setTimeout(180_000)
  const { app, page, workspaceRoot, consoleErrors } = await launchApp({ locale: 'pt-BR' })
  try {
    await resizeWindow(app, 1280, 860)
    writeFileSync(join(workspaceRoot, 'notas.md'), '# notas\n')
    await openDemoWorkspace(page, workspaceRoot)

    // Workspace sidebar divider: focus it, Enter opens the size menu, Escape gives focus back.
    const sidebar = page.getByRole('separator').filter({ hasNot: page.locator('[data-testid="split-resize-handle"]') }).first()
    notes.sidebarSeparatorName = await sidebar.getAttribute('aria-label')
    await sidebar.focus()
    await page.keyboard.press('Enter')
    const menu = page.getByRole('menu').last()
    await expect(menu).toBeVisible()
    notes.sidebarMenu = { name: await menu.getAttribute('aria-label'), items: await menu.getByRole('menuitem').allInnerTexts() }
    await shot(page, 'sidebar-size-menu-pt-BR')
    const before = await sidebar.getAttribute('aria-valuenow')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    notes.sidebarAfterSecondItem = { before, after: await sidebar.getAttribute('aria-valuenow'), menuStillOpen: await menu.isVisible() }
    await page.keyboard.press('Escape')
    notes.focusBackOnSeparator = await sidebar.evaluate(el => el === document.activeElement)

    // A pane grid divider by keyboard.
    const divider = page.getByTestId('split-resize-handle').first()
    notes.dividerFocusable = await divider.evaluate(el => (el as HTMLElement).tabIndex >= 0)
    await divider.focus()
    await page.keyboard.press('Enter')
    const dividerMenu = page.getByRole('menu').last()
    notes.dividerMenu = await dividerMenu.isVisible().then(async visible => visible ? { name: await dividerMenu.getAttribute('aria-label'), items: await dividerMenu.getByRole('menuitem').allInnerTexts() } : 'did not open with Enter')
    await shot(page, 'divider-menu-pt-BR')
    await page.keyboard.press('Escape')

    // File tree: Shift+F10 on a file opens the path menu.
    await page.keyboard.press('Control+k')
    await page.locator('[cmdk-item][data-value="cmd-tool-editor"]').click()
    const file = page.locator('.editor-browser-file', { hasText: 'notas.md' })
    await file.focus()
    await page.keyboard.press('Shift+F10')
    const pathMenu = page.getByRole('menu').last()
    notes.fileMenu = await pathMenu.isVisible().then(async visible => visible ? { name: await pathMenu.getAttribute('aria-label'), items: await pathMenu.getByRole('menuitem').allInnerTexts() } : 'did not open with Shift+F10')
    await shot(page, 'file-path-menu-pt-BR')
    await page.keyboard.press('Escape')

    notes.smallTargetsCode = await smallTargets(page)
    notes.errors = consoleErrors
  } finally { await app.close() }
})

test('prefers-contrast: more, light and dark', async () => {
  test.setTimeout(120_000)
  const { app, page, workspaceRoot } = await launchApp({ locale: 'pt-BR' })
  try {
    await resizeWindow(app, 1280, 860)
    await openDemoWorkspace(page, workspaceRoot)
    for (const colorScheme of ['light', 'dark'] as const) {
      for (const contrast of ['no-preference', 'more'] as const) {
        await page.evaluate(mode => localStorage.setItem('oxe-settings', JSON.stringify({ state: { appearance: mode, density: 'compact', motion: 'reduce', notificationsEnabled: true, visitedWorkspacesCap: 5, language: 'system', uiScale: 1, keybindingOverrides: {} }, version: 7 })), colorScheme)
        await page.reload(); await page.waitForLoadState('load')
        await page.emulateMedia({ colorScheme, contrast })
        await page.waitForTimeout(800)
        await shot(page, `code-${colorScheme}-${contrast}`)
        notes[`tokens-${colorScheme}-${contrast}`] = await page.evaluate(() => {
          const s = getComputedStyle(document.documentElement)
          return { borderDefault: s.getPropertyValue('--border-default').trim(), textMuted: s.getPropertyValue('--text-muted').trim() }
        })
      }
    }
  } finally { await app.close() }
})
