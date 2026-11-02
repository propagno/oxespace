import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, setAppearance, type LaunchedApp } from './helpers/launch'

/**
 * Toasts (F21): a repeat merges into the toast showing with a count, hovering pauses it, every toast has a close
 * button and Escape, the stack never takes focus, and the region passes axe in light and dark.
 * The trigger is "Activity: Mark all as read" with nothing unread, which always says "Nothing to mark as read".
 * Shots: e2e/screenshots/toasts/<appearance>.png and <appearance>-page.png.
 */
const OUT = join(process.cwd(), 'e2e/screenshots/toasts')
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
const COMMAND = 'cmd-activity.markAllRead'

const region = (page: Page): Locator => page.getByRole('region', { name: 'Notifications' })
const toasts = (page: Page): Locator => region(page).locator('[data-toast]')

async function markAllRead(page: Page): Promise<void> {
  const input = page.getByPlaceholder('Search files and commands…')
  for (let attempt = 0; attempt < 3 && !(await input.isVisible()); attempt++) {
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press('Control+k')
    await input.waitFor({ timeout: 2_000 }).catch(() => undefined)
  }
  await input.fill('Mark all as read')
  await page.locator(`[cmdk-item][data-value="${COMMAND}"]`).click()
  await expect(input).toBeHidden()
}

/** The stack sits above the status bar and never covers it (homologation #245). */
async function expectAboveStatusBar(page: Page, item: Locator): Promise<void> {
  const bar = page.locator('footer.app-statusbar').first()
  if (!(await bar.isVisible())) return
  const [toastBox, barBox] = [await item.boundingBox(), await bar.boundingBox()]
  expect(toastBox && barBox && toastBox.y + toastBox.height <= barBox.y, 'toast bottom above the status bar').toBe(true)
}

async function axe(page: Page): Promise<string[]> {
  const result = await new AxeBuilder({ page }).setLegacyMode(true).withTags(TAGS).include('section[aria-label="Notifications"]').analyze()
  return result.violations.map(violation => `${violation.id}: ${violation.nodes.map(node => node.target.join(' ')).join(', ')}`)
}

test.describe('toasts', () => {
  test.describe.configure({ timeout: 180_000 })
  let launched: LaunchedApp

  test.beforeAll(async () => {
    mkdirSync(OUT, { recursive: true })
    launched = await launchApp({ appearance: 'light' })
  })
  test.afterAll(async () => { await launched?.app.close() })

  test('a repeat merges with a count, hover pauses, close and Escape dismiss, focus stays put', async () => {
    const { page } = launched
    for (let i = 0; i < 4; i++) await markAllRead(page)
    await expect(toasts(page)).toHaveCount(1)
    const item = toasts(page).first()
    await expect(item).toContainText('Nothing to mark as read')
    await expect(item).toContainText('×4')
    // The count is spoken once the burst settles, not four times.
    await expect(item.locator('.sr-only')).toHaveText('Repeated 4 times')
    expect(await region(page).evaluate(el => el.contains(document.activeElement))).toBe(false)
    expect(await region(page).getAttribute('aria-live')).toBe('polite')

    expect(await axe(page)).toEqual([])
    await expectAboveStatusBar(page, item)
    await item.screenshot({ path: join(OUT, 'light.png') })
    await page.screenshot({ path: join(OUT, 'light-page.png') })

    // Longer than this toast's own time (4 s + 60 ms a character, about 7.5 s): it stays while the pointer is on it.
    await item.locator('strong').hover()
    await page.waitForTimeout(9_000)
    await expect(item).toBeVisible()
    // Away from the stack, the timer runs again and the toast goes.
    await page.mouse.move(10, 300)
    await expect(toasts(page)).toHaveCount(0, { timeout: 12_000 })

    // The close button.
    await markAllRead(page)
    await toasts(page).first().getByRole('button', { name: 'Dismiss notification' }).click()
    await expect(toasts(page)).toHaveCount(0)

    // Escape with focus in the toast.
    await markAllRead(page)
    await toasts(page).first().getByRole('button', { name: 'Dismiss notification' }).focus()
    await page.keyboard.press('Escape')
    await expect(toasts(page)).toHaveCount(0)
    expect(launched.consoleErrors.filter(line => line.startsWith('pageerror:'))).toEqual([])
  })

  test('dark: the merged toast reads and passes axe', async () => {
    const { page } = launched
    await setAppearance(page, 'dark')
    await markAllRead(page)
    await markAllRead(page)
    const item = toasts(page).first()
    await expect(item).toContainText('×2')
    await page.mouse.move(10, 300)
    expect(await axe(page)).toEqual([])
    await expectAboveStatusBar(page, item)
    await item.screenshot({ path: join(OUT, 'dark.png') })
    await page.screenshot({ path: join(OUT, 'dark-page.png') })
  })
})
